import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
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
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || 'BH6MzhQZspefYizh2fqf4sekOsVWaDXUd31RNyACDGgecTC31eAvA4iGS_MyzpYknuNXgx2zojIUSQ3M9ubtshA';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '0EhREuRxRzyg-Bv2Ot2r5IT5eGlWnSUkE6sZoLIS_9s';
const VAPID_EMAIL   = process.env.VAPID_EMAIL       || 'mailto:admin@nexalink.app';

try {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
  console.log('[WebPush] VAPID configured ✔');
} catch (e) {
  console.warn('[WebPush] VAPID setup failed — push notifications disabled:', e.message);
}

// Push subscription store:  username (lowercase) → PushSubscription object
// Persisted to disk so subscriptions survive server restarts.
const PUSH_SUBS_FILE = path.join(__dirname, '.push_subscriptions.json');
let pushSubscriptions = {};   // { username: PushSubscription }

/** Load push subscriptions from persistent JSON file on startup */
function loadPushSubscriptions() {
  try {
    if (fs.existsSync(PUSH_SUBS_FILE)) {
      const raw = fs.readFileSync(PUSH_SUBS_FILE, 'utf-8');
      pushSubscriptions = JSON.parse(raw);
      console.log(`[WebPush] Loaded ${Object.keys(pushSubscriptions).length} persisted push subscription(s)`);
    }
  } catch (err) {
    console.warn('[WebPush] Failed to load persisted subscriptions:', err.message);
    pushSubscriptions = {};
  }
}

/** Persist current push subscriptions to disk */
function savePushSubscriptions() {
  try {
    fs.writeFileSync(PUSH_SUBS_FILE, JSON.stringify(pushSubscriptions, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[WebPush] Failed to persist subscriptions:', err.message);
  }
}

// Load on startup
loadPushSubscriptions();

/**
 * Send a Web Push notification to a user who may be offline.
 * Returns { delivered: boolean, noSubscription: boolean } so callers can
 * distinguish between "push reached device" vs "device unreachable".
 *
 * Key insight: webpush.sendNotification() sends to the PUSH SERVICE (e.g. FCM),
 * NOT directly to the user's device. A 201 from FCM means the message was
 * accepted for delivery — it will be queued and delivered when the browser wakes.
 *
 * Error code meanings:
 *   201       → accepted by push service (success)
 *   404 / 410 → subscription expired / unsubscribed (clean up)
 *   429       → rate limited by push service (message may still be queued)
 *   5xx       → push service temporarily down (try again later)
 *   401 / 403 → VAPID auth issue (log, but subscription may still be valid)
 */
async function sendPush(targetUsername, payload) {
  const key = targetUsername?.toLowerCase();
  const subs = pushSubscriptions[key];
  if (!subs) {
    console.log(`[WebPush] No subscription found for <${targetUsername}> — cannot deliver`);
    return { delivered: false, noSubscription: true };
  }

  // Handle backward compatibility (single subscription or array)
  const subArray = Array.isArray(subs) ? subs : [subs];
  if (subArray.length === 0) {
    console.log(`[WebPush] Empty subscription array for <${targetUsername}> — cannot deliver`);
    return { delivered: false, noSubscription: true };
  }

  console.log(`[WebPush] Sending push to ${subArray.length} active session endpoint(s) for <${targetUsername}>`);

  let deliveredCount = 0;

  const promises = subArray.map(async (sub, idx) => {
    try {
      const result = await webpush.sendNotification(sub, JSON.stringify(payload));
      console.log(`[WebPush] ✔ Push accepted by push service for <${targetUsername}> endpoint #${idx + 1} (status: ${result.statusCode})`);
      deliveredCount++;
      return { expired: false, delivered: true };
    } catch (err) {
      const status = err.statusCode || 0;
      const body = err.body || '';

      if (status === 410 || status === 404) {
        // Subscription is permanently gone — clean up
        console.log(`[WebPush] ✖ Endpoint #${idx + 1} for <${targetUsername}> expired (${status}) — removing`);
        return { expired: true, delivered: false, endpoint: sub.endpoint };
      } else if (status === 429) {
        // Rate limited — push service received it but is throttling; treat as delivered
        console.warn(`[WebPush] ⚠ Endpoint #${idx + 1} for <${targetUsername}> rate-limited (429) — message likely queued`);
        deliveredCount++;
        return { expired: false, delivered: true };
      } else if (status >= 500) {
        // Push service temporarily down — not the user's fault; treat as delivered (optimistic)
        console.warn(`[WebPush] ⚠ Endpoint #${idx + 1} for <${targetUsername}> push service error (${status}) — may retry`);
        deliveredCount++;
        return { expired: false, delivered: true };
      } else {
        // 401, 403, network errors, etc — log full details for debugging
        console.error(`[WebPush] ✖ Failed at endpoint #${idx + 1} for <${targetUsername}>:`,
          `status=${status}`, `message=${err.message}`, `body=${body}`,
          `endpoint=${sub.endpoint?.slice(0, 80)}...`
        );
        return { expired: false, delivered: false };
      }
    }
  });

  const results = await Promise.all(promises);
  const expiredEndpoints = results.filter(r => r.expired).map(r => r.endpoint);

  if (expiredEndpoints.length > 0) {
    if (Array.isArray(pushSubscriptions[key])) {
      pushSubscriptions[key] = pushSubscriptions[key].filter(sub => !expiredEndpoints.includes(sub.endpoint));
      if (pushSubscriptions[key].length === 0) {
        delete pushSubscriptions[key];
      }
    } else if (expiredEndpoints.includes(pushSubscriptions[key]?.endpoint)) {
      delete pushSubscriptions[key];
    }
    savePushSubscriptions();
    console.log(`[WebPush] Cleaned up ${expiredEndpoints.length} expired subscription(s) for <${targetUsername}>`);
  }

  console.log(`[WebPush] Result for <${targetUsername}>: ${deliveredCount}/${subArray.length} endpoint(s) accepted the push`);
  return { delivered: deliveredCount > 0, noSubscription: false };
}

/**
 * Pending call timeouts — tracks 30-second ringing windows for push-woken calls.
 * Key: callerSocketId, Value: { timer, targetUsername }
 */
const pendingCallTimeouts = {};

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

  // Initialize/migrate subscription to array format
  if (!Array.isArray(pushSubscriptions[key])) {
    if (pushSubscriptions[key] && typeof pushSubscriptions[key] === 'object' && pushSubscriptions[key].endpoint) {
      pushSubscriptions[key] = [pushSubscriptions[key]];
    } else {
      pushSubscriptions[key] = [];
    }
  }

  // Prevent duplicates of the exact same subscription endpoint
  const index = pushSubscriptions[key].findIndex(sub => sub.endpoint === subscription.endpoint);
  if (index !== -1) {
    pushSubscriptions[key][index] = subscription;
  } else {
    pushSubscriptions[key].push(subscription);
    // Limit to max 5 sessions to prevent stale array leaks
    if (pushSubscriptions[key].length > 5) {
      const excess = pushSubscriptions[key].length - 5;
      pushSubscriptions[key].splice(0, excess);
    }
  }

  savePushSubscriptions();
  console.log(`[WebPush] Subscription saved for <${key}>. Active endpoints: ${pushSubscriptions[key].length}`);
  res.json({ ok: true });
});

/** Client calls this on logout / when revoking permission */
app.delete('/api/push/subscribe', (req, res) => {
  const { username, subscription } = req.body || {};
  if (!username) {
    return res.status(400).json({ error: 'username required' });
  }
  const key = username.trim().toLowerCase();

  if (pushSubscriptions[key]) {
    if (subscription?.endpoint) {
      // Unsubscribe only the specific active browser session
      if (Array.isArray(pushSubscriptions[key])) {
        pushSubscriptions[key] = pushSubscriptions[key].filter(sub => sub.endpoint !== subscription.endpoint);
        if (pushSubscriptions[key].length === 0) {
          delete pushSubscriptions[key];
        }
      } else if (pushSubscriptions[key].endpoint === subscription.endpoint) {
        delete pushSubscriptions[key];
      }
    } else {
      // Complete unsubscribe/signout of all devices
      delete pushSubscriptions[key];
    }
    savePushSubscriptions();
    console.log(`[WebPush] Unsubscribed active session for <${key}>`);
  }
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
  maxHttpBufferSize: 1e7, // 10MB buffer limit to support high-res Base64 profile pics
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
    // Broadcast real-time presence change to all clients
    io.emit('presence_update', { username: key, online: true });
    // Deliver currently connected online users list back to caller
    socket.emit('online_users_list', Object.keys(onlineUsers));
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
      existing.profilePic = typeof userAlias?.profilePic === 'string' ? userAlias.profilePic.slice(0, 2000000) : existing.profilePic;
      existing.bio = typeof userAlias?.bio === 'string' ? userAlias.bio.slice(0, 240) : existing.bio;
      existing.isSharingScreen = userAlias?.isSharingScreen ?? existing.isSharingScreen;
    } else {
      // Add socket client as new participant
      const newParticipant = {
        id: socket.id,
        name: userAlias?.name || `Anonymous-${socket.id.substring(0, 4)}`,
        avatar: userAlias?.avatar || '👤',
        profilePic: typeof userAlias?.profilePic === 'string' ? userAlias.profilePic.slice(0, 2000000) : '',
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
      participant.profilePic = typeof userAlias.profilePic === 'string' ? userAlias.profilePic.slice(0, 2000000) : participant.profilePic;
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
  // If target is online: deliver via socket (instant).
  // If target is offline: attempt Web Push to wake their service worker.
  //   - If push delivered: hold ringing for 30s waiting for response.
  //   - If push failed: immediately report 'offline' (device unreachable).
  socket.on('call_invite', async ({ targetUsername, callerName, callerUsername, room, callType }) => {
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
      // User is offline — attempt Web Push to wake their service worker
      console.log(`[Call] <${targetUsername}> is offline — attempting Web Push wake-up`);

      const pushResult = await sendPush(key, {
        type:      'session',
        sender:    invitePayload.callerName,
        body:      'NexaLink requesting an active session',
        room:      invitePayload.room,
        callType:  invitePayload.callType,
      });

      if (pushResult.delivered) {
        // Push reached the service worker → hold ringing for 30 seconds
        console.log(`[Call] Push delivered to <${targetUsername}> — ringing via push for 30s`);
        socket.emit('call_ringing_push', { targetUsername, message: 'Notification sent — waiting for response...' });

        // Clear any existing timeout for this caller
        if (pendingCallTimeouts[socket.id]) {
          clearTimeout(pendingCallTimeouts[socket.id].timer);
        }

        // Set a 30-second timeout
        const timer = setTimeout(() => {
          console.log(`[Call] 30s timeout expired for <${targetUsername}> — no response after push`);
          socket.emit('call_invite_timeout', { targetUsername, message: 'No response — user did not answer.' });
          delete pendingCallTimeouts[socket.id];
        }, 30000);

        pendingCallTimeouts[socket.id] = { timer, targetUsername: key };
      } else {
        // Push failed — device is off or no subscription registered
        const reason = pushResult.noSubscription
          ? 'User has no registered device — notifications cannot be delivered.'
          : 'Device is unreachable — it may be powered off or disconnected.';
        console.log(`[Call] Push FAILED for <${targetUsername}> — ${reason}`);
        socket.emit('call_invite_failed', { reason: 'offline', targetUsername, detail: reason });
      }
    }
  });

  // Target responds: accepted | declined | merged
  // Payload: { callerId, response: 'accepted'|'declined'|'merged' }
  // Also clears any pending push-ringing timeout for the caller.
  socket.on('call_response', ({ callerId, response }) => {
    if (typeof callerId !== 'string') return;
    const allowed = ['accepted', 'declined', 'merged'];
    const safeResponse = allowed.includes(response) ? response : 'declined';

    // Clear the 30s push-ringing timeout if the callee responded in time
    if (pendingCallTimeouts[callerId]) {
      clearTimeout(pendingCallTimeouts[callerId].timer);
      delete pendingCallTimeouts[callerId];
      console.log(`[Call] Cleared push-ringing timeout for caller <${callerId}> — callee responded: ${safeResponse}`);
    }

    io.to(callerId).emit('call_response', { response: safeResponse, responderId: socket.id });
    console.log(`[Call] Response from <${socket.id}> to <${callerId}>: ${safeResponse}`);
  });

  // Caller cancels before target responds — also clears push-ringing timeout
  socket.on('call_cancel', ({ targetUsername }) => {
    if (typeof targetUsername !== 'string') return;
    const targetSocketId = onlineUsers[targetUsername.trim().toLowerCase()];
    if (targetSocketId) {
      io.to(targetSocketId).emit('call_cancelled', { callerId: socket.id });
    }
    // Clear the 30s push-ringing timeout if caller cancels
    if (pendingCallTimeouts[socket.id]) {
      clearTimeout(pendingCallTimeouts[socket.id].timer);
      delete pendingCallTimeouts[socket.id];
      console.log(`[Call] Caller cancelled — cleared push-ringing timeout for <${targetUsername}>`);
    }
  });

  socket.on('leave_room', () => {
    if (currentRoom) {
      socket.leave(currentRoom);
      removeParticipant(currentRoom, socket.id);
      currentRoom = null;
    }
  });

  socket.on('add_contact', ({ targetUsername, addedBy }) => {
    if (typeof targetUsername !== 'string' || typeof addedBy !== 'string') return;
    const key = targetUsername.trim().toLowerCase();
    const targetSocketId = onlineUsers[key];
    if (targetSocketId) {
      io.to(targetSocketId).emit('contact_added_notification', { addedBy });
      console.log(`[Presence] Contact alert sent: ${addedBy} -> ${targetUsername}`);
    } else {
      // Offline — send Web Push so the user knows they were added
      console.log(`[Presence] <${targetUsername}> is offline — sending Web Push for add_contact`);
      sendPush(key, {
        type:   'contact',
        sender: addedBy,
        body:   `${addedBy} added you as a contact on NexaLink`,
      });
    }
  });

  socket.on('direct_message', ({ targetUsername, senderUsername, senderName, text, time }) => {
    if (typeof targetUsername !== 'string' || typeof text !== 'string' || !text.trim()) return;
    const key = targetUsername.trim().toLowerCase();
    const targetSocketId = onlineUsers[key];
    
    if (targetSocketId) {
      io.to(targetSocketId).emit('direct_message', { senderUsername, senderName, text, time });
      console.log(`[Presence] Direct message routed to ${targetUsername}`);
    } else {
      // Offline — send Web Push with the actual message preview
      const displaySender = senderName || senderUsername || 'Peer';
      sendPush(key, {
        type: 'chat',
        sender: displaySender,
        body: text.slice(0, 120),
      });
    }
  });

  // --- Secure File Transfer Relays ---
  socket.on('file_transfer_initiate', ({ transferId, senderUsername, recipientUsername, fileName, fileSize, fileType }) => {
    if (typeof recipientUsername !== 'string' || !recipientUsername.trim()) return;
    const key = recipientUsername.trim().toLowerCase();
    const targetSocketId = onlineUsers[key];

    const payload = {
      transferId,
      senderUsername,
      recipientUsername,
      fileName,
      fileSize,
      fileType
    };

    if (targetSocketId) {
      console.log(`[FileTransfer] Initiated from <${senderUsername}> to online <${recipientUsername}> — ID: ${transferId}`);
      io.to(targetSocketId).emit('file_transfer_request', payload);
    } else {
      console.log(`[FileTransfer] Target <${recipientUsername}> is offline — queueing on server and sending Web Push`);
      sendPush(key, {
        type: 'file_transfer',
        sender: senderUsername,
        body: 'NexaLink incoming secure file transfer',
        fileName,
        fileSize,
        transferId
      });
    }
  });

  socket.on('file_transfer_response', ({ transferId, status, recipientUsername, senderUsername }) => {
    if (typeof senderUsername !== 'string') return;
    const key = senderUsername.trim().toLowerCase();
    const targetSocketId = onlineUsers[key];
    if (targetSocketId) {
      console.log(`[FileTransfer] Response for ID ${transferId} from <${recipientUsername}>: ${status}`);
      io.to(targetSocketId).emit('file_transfer_response', { transferId, status, recipientUsername });
    }
  });

  socket.on('file_offer', ({ targetUsername, offer, senderUsername }) => {
    if (typeof targetUsername !== 'string') return;
    const key = targetUsername.trim().toLowerCase();
    const targetSocketId = onlineUsers[key];
    if (targetSocketId) {
      io.to(targetSocketId).emit('file_offer', { fromUsername: senderUsername, offer });
    }
  });

  socket.on('file_answer', ({ targetUsername, answer, senderUsername }) => {
    if (typeof targetUsername !== 'string') return;
    const key = targetUsername.trim().toLowerCase();
    const targetSocketId = onlineUsers[key];
    if (targetSocketId) {
      io.to(targetSocketId).emit('file_answer', { fromUsername: senderUsername, answer });
    }
  });

  socket.on('file_ice_candidate', ({ targetUsername, candidate, senderUsername }) => {
    if (typeof targetUsername !== 'string') return;
    const key = targetUsername.trim().toLowerCase();
    const targetSocketId = onlineUsers[key];
    if (targetSocketId) {
      io.to(targetSocketId).emit('file_ice_candidate', { fromUsername: senderUsername, candidate });
    }
  });

  socket.on('file_transfer_cancel', ({ transferId, targetUsername, senderUsername }) => {
    if (typeof targetUsername !== 'string') return;
    const key = targetUsername.trim().toLowerCase();
    const targetSocketId = onlineUsers[key];
    if (targetSocketId) {
      console.log(`[FileTransfer] Cancellation for ID ${transferId} relayed from <${senderUsername}> to <${targetUsername}>`);
      io.to(targetSocketId).emit('file_transfer_cancel', { transferId, senderUsername });
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Signalling] Client disconnected: ${socket.id}`);

    // Clean up any pending push-ringing timeout for this caller
    if (pendingCallTimeouts[socket.id]) {
      clearTimeout(pendingCallTimeouts[socket.id].timer);
      delete pendingCallTimeouts[socket.id];
      console.log(`[Call] Cleaned up push-ringing timeout for disconnected caller <${socket.id}>`);
    }

    // Clean presence registry
    if (registeredUsername && onlineUsers[registeredUsername] === socket.id) {
      delete onlineUsers[registeredUsername];
      console.log(`[Presence] ${registeredUsername} went offline`);
      // Broadcast presence change to all clients
      io.emit('presence_update', { username: registeredUsername, online: false });
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
