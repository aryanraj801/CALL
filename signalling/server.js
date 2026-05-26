import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import webpush from 'web-push';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, '..', 'server', '.env') });
dotenv.config();

const app = express();
app.use(express.json({ limit: '64kb' }));  // needed to parse push subscription body

// SEC-06 FIX: Restrict HTTP CORS to known origins from environment variable
const ALLOWED_ORIGIN = process.env.CORS_ORIGINS || 'http://localhost:3000';
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));

// ── WEB PUSH / VAPID ─────────────────────────────────────────────────────────
// Keys are generated ONCE with:  node --input-type=module -e "import wp from 'web-push'; const k=wp.generateVAPIDKeys(); console.log(JSON.stringify(k));"
// Then stored permanently in the .env file so the same key pair is reused.
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || 'BHCb5s1JUXR9RujuTIpjIX5J3B_FM-BE0gq9zLHUYYKLZT6R8tnvmiWgV63cMDp6E3CvAnZm-UcFDzmKoQY1vEY';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'FHCYgaulttI0kCEn-6eJ1ToEM7yAOMk07UqrQP024FU';
const VAPID_EMAIL   = process.env.VAPID_EMAIL       || 'mailto:admin@nexalink.app';

try {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
  console.log('[WebPush] VAPID configured ✔');
} catch (e) {
  console.warn('[WebPush] VAPID setup failed — push notifications disabled:', e.message);
}

// Push subscription store:  username (lowercase) → PushSubscription object
// In production this should be persisted in a database.
const pushSubscriptions = {};   // { username: PushSubscription }

/**
 * Send a Web Push notification to a user who may be offline.
 * Silently no-ops if the user has no push subscription.
 */
async function sendPush(targetUsername, payload) {
  const sub = pushSubscriptions[targetUsername?.toLowerCase()];
  if (!sub) return;  // user hasn't subscribed or is online
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload));
    console.log(`[WebPush] Push sent to <${targetUsername}>`);
  } catch (err) {
    if (err.statusCode === 410) {
      // Subscription expired — remove it
      delete pushSubscriptions[targetUsername.toLowerCase()];
      console.log(`[WebPush] Removed expired subscription for <${targetUsername}>`);
    } else {
      console.error(`[WebPush] Failed to send push to <${targetUsername}>:`, err.message);
    }
  }
}

// Healthcheck endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'HEALTHY', timestamp: new Date().toISOString() });
});

// ── WEB PUSH HTTP ENDPOINTS ───────────────────────────────────────────────────

/** Client fetches this to build the PushSubscription */
app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC });
});

/**
 * Client POSTs its PushSubscription + username here.
 * Body: { username: string, subscription: PushSubscription }
 */
app.post('/api/push/subscribe', (req, res) => {
  const { username, subscription } = req.body || {};
  if (!username || !subscription?.endpoint) {
    return res.status(400).json({ error: 'username and subscription.endpoint required' });
  }
  const key = username.trim().toLowerCase();
  pushSubscriptions[key] = subscription;
  console.log(`[WebPush] Subscription saved for <${key}>`);
  res.json({ ok: true });
});

/** Client calls this on logout / when revoking permission */
app.delete('/api/push/subscribe', (req, res) => {
  const { username } = req.body || {};
  if (username) delete pushSubscriptions[username.trim().toLowerCase()];
  res.json({ ok: true });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    // SEC-06 FIX: Restrict WebSocket CORS to specific origins only
    origin: ALLOWED_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// In-memory mappings: roomId -> array of participant details
const roomParticipants = {};

// ── PRESENCE REGISTRY ───────────────────────────────────────────────────────
// Maps username (lowercase) → socket.id so callers can reach peers by name
// even when they don't know the socket ID.
const onlineUsers = {};  // { username: socketId }

// --- SEC-14 FIX: Validate and sanitize whiteboard stroke data ---
// Prevents peers from sending malicious payloads (extreme values, script in color)
function sanitizeStroke(stroke) {
  if (!stroke || typeof stroke !== 'object') return null;

  // CSS color: allow hex (#rrggbb or #rgb), named colors (only alpha chars), rgb()/rgba()
  const colorRegex = /^(#[0-9a-fA-F]{3,8}|rgba?\(\d{1,3},\s*\d{1,3},\s*\d{1,3}(,\s*[\d.]+)?\)|[a-zA-Z]{3,20})$/;
  const color = typeof stroke.color === 'string' && colorRegex.test(stroke.color.trim())
    ? stroke.color.trim()
    : '#6366f1'; // safe fallback color

  return {
    // Clamp coordinates to canvas bounds (prevent float overflow / NaN)
    x: Math.max(-10000, Math.min(10000, Number(stroke.x) || 0)),
    y: Math.max(-10000, Math.min(10000, Number(stroke.y) || 0)),
    lastX: Math.max(-10000, Math.min(10000, Number(stroke.lastX) || 0)),
    lastY: Math.max(-10000, Math.min(10000, Number(stroke.lastY) || 0)),
    // Clamp brush size to sane range (1-50px)
    size: Math.max(1, Math.min(50, Number(stroke.size) || 4)),
    color,
    isEraser: stroke.isEraser === true, // strict boolean, not truthy
  };
}

// --- SEC-19 FIX: Authenticate Socket.IO connections via the Bearer token ---
// The client must pass the JWT in the auth handshake. Connections without a
// valid token are rejected immediately at the middleware level.
const JWT_SECRET = process.env.JWT_SECRET_KEY;

function verifyJwt(token) {
  const [headerB64, payloadB64, sig] = token.split('.');
  if (!headerB64 || !payloadB64 || !sig) throw new Error('Malformed token');

  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
  if (header.alg !== 'HS256') throw new Error('Unsupported token algorithm');

  const expectedSig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token has expired');
  }
  return payload;
}

io.use((socket, next) => {
  // In development mode without a JWT secret, allow all connections for easy local testing
  if (!JWT_SECRET) {
    console.warn('[Signalling][Security] JWT_SECRET_KEY not set — socket auth disabled (development mode only)');
    return next();
  }

  const auth = socket.handshake.auth || {};
  if (auth.agent === 'desktop-agent') {
    const remoteAddress = socket.handshake.address;
    const isLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress);
    if (!isLoopback) {
      return next(new Error('[Auth] Desktop agent connections are only allowed from localhost.'));
    }
    socket.data.user = { sub: 'desktop-agent', username: 'NexaLink Desktop Agent' };
    socket.data.isDesktopAgent = true;
    return next();
  }

  const token = auth.token;
  if (!token) {
    return next(new Error('[Auth] Missing authentication token. Connect with auth: { token: "<jwt>" }'));
  }

  try {
    socket.data.user = verifyJwt(token); // attach verified claims to socket
    next();
  } catch (err) {
    return next(new Error(`[Auth] ${err.message || 'Invalid token'}.`));
  }
});

// Helper: safely remove a participant from a room and clean up empty rooms
function removeParticipant(roomName, socketId) {
  if (!roomName || !roomParticipants[roomName]) return;

  roomParticipants[roomName] = roomParticipants[roomName].filter(
    (p) => p.id !== socketId
  );

  if (roomParticipants[roomName].length === 0) {
    // BUG FIX #10: Delete the room entry to prevent in-memory bloat
    delete roomParticipants[roomName];
  } else {
    io.to(roomName).emit('participants_changed', roomParticipants[roomName]);
  }
}

io.on('connection', (socket) => {
  console.log(`[Signalling] Client connected: ${socket.id}`);
  let currentRoom = null;
  let registeredUsername = null;  // username bound to this socket

  // ── PRESENCE: Register username → socket mapping ────────────────────────
  // Called right after auth so the server can route call invites by username.
  socket.on('register_presence', ({ username }) => {
    if (typeof username !== 'string' || !username.trim()) return;
    const key = username.trim().toLowerCase();
    registeredUsername = key;
    onlineUsers[key] = socket.id;
    console.log(`[Presence] ${key} online → ${socket.id}`);
  });

  // Join Event Handler
  socket.on('join_room', ({ roomName, userAlias }) => {
    // BUG FIX: If the socket is already in a room (e.g., from a re-connect
    // attempt), remove from old room first before joining the new one.
    if (currentRoom && currentRoom !== roomName) {
      socket.leave(currentRoom);
      removeParticipant(currentRoom, socket.id);
    }

    currentRoom = roomName;
    socket.join(roomName);

    if (!roomParticipants[roomName]) {
      roomParticipants[roomName] = [];
    }

    // Prevent duplicate entries for the same socket (guards against rapid re-joins)
    const existing = roomParticipants[roomName].find(p => p.id === socket.id);
    if (existing) {
      // Update alias in place if already present
      existing.name = userAlias?.name || existing.name;
      existing.avatar = userAlias?.avatar || existing.avatar;
    } else {
      // Add socket client as new participant
      const newParticipant = {
        id: socket.id,
        name: userAlias?.name || `Anonymous-${socket.id.substring(0, 4)}`,
        avatar: userAlias?.avatar || '👤',
        profilePic: typeof userAlias?.profilePic === 'string' ? userAlias.profilePic.slice(0, 150000) : '',
        bio: typeof userAlias?.bio === 'string' ? userAlias.bio.slice(0, 240) : '',
        isMuted: false,
        isVideoOff: false,
        isSharingScreen: userAlias?.isSharingScreen || false,
        isRemoteControlled: false,
        controlPermissionLevel: 'none',
      };
      roomParticipants[roomName].push(newParticipant);
      console.log(`[Signalling] User <${newParticipant.name}> joined Room: ${roomName}`);
    }

    // Broadcast updated list to the room
    io.to(roomName).emit('participants_changed', roomParticipants[roomName]);
  });

  // BUG FIX #4: Handle alias updates WITHOUT dropping the connection.
  // When a client calls toggleAlias(), it emits update_alias over the live
  // socket. We update the participant roster and rebroadcast — seamlessly.
  socket.on('update_alias', ({ userAlias }) => {
    if (!currentRoom || !roomParticipants[currentRoom]) return;

    const participant = roomParticipants[currentRoom].find(p => p.id === socket.id);
    if (participant && userAlias) {
      const oldName = participant.name;
      participant.name = userAlias.name || participant.name;
      participant.avatar = userAlias.avatar || participant.avatar;
      participant.profilePic = typeof userAlias.profilePic === 'string' ? userAlias.profilePic.slice(0, 150000) : participant.profilePic;
      participant.bio = typeof userAlias.bio === 'string' ? userAlias.bio.slice(0, 240) : participant.bio;
      console.log(`[Signalling] Alias updated: <${oldName}> -> <${participant.name}> in Room: ${currentRoom}`);
      // Rebroadcast updated roster so all peers see the new alias instantly
      io.to(currentRoom).emit('participants_changed', roomParticipants[currentRoom]);
    }
  });

  socket.on('chat_message', ({ roomName, sender, text, time }) => {
    if (!roomName || typeof text !== 'string' || !text.trim()) return;
    const safeSender = typeof sender === 'string' ? sender.slice(0, 80) : 'Peer';
    const safeText   = text.slice(0, 2000);
    const safeTime   = typeof time === 'string' ? time.slice(0, 20) : '';

    // Deliver to online room members via socket
    socket.to(roomName).emit('chat_message', { sender: safeSender, text: safeText, time: safeTime });

    // Web Push for offline members of this room
    // Find all registered users whose socket is NOT in this room
    const roomMembers = (roomParticipants[roomName] || []).map(p => p.id);
    for (const [username, sub] of Object.entries(pushSubscriptions)) {
      const userSocketId = onlineUsers[username];
      // Only push to offline users (not in the room right now)
      if (!userSocketId || !roomMembers.includes(userSocketId)) {
        sendPush(username, {
          type:   'update',
          sender: safeSender,
          body:   'NexaLink received an update',
          room:   roomName,
        });
      }
    }
  });


  socket.on('tts_message', ({ roomName, sender, text, voice }) => {
    if (!roomName || typeof text !== 'string' || !text.trim()) return;
    socket.to(roomName).emit('tts_message', {
      sender: typeof sender === 'string' ? sender.slice(0, 80) : 'Peer',
      text: text.slice(0, 600),
      voice: typeof voice === 'string' ? voice.slice(0, 80) : 'Default',
    });
  });

  // Chaperone Input Control Tunneling Requests (Phase 4)
  socket.on('control_request', ({ targetId, requesterName, accessType }) => {
    console.log(`[Chaperone] Control request from <${socket.id}> (${requesterName}) to <${targetId}>: type=${accessType}`);
    io.to(targetId).emit('control_requested', {
      requesterId: socket.id,
      requesterName,
      accessType,
    });
  });

  // Chaperone Approval handshake response
  socket.on('control_response', ({ requesterId, approved, level }) => {
    console.log(`[Chaperone] Host <${socket.id}> response to <${requesterId}>: approved=${approved}, level=${level}`);

    if (approved && currentRoom) {
      // Update target ID remote status
      const list = roomParticipants[currentRoom] || [];
      const participant = list.find(p => p.id === socket.id);
      if (participant) {
        participant.isRemoteControlled = true;
        participant.controlPermissionLevel = level;
      }
      io.to(currentRoom).emit('participants_changed', list);
      io.to(requesterId).emit('control_approved', { level });
    } else {
      io.to(requesterId).emit('control_denied');
    }
  });

  // Emergency control revoke kill-switch
  socket.on('control_revoke', () => {
    console.log(`[EMERGENCY] Host <${socket.id}> triggered emergency kill-switch revoking all inputs.`);

    if (currentRoom) {
      const list = roomParticipants[currentRoom] || [];
      const participant = list.find(p => p.id === socket.id);
      if (participant) {
        participant.isRemoteControlled = false;
        participant.controlPermissionLevel = 'none';
      }
      // Broadcast revocation and updated roster to all peers in the room
      io.to(currentRoom).emit('participants_changed', list);
      socket.to(currentRoom).emit('control_revoked');
    }
  });

  // ── REMOTE INPUT TUNNELING ──────────────────────────────────────────────────
  // Relay mouse/keyboard input packets from the requester → the host session.
  // The server validates the accessType so only permitted input classes pass.
  socket.on('remote_input', ({ targetId, inputType, payload, accessType }) => {
    // Guard: drop keyboard inputs if only mouse access was granted, and vice versa
    const isKeyEvent  = inputType === 'keydown' || inputType === 'keyup';
    const isMouseEvent = inputType === 'mousemove' || inputType === 'click'
                      || inputType === 'mousedown' || inputType === 'mouseup'
                      || inputType === 'contextmenu';
    if (isKeyEvent  && accessType === 'mouse')    return; // keyboard blocked
    if (isMouseEvent && accessType === 'keyboard') return; // mouse blocked

    io.to(targetId).emit('remote_input', {
      senderId: socket.id,
      inputType,
      payload,
    });
  });

  // Host physically takes back control — override the remote session immediately.
  // Emitted by the HOST browser when it detects its own physical mouse/keyboard event.
  socket.on('control_override', ({ requesterId }) => {
    console.log(`[Chaperone] Host <${socket.id}> override triggered — revoking requester <${requesterId}>`);

    // Revoke permission in the roster
    if (currentRoom) {
      const list = roomParticipants[currentRoom] || [];
      const participant = list.find(p => p.id === socket.id);
      if (participant) {
        participant.isRemoteControlled = false;
        participant.controlPermissionLevel = 'none';
      }
      io.to(currentRoom).emit('participants_changed', list);
    }

    // Notify the requester that the host has taken back control
    io.to(requesterId).emit('control_overridden', { hostId: socket.id });
  });

  // Whiteboard drawing synchronization (Phase 3)
  socket.on('draw_event', ({ roomName, strokeData }) => {
    // SEC-14 FIX: Validate and sanitize stroke data before relaying to peers.
    // Never blindly broadcast data received from a remote client.
    const clean = sanitizeStroke(strokeData);
    if (!clean) {
      console.warn(`[Security] Invalid stroke data from ${socket.id} — dropped.`);
      return;
    }
    socket.to(roomName).emit('remote_draw', clean);
  });

  socket.on('clear_whiteboard', ({ roomName }) => {
    socket.to(roomName).emit('remote_clear');
  });

  socket.on('load_whiteboard', ({ roomName, url }) => {
    socket.to(roomName).emit('remote_load', { url });
  });

  socket.on('text_event', ({ roomName, textData }) => {
    socket.to(roomName).emit('remote_text', textData);
  });

  socket.on('toggle_screenshare', ({ isSharing }) => {
    if (currentRoom) {
      const list = roomParticipants[currentRoom] || [];
      const participant = list.find(p => p.id === socket.id);
      if (participant) {
        participant.isSharingScreen = isSharing;
      }
      socket.to(currentRoom).emit('participants_changed', list);
    }
  });

  // ── CALL INVITES ─────────────────────────────────────────────────────────
  // Caller emits call_invite; server routes it to the target by username.
  // Payload: { targetUsername, callerName, callerUsername, room, callType }
  socket.on('call_invite', ({ targetUsername, callerName, callerUsername, room, callType }) => {
    if (typeof targetUsername !== 'string') return;
    const key = targetUsername.trim().toLowerCase();
    const targetSocketId = onlineUsers[key];

    const invitePayload = {
      callerName:     typeof callerName     === 'string' ? callerName.slice(0, 80)     : 'Unknown',
      callerUsername: typeof callerUsername === 'string' ? callerUsername.slice(0, 80) : 'unknown',
      callerId:       socket.id,
      room:           typeof room     === 'string' ? room.slice(0, 120) : '',
      callType:       callType === 'voice' ? 'voice' : 'video',
    };

    if (targetSocketId) {
      // User is online — deliver via socket
      console.log(`[Call] Invite from <${callerName}> to <${targetUsername}> — room: ${room}, type: ${callType}`);
      io.to(targetSocketId).emit('incoming_call', invitePayload);
    } else {
      // User is offline — send a Web Push notification
      console.log(`[Call] <${targetUsername}> is offline — sending Web Push`);
      sendPush(key, {
        type:      'session',
        sender:    invitePayload.callerName,
        body:      'NexaLink requesting an active session',
        room:      invitePayload.room,
        callType:  invitePayload.callType,
      });
      // Also notify the caller the target is offline
      socket.emit('call_invite_failed', { reason: 'offline', targetUsername });
    }
  });

  // Target responds: accepted | declined | merged
  // Payload: { callerId, response: 'accepted'|'declined'|'merged' }
  socket.on('call_response', ({ callerId, response }) => {
    if (typeof callerId !== 'string') return;
    const allowed = ['accepted', 'declined', 'merged'];
    const safeResponse = allowed.includes(response) ? response : 'declined';
    io.to(callerId).emit('call_response', { response: safeResponse, responderId: socket.id });
    console.log(`[Call] Response from <${socket.id}> to <${callerId}>: ${safeResponse}`);
  });

  // Caller cancels before target responds
  socket.on('call_cancel', ({ targetUsername }) => {
    if (typeof targetUsername !== 'string') return;
    const targetSocketId = onlineUsers[targetUsername.trim().toLowerCase()];
    if (targetSocketId) {
      io.to(targetSocketId).emit('call_cancelled', { callerId: socket.id });
    }
  });

  socket.on('direct_message', ({ targetUsername, senderUsername, senderName, text, time }) => {
    if (typeof targetUsername !== 'string') return;
    const targetSocketId = onlineUsers[targetUsername.trim().toLowerCase()];
    if (targetSocketId) {
      io.to(targetSocketId).emit('direct_message', { senderUsername, senderName, text, time });
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Signalling] Client disconnected: ${socket.id}`);
    // Clean presence registry
    if (registeredUsername && onlineUsers[registeredUsername] === socket.id) {
      delete onlineUsers[registeredUsername];
      console.log(`[Presence] ${registeredUsername} went offline`);
    }
    // BUG FIX #10: Use helper to clean participant list and prune empty rooms
    removeParticipant(currentRoom, socket.id);
    currentRoom = null;
  });
});

const PORT = process.env.PORT || 8000;
httpServer.listen(PORT, () => {
  console.log(`[Signalling Core Server] Active on port ${PORT}`);
});
