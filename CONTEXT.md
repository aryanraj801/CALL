# NexaLink — Full-Stack Context Document

> **Purpose:** This file is the single source of truth for any AI assistant, developer, or contributor
> who needs to understand the NexaLink codebase quickly. Read this before touching any file.

---

## 1. What Is NexaLink?

NexaLink is a **military-grade, E2EE real-time communication platform** — think a self-hosted,
privacy-first alternative to Google Meet + WhatsApp combined. It supports:

- 🎥 HD video/voice calls with WebRTC (peer-to-peer, no media relay needed)
- 💬 Room chat and persistent 1-to-1 direct messages
- 🖥️ Screen sharing with remote control (mouse + keyboard injection)
- 🗂️ Collaborative whiteboard (multi-user drawing)
- 📋 AI meeting transcription and action-item extraction
- 🔔 Background push notifications (Web Push API / Service Worker)
- 📞 Call log history per user pair
- 🖥️ Electron desktop agent with system-tray emergency kill switch
- 🔐 JWT authentication backed by Supabase Auth

---

## 2. Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                         USER'S BROWSER                                  │
│  React + Vite SPA  (port 3000)                                          │
│  App.tsx — single-file monolith, ~2800 lines                            │
│  Hooks: useWebRTC | useAudioPipeline | useNotifications                 │
│  Components: Whiteboard | ChaperoneOverlay                              │
│  Service Worker: public/sw.js  (Web Push, background notifications)     │
└────────┬──────────────────────────┬────────────────────────────────────┘
         │ WebSocket (Socket.IO)    │ REST (fetch)
         ▼                         ▼
┌─────────────────┐     ┌────────────────────────┐     ┌─────────────────┐
│  Signalling Srv │     │  API Gateway (FastAPI)  │     │  AI Sidecar     │
│  Node.js+Express│     │  Python 3.10+           │     │  Python FastAPI │
│  Socket.IO      │     │  port 8001              │     │  port 8002      │
│  port 8000      │     │  JWT auth               │     │  Whisper ASR    │
│  web-push       │     │  Supabase DB layer      │     │  Coqui TTS      │
└────────┬────────┘     └──────────┬─────────────┘     └────────┬────────┘
         │ STUN/TURN               │ REST (urllib)               │
         │ (WebRTC ICE)            ▼                             │
         │               ┌──────────────────┐                   │
         │               │  Supabase Cloud  │                   │
         │               │  PostgreSQL + RLS│                   │
         │               │  + Supabase Auth │                   │
         │               └──────────────────┘                   │
         │                                                       │
         ▼ (local)                                              │
┌─────────────────┐                                            │
│  Electron Agent │◄───────────────────────────────────────────┘
│  port N/A       │  (Socket.IO client connecting to :8000)
│  System Tray    │
│  Global Hotkeys │
└─────────────────┘
```

---

## 3. Services & Ports

| Service | Tech | Port | Start command |
|---|---|---|---|
| **Signalling Server** | Node.js + Express + Socket.IO | 8000 | `node server.js` |
| **API Gateway** | Python FastAPI + uvicorn | 8001 | `uvicorn main:app --port 8001` |
| **AI Sidecar** | Python FastAPI + uvicorn | 8002 | `uvicorn main:app --port 8002` |
| **React Client** | Vite + React + TypeScript | 3000 | `npm run dev` |
| **Desktop Agent** | Electron | — | `npm start` |

> **One-command launch:** `start.bat` (Windows) — launches all 5 services in separate terminal windows.  
> **One-command shutdown:** `stop.bat`

### 🌐 Cloud Production URLs
* **Frontend Web Client (Vercel)**: `https://my-call-app-pi.vercel.app`
* **API Gateway Backend (Render)**: `https://nexalink-backend-xjx6.onrender.com`
* **Signalling Server (Render)**: `https://nexalink-signalling.onrender.com`
* **Supabase Cloud Project**: `https://uejwhikwtjikrsbnaabo.supabase.co`

---

## 4. Directory Structure

```
e:\calls\
├── start.bat                   # Launches all 5 services
├── stop.bat                    # Kills all service PIDs
├── CONTEXT.md                  # ← YOU ARE HERE
├── DEPLOYMENT.md               # Live Cloud Deployment Map & Configs
│
├── client/                     # React front-end (Vite + TypeScript)
│   ├── public/
│   │   ├── sw.js               # Service Worker — Web Push background notifications
│   │   └── icon-192.png        # Notification badge icon
│   ├── src/
│   │   ├── main.tsx            # React entry point — mounts <App />
│   │   ├── App.tsx             # ENTIRE UI in one file (~2800 lines)
│   │   ├── index.css           # Global design system (CSS variables, dark theme)
│   │   ├── hooks/
│   │   │   ├── useWebRTC.ts        # WebRTC + Socket.IO lifecycle
│   │   │   ├── useAudioPipeline.ts # Noise suppression + VAD + equaliser
│   │   │   └── useNotifications.ts # Web Push subscription + SW registration
│   │   ├── components/
│   │   │   ├── Whiteboard.tsx      # Collaborative canvas (multi-user drawing)
│   │   │   └── ChaperoneOverlay.tsx # Remote control safety overlay
│   │   └── lib/                    # Shared utilities
│   ├── .env                    # VITE_API_URL, VITE_WS_URL, VITE_AI_URL
│   └── vite.config.ts
│
├── signalling/                 # Node.js Socket.IO relay server
│   ├── server.js               # ALL signalling logic (single file, ~500 lines)
│   └── package.json            # deps: express, socket.io, cors, dotenv, web-push
│
├── server/                     # FastAPI REST API Gateway
│   ├── main.py                 # ALL endpoints (single file, ~550 lines)
│   ├── requirements.txt
│   ├── .env                    # SUPABASE_URL, SUPABASE_ANON_KEY, JWT_SECRET_KEY, VAPID_*
│   └── db/
│       ├── supabase_api.py     # All Supabase REST calls (urllib, no SDK)
│       ├── models.py           # SQLAlchemy models (reference only, not used at runtime)
│       ├── session.py          # SQLAlchemy session (reference only)
│       └── auth_utils.py       # Password utils
│
├── ai-sidecar/                 # Python microservice for AI features
│   ├── main.py                 # ASR transcription + TTS synthesis + action extraction
│   └── requirements.txt
│
├── desktop-agent/              # Electron system-tray app
│   ├── main.js                 # Electron main process + WS client + global hotkeys
│   └── dashboard.html          # Simple status UI shown in Electron window
│
└── infra/
    ├── migrations/
    │   └── supabase_schema.sql # Full DB schema — run once in Supabase SQL Editor
    ├── compliance/
    │   └── gdpr_data_policy.md
    └── tests/                  # Integration tests
```

---

## 5. Front-End: `App.tsx` Structure

The entire front-end lives in **one file**: `e:\calls\client\src\App.tsx`.

### Views (controlled by `currentView` state)

```
'landing'    → Auth page (login / register)
'lobby'      → Hub: room creation, contacts, direct messages, inbox notifications
'connecting' → Pre-call setup page (camera/mic test before joining)
'room'       → Active call view
```

### Lobby Sub-Views (controlled by `lobbySubView`)

```
'connect'    → Room creation card + contact list + call controls
'chat_lobby' → 1-to-1 direct message interface with all contacts
```

### Key State Variables

| State | Type | Purpose |
|---|---|---|
| `authToken` | `string \| null` | JWT from Supabase — null means not logged in |
| `userName` | `string` | Current user's username |
| `currentView` | `'landing' \| 'lobby' \| 'connecting' \| 'room'` | Which page is shown |
| `lobbySubView` | `'connect' \| 'chat_lobby'` | Sub-view within lobby |
| `roomName` | `string` | Room to join/create |
| `callType` | `'video' \| 'voice'` | Type of call |
| `inRoom` | `boolean` | Whether the user is currently in an active call |
| `contacts` | `Contact[]` | Contact list (stored in localStorage) |
| `lobbyChats` | `{ [username]: ChatMessage[] }` | In-memory 1-to-1 chat (persisted in DB) |
| `unreadChatCounts` | `{ [username]: number }` | Badge counts on contact list |
| `inboxNotifications` | `InboxItem[]` | Notification inbox (calls, msgs) |
| `incomingCall` | `IncomingCallData \| null` | Incoming call modal data |
| `chatMessages` | `ChatMessage[]` | Room chat messages (ephemeral) |
| `activeTab` | `Tab` | Right panel tab in room view |
| `streamLayout` | `'auto' \| 'pip-remote' \| 'pip-local' \| 'equal' \| 'horizontal'` | Video layout |
| `notifPermission` | `NotificationPermission` | OS push permission state |

### Hooks Used in App.tsx

```typescript
const { requestPermission, unsubscribe, notify } = useNotifications();
const {
  isConnected, localStream, screenStream, audioEnabled, videoEnabled,
  participants, myAlias, controlledBy, isControllingTarget,
  grantedAccessType, socket, stats, volPercent,
  // ... many more WebRTC control fns
} = useWebRTC(roomName, userName, profile);
const { noiseEnabled, vadEnabled, ... } = useAudioPipeline(localStream);
```

---

## 6. Signalling Server: `signalling/server.js`

Single Node.js file. Uses **Socket.IO** for all real-time events.

### In-Memory State

```javascript
roomParticipants  // { [roomId]: Participant[] }  — who is in each room
onlineUsers       // { [username]: socketId }      — presence registry
pushSubscriptions // { [username]: PushSubscription } — Web Push subs
```

### Socket.IO Events (Client → Server)

| Event | Payload | Purpose |
|---|---|---|
| `register_username` | `{ username }` | Register presence on login |
| `join` | `{ roomName, userAlias }` | Join a room |
| `leave` | — | Leave current room |
| `offer` | `{ to, offer }` | WebRTC SDP offer to peer |
| `answer` | `{ to, answer }` | WebRTC SDP answer |
| `ice_candidate` | `{ to, candidate }` | ICE candidate exchange |
| `chat_message` | `{ roomName, sender, text, time }` | Room chat message |
| `tts_message` | `{ roomName, sender, text, voice }` | TTS relay |
| `whiteboard_stroke` | `{ roomName, stroke }` | Whiteboard draw event |
| `whiteboard_clear` | `{ roomName }` | Clear whiteboard |
| `screen_share_start` | `{ roomName }` | Announce screen share started |
| `screen_share_stop` | `{ roomName }` | Announce screen share stopped |
| `update_alias` | `{ userAlias }` | Update display name/avatar |
| `remote_control_request` | `{ targetSocketId, requesterName, accessType }` | Request control |
| `remote_control_grant` | `{ requesterSocketId, accessType }` | Grant control |
| `remote_control_revoke` | `{ targetSocketId }` | Revoke control |
| `remote_input` | `{ targetSocketId, inputType, data }` | Send mouse/keyboard events |
| `call_invite` | `{ targetUsername, callerName, room, callType }` | Initiate direct call |
| `call_response` | `{ callerId, response }` | Accept/decline call |
| `call_cancel` | `{ targetUsername }` | Cancel outgoing call |
| `control_revoke` | — | Emergency kill (from desktop agent) |

### Socket.IO Events (Server → Client)

| Event | Payload | Purpose |
|---|---|---|
| `joined` | `{ participants }` | Confirmed room join + roster |
| `peer_joined` | `{ participant }` | New peer in room |
| `peer_left` | `{ participantId }` | Peer left room |
| `participants_changed` | `Participant[]` | Updated room roster |
| `offer` | `{ from, offer }` | WebRTC offer from peer |
| `answer` | `{ from, answer }` | WebRTC answer from peer |
| `ice_candidate` | `{ from, candidate }` | ICE candidate from peer |
| `chat_message` | `{ sender, text, time }` | Incoming room chat |
| `tts_message` | `{ sender, text, voice }` | Incoming TTS relay |
| `whiteboard_stroke` | `{ stroke, from }` | Peer drew on whiteboard |
| `whiteboard_clear` | — | Peer cleared whiteboard |
| `screen_share_started` | `{ participantId }` | Someone started sharing |
| `screen_share_stopped` | `{ participantId }` | Someone stopped sharing |
| `remote_control_requested` | `{ requesterName, requesterSocketId, accessType }` | Someone wants control |
| `remote_control_granted` | `{ grantedBy, accessType, hostSocketId }` | Control was granted |
| `remote_control_revoked` | — | Control was revoked |
| `remote_input` | `{ inputType, data }` | Incoming mouse/keyboard event |
| `incoming_call` | `{ callerName, callerId, room, callType }` | Someone is calling you |
| `call_response` | `{ response }` | Other party's call response |
| `call_invite_failed` | `{ reason, targetUsername }` | Call failed (offline) |
| `call_cancelled` | — | Caller cancelled call |

### HTTP Endpoints (Signalling Server)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/vapid-public-key` | Returns VAPID public key for Push subscription |
| `POST` | `/api/push/subscribe` | Save user's PushSubscription |
| `DELETE` | `/api/push/subscribe` | Remove user's PushSubscription on logout |

---

## 7. API Gateway: `server/main.py`

FastAPI application. All endpoints except `/api/health`, `/api/auth/register`, and `/api/auth/token`
require a **Bearer JWT** in the `Authorization` header.

### Auth Endpoints

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/auth/register` | `{username, email, password}` | `{status, username}` |
| `POST` | `/api/auth/token` | `{username, password}` | `{access_token, username, expires_in}` |

### Room Endpoints

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/rooms/create` | `{room_name, ephemeral_mode, ...}` | `{room_id, room_name}` |
| `POST` | `/api/rooms/join` | `{room_id, room_name, username}` | `{status}` |
| `POST` | `/api/rooms/leave` | `{room_id, username}` | `{status}` |
| `GET` | `/api/rooms/history` | — | `[CallLog]` |

### Direct Messages Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/dm/send` | Send & persist a direct message (sender from JWT) |
| `GET` | `/api/dm/history/{other_user}` | Load full conversation history |
| `PUT` | `/api/dm/read/{other_user}` | Mark all messages from other_user as read |

### Direct Call Logs Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/calls/log` | Log a call attempt (caller from JWT) |
| `PATCH` | `/api/calls/update` | Update call status (accepted/declined/missed) + end time |
| `GET` | `/api/calls/history/{other_user}` | Get call log between me and other_user |

### Profile Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/profile/save` | Save bio + profile picture (base64) |
| `GET` | `/api/profile/{username}` | Get any user's profile |

### AI / Meeting Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/ai/summary` | Save meeting summary + action items |
| `GET` | `/api/ai/summaries/{room_name}` | Get past summaries for a room |
| `POST` | `/api/ai/search` | Semantic search over summaries (vector) |
| `POST` | `/api/whiteboard/save` | Save whiteboard snapshot URL |
| `GET` | `/api/whiteboard/list/{room_name}` | List whiteboard snapshots |

---

## 8. AI Sidecar: `ai-sidecar/main.py`

Runs on port 8002. Three endpoints:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/ai/health` | Status check |
| `POST` | `/api/ai/transcribe` | Transcribe audio file (Whisper / simulated) |
| `POST` | `/api/ai/tts` | Generate speech from text (Coqui XTTS-v2 / simulated) |
| `POST` | `/api/ai/actions` | Extract action items from transcript (regex NLP) |

**Current state:** Simulated responses — real Whisper/XTTS integration is scaffolded but depends on
model weights being downloaded. Set `OPENAI_API_KEY` in env to enable OpenAI Whisper fallback.

---

## 9. Desktop Agent: `desktop-agent/main.js`

Electron app that:
1. Shows a `dashboard.html` status window
2. Creates a **system tray** icon with context menu
3. Connects to the signalling server at `ws://localhost:8000` via Socket.IO
4. Registers a **global OS hotkey** `Ctrl+Shift+K` → emits `control_revoke` to kill any
   active remote control session immediately, even when the browser tab is in the background

---

## 10. Database Schema (Supabase PostgreSQL)

Run `infra/migrations/supabase_schema.sql` once in the Supabase SQL Editor.

### Tables

| Table | Purpose | Key Columns |
|---|---|---|
| `user_profiles` | Extended auth profile | `username`, `bio`, `profile_pic`, `email` |
| `rooms` | Room session metadata | `id`, `room_name`, `ephemeral_mode`, `created_at` |
| `call_logs` | Who joined/left which room | `room_id`, `username`, `joined_at`, `left_at` |
| `recording_consents` | GDPR consent audit trail | `room_name`, `participant_id`, `consent_granted` |
| `meeting_summaries` | AI-generated summaries | `room_name`, `transcript`, `summary`, `action_items` (JSONB), `transcript_embedding` (vector) |
| `whiteboard_saves` | Snapshot URLs | `room_name`, `url`, `saved_by` |
| `direct_messages` | Persistent 1-to-1 chat | `conversation_key`, `sender`, `recipient`, `text`, `sent_at`, `read` |
| `direct_call_logs` | Per-pair call history | `conversation_key`, `caller`, `callee`, `call_type`, `status`, `started_at`, `ended_at` |

### `conversation_key` convention

All direct message and call log records use a **deterministic sorted key** to ensure
A→B and B→A map to the same row. It is computed as:

```python
"|".join(sorted([user_a.lower(), user_b.lower()]))
# e.g., alice + bob → "alice|bob"
```

### All tables use RLS (Row Level Security) — currently set to `FOR ALL USING (true)` for development.
**Lock down RLS policies before production deployment.**

---

## 11. Web Push / Background Notifications

### Flow

```
1. User logs in → App calls requestPermission(username)
2. Hook registers service worker (public/sw.js)
3. Hook fetches VAPID public key from signalling server: GET /vapid-public-key
4. Hook calls pushManager.subscribe({ applicationServerKey })
5. Hook POSTs PushSubscription to signalling server: POST /api/push/subscribe
   → Stored in pushSubscriptions[username] in-memory map

When an event fires for an OFFLINE user:
6. Signalling server calls sendPush(username, payload)
7. sendPush() calls webpush.sendNotification() with the stored subscription
8. Browser push service (Google FCM / Mozilla) delivers to the user's browser
9. sw.js receives 'push' event → calls self.registration.showNotification()

When user CLICKS the notification:
10. sw.js 'notificationclick' handler fires
11. If browser tab is open → postMessage({ type: 'PUSH_NAVIGATE', room })
    If browser is closed → clients.openWindow(url?room=X&auto=1)
12. App.tsx listens for 'nexalink:navigate' custom event OR reads ?room= URL param
13. App auto-joins the room via connectToRoom()
```

### Notification Payloads

```javascript
// Chat message
{ type: 'update', sender, body: 'NexaLink received an update', room }

// Incoming call
{ type: 'session', sender, body: 'NexaLink requesting an active session', room, callType }
```

### VAPID Keys

Generated once:
```bash
node --input-type=module -e "import wp from 'web-push'; const k=wp.generateVAPIDKeys(); console.log(JSON.stringify(k));"
```

Stored in:
- `signalling/.env` → `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`
- `server/.env` → same keys
- `client/.env` → `VITE_VAPID_PUBLIC_KEY` (public key only — safe to expose)

> ⚠️ **Never regenerate VAPID keys after deployment** — all existing subscriptions become invalid.

---

## 12. WebRTC Flow

```
Peer A joins room
    → emits 'join' to signalling server
    → server emits 'peer_joined' to all existing peers

Peer B (existing in room) receives 'peer_joined'
    → creates RTCPeerConnection for A
    → creates SDP offer → emits 'offer' to signalling server
    → server relays 'offer' to A

Peer A receives 'offer'
    → creates RTCPeerConnection for B
    → creates SDP answer → emits 'answer'
    → server relays 'answer' to B

Both sides exchange ICE candidates via 'ice_candidate' events

Media streams flow directly P2P via DTLS-SRTP (encrypted)
```

---

## 13. Remote Control Flow

Remote control only appears when **screen sharing is active** on one side.

```
Requester (B) clicks "Request Control" on sharer's stream (A is sharing)
    → B chooses: mouse | keyboard | both
    → B emits 'remote_control_request' → signalling relays to A

A receives 'remote_control_requested' modal
    → A accepts → emits 'remote_control_grant' → relays to B

B receives 'remote_control_granted'
    → B's mouse/keyboard events are captured
    → Each event emitted as 'remote_input' → relayed to A
    → A applies synthetic events to DOM

Override rule: If A (the host) moves mouse or types keyboard, control is
immediately suspended. A's native input takes priority.

Kill switches:
    1. Either party clicks "Revoke" → 'remote_control_revoke' event
    2. Desktop Agent global hotkey Ctrl+Shift+K → 'control_revoke' event
    3. ChaperoneOverlay visible on host screen at all times showing who has control
```

---

## 14. Incoming Call Flow

```
Caller A selects contact B from contact list
    → A emits 'call_invite' to signalling server
    → Server checks onlineUsers[B.username]
    
    If B is online:
        → Server emits 'incoming_call' to B's socket
        → B sees IncomingCallModal (accept / decline / merge)
        → B's response emitted as 'call_response' back to A
    
    If B is offline:
        → Server calls sendPush(B, { type: 'session', ... })
        → Web Push notification delivered to B's device
        → When B clicks notification → browser opens ?room=X&auto=1
        → App auto-joins the room

When A calls B who is already in a different room:
    → B sees IncomingCallModal with 3 options:
        1. "Leave & Accept" — leave current room, join new call
        2. "Merge" — stay in current room AND join new call (multi-room)
        3. "Ignore" — dismiss modal, 30s auto-dismiss timeout
```

---

## 15. Stream Layout Options

Inside an active room, the user can switch video layout via the layout picker toolbar:

| ID | Description |
|---|---|
| `auto` | Default grid — equal tiles for all participants |
| `pip-remote` | Remote party large, self small (Picture-in-Picture, bottom-right) |
| `pip-local` | Self large, remote small |
| `equal` | Two equal side-by-side panels |
| `horizontal` | Stacked horizontally (top/bottom split) |

---

## 16. Environment Variables Reference

### `client/.env`

```bash
VITE_API_URL=http://localhost:8001          # FastAPI gateway
VITE_WS_URL=http://localhost:8000           # Signalling server (Socket.IO)
VITE_AI_URL=http://localhost:8002           # AI sidecar
VITE_VAPID_PUBLIC_KEY=BHCb5s1...           # VAPID public key (safe to expose)
```

### `server/.env`

```bash
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
JWT_SECRET_KEY=your-secret-here
ENV=development
CORS_ORIGINS=http://localhost:3000
VAPID_PUBLIC_KEY=BHCb5s1...
VAPID_PRIVATE_KEY=FHCYg...
VAPID_EMAIL=mailto:admin@nexalink.app
```

### `signalling/` (reads from `../server/.env` + own env)

```bash
CORS_ORIGINS=http://localhost:3000
VAPID_PUBLIC_KEY=BHCb5s1...
VAPID_PRIVATE_KEY=FHCYg...
VAPID_EMAIL=mailto:admin@nexalink.app
PORT=8000
```

---

## 17. Design System

Color palette: **"Fresh Peach"** (Figma Combination #21)

```css
--color-primary:   #FFD4AC   /* Warm peach — primary accents */
--color-secondary: #E39A7A   /* Darker peach — hover states */
--color-dark:      #2C2523   /* Near-black warm background */
```

The global design system is in `client/src/index.css`. Key CSS classes:

| Class | Purpose |
|---|---|
| `.glass-card` | Glassmorphism card (backdrop-blur + border) |
| `.nx-btn`, `.nx-btn-primary` | Button system |
| `.nx-input` | Input field |
| `.nx-badge` | Small label/tag |
| `.chat-bubble.self` / `.remote` | Chat message bubbles |
| `.voice-meter` | Audio volume visualiser bar |
| `.lobby-scroll` | Scrollable lobby container |
| `.fade-up` | Entrance animation |
| `.nx-alert` | Alert/notification banner |

---

## 18. Security Measures (SEC- tags in code)

Each fix is tagged with a `SEC-XX` comment in the source:

| Tag | Description |
|---|---|
| SEC-02 | Supabase credentials loaded from env (never hardcoded) |
| SEC-03 | JWT secret loaded from env — server fails to start if missing |
| SEC-04 | All protected endpoints validate Bearer JWT via dependency |
| SEC-05 | URL-encode all DB filter values to prevent PostgREST injection |
| SEC-06 | CORS restricted to explicit origins list (no wildcard) |
| SEC-07 | Electron: `nodeIntegration: false`, `contextIsolation: true` |
| SEC-09 | Authenticated username from JWT used (not client-supplied) |
| SEC-10 | Rate limiting on auth endpoints (5 req/min per IP) |
| SEC-12 | Security headers injected on every response |
| SEC-13 | Internal errors logged server-side, generic message to client |
| SEC-14 | Whiteboard stroke data validated and sanitised |
| SEC-21 | Audio upload: MIME type + file size validated before processing |

---

## 19. Known Limitations & Future Work

| Area | Current State | Future |
|---|---|---|
| Direct messages | DB-backed via REST API + local state | Add real-time socket relay for instant delivery |
| AI Sidecar | Simulated Whisper/TTS responses | Connect real model weights |
| Call merge | Multi-room state is local only | Synchronise via signalling server |
| RLS policies | Open (`USING (true)`) | Lock down per-user policies before production |
| Push subscriptions | In-memory only (lost on server restart) | Persist to `push_subscriptions` DB table |
| TURN server | No TURN configured | Add coturn for NAT traversal in production |
| E2EE room chat | Relay-based (server reads plaintext) | Implement Signal Protocol or Olm |

---

## 20. Quick-Start for New AI Assistants

1. **Run the app:** `start.bat`
2. **Open browser:** `http://localhost:3000`
3. **Register** with any username + email + password
4. **Create a room** from the Connect card in the lobby
5. **Open a second browser** (incognito), register a second user, join the same room

**Key files to edit by feature area:**

| Feature | Primary file(s) |
|---|---|
| UI layout / new views | `client/src/App.tsx` |
| WebRTC media / signalling | `client/src/hooks/useWebRTC.ts` |
| Audio processing | `client/src/hooks/useAudioPipeline.ts` |
| Push notifications | `client/src/hooks/useNotifications.ts` + `client/public/sw.js` |
| Whiteboard | `client/src/components/Whiteboard.tsx` |
| Remote control overlay | `client/src/components/ChaperoneOverlay.tsx` |
| Socket event handlers | `signalling/server.js` |
| REST API endpoints | `server/main.py` |
| Database queries | `server/db/supabase_api.py` |
| DB schema changes | `infra/migrations/supabase_schema.sql` |
| AI features | `ai-sidecar/main.py` |
| Desktop kill-switch | `desktop-agent/main.js` |

---

*Last updated: 2026-05-27 — Updated by Antigravity AI assistant.*
