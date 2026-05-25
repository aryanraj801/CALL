import ws from 'k6/ws';
import { check, sleep } from 'k6';

// k6 Options: Simulating 500 Virtual Users scaling up over 30 seconds
export const options = {
  stages: [
    { duration: '10s', target: 150 }, // Warm-up
    { duration: '15s', target: 500 }, // Peak load: 500 concurrent connections
    { duration: '5s', target: 0 },   // Cool-down
  ],
  thresholds: {
    connection_errors: ['rate<0.01'], // less than 1% errors
  },
};

export default function () {
  const url = 'ws://localhost:8000/socket.io/?EIO=4&transport=websocket';
  
  const params = {
    headers: {
      'User-Agent': 'k6-Signalling-Storm-Test',
    },
  };

  const response = ws.connect(url, params, function (socket) {
    socket.on('open', function () {
      // Send Socket.IO join room event representation
      // Format: 42["event_name", {payload}]
      const joinPayload = JSON.stringify([
        'join_room',
        {
          roomName: 'k6-Stress-Node',
          userAlias: { name: `k6-VU-${__VU}`, avatar: '🤖' },
        },
      ]);
      
      socket.send(`42${joinPayload}`);
      
      // Keep connection open for 4 seconds sending simulated audio ping loops
      for (let i = 0; i < 4; i++) {
        sleep(1);
        socket.send('2'); // heartbeat probe
      }
      
      socket.close();
    });

    socket.on('close', function () {
      // Clean exit
    });

    socket.on('error', function (err) {
      console.error(`[k6 VU ${__VU}] Error details: ` + err.error());
    });
  });

  check(response, {
    'status is 101 switching protocols': (r) => r && r.status === 101,
  });
}
