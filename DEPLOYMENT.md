# 🚀 NexaLink Production Cloud Deployment Context

This document serves as the official operational manual and system context for the live cloud deployment of the NexaLink P2P secure messenger application ecosystem.

---

## 🌐 Production Environment Map

The entire stack is deployed across highly specialized, distributed free-tier platforms to optimize latency, support persistent WebSocket sessions, cache static elements globally, and maintain database security.

| Service | Component | Platform | Live Production URL |
| :--- | :--- | :--- | :--- |
| **Frontend Web Client** | `/client` | **Vercel** | `https://my-call-app-pi.vercel.app` |
| **Backend REST API** | `/server` | **Render** | `https://nexalink-backend-xjx6.onrender.com` |
| **Signalling WebSocket Server** | `/signalling` | **Render** | `https://nexalink-signalling.onrender.com` |
| **Relational Database & Auth** | `/infra` | **Supabase** | `https://uejwhikwtjikrsbnaabo.supabase.co` |

---

## 🎨 Global Communication Architecture

```mermaid
graph TD
    %% Styling
    classDef client fill:#312e81,stroke:#818cf8,stroke-width:2px,color:#fff;
    classDef server fill:#1e1b4b,stroke:#4f46e5,stroke-width:2px,color:#fff;
    classDef db fill:#064e3b,stroke:#059669,stroke-width:2px,color:#fff;
    classDef peer fill:#1c1917,stroke:#78716c,stroke-width:2px,color:#fff;

    %% Nodes
    A[Vite/React Client <br> Hosted on Vercel]:::client
    B[FastAPI Python Backend <br> Hosted on Render]:::server
    C[WebRTC Signalling Server <br> Hosted on Render]:::server
    D[Supabase Database <br> Hosted on Supabase Cloud]:::db
    E[Peer Browser <br> User B]:::peer

    %% Connections
    A -- "1. REST HTTPS APIs" --> B
    A -- "2. Persistent WebSocket" --> C
    B -- "3. Pooler Connections" --> D
    C -- "4. Audit Logs REST" --> D
    C -- "5. WebSocket Signalling Relay" --> E
    A <.== "6. WebRTC Secure P2P Tunnel <br> (Audio, Video, Whiteboard)" .==> E
```

---

## 🔑 Configured Environment Variables

### 1. Web Client (Vercel Project Settings &rarr; Environments)
These keys compile into the static client to route API traffic securely to your live servers:
* `VITE_API_URL` &rarr; `https://nexalink-backend-xjx6.onrender.com`
* `VITE_WS_URL` &rarr; `https://nexalink-signalling.onrender.com`

### 2. Backend REST API (Render Settings &rarr; Environment Variables)
* `SUPABASE_URL` &rarr; `https://uejwhikwtjikrsbnaabo.supabase.co`
* `SUPABASE_ANON_KEY` &rarr; (Your masked Supabase anon key)
* `DATABASE_URL` &rarr; `postgresql://postgres.uejwhikwtjikrsbnaabo:Aryanrajsinha801@aws-1-ap-south-1.pooler.supabase.com:6543/postgres`
* `JWT_SECRET_KEY` &rarr; `3f8a2c1d9e7b4f6a0d5c8e2b1a9f3d7e4c6b0a8f2e5d1c9b7a4f3e6d0c2b8a5f`
* `ENV` &rarr; `production`
* `CORS_ORIGINS` &rarr; `https://my-call-app-pi.vercel.app` (restricts API access only to your frontend domain)

### 3. Signalling WebSocket Server (Render Settings &rarr; Environment Variables)
* `PORT` &rarr; `8000`
* `SUPABASE_URL` &rarr; `https://uejwhikwtjikrsbnaabo.supabase.co`
* `SUPABASE_ANON_KEY` &rarr; (Your masked Supabase anon key)
* `ALLOWED_ORIGIN` &rarr; `https://my-call-app-pi.vercel.app` (enforces WebSocket socket origins check)
* `VAPID_PUBLIC_KEY` &rarr; `BH6MzhQZspefYizh2fqf4sekOsVWaDXUd31RNyACDGgecTC31eAvA4iGS_MyzpYknuNXgx2zojIUSQ3M9ubtshA`
* `VAPID_PRIVATE_KEY` &rarr; `0EhREuRxRzyg-Bv2Ot2r5IT5eGlWnSUkE6sZoLIS_9s`
* `VAPID_EMAIL` &rarr; `mailto:admin@nexalink.app`

---

## 🛠️ Verification Command Routines

To perform regression testing or confirm that local changes are ready for automatic pipeline deployment, execute the following commands in order:

1. **Database Catalog Checks**:
   ```bash
   python server/db_optimize.py
   ```
2. **TypeScript Compilation (Must return 0 errors)**:
   ```bash
   cd client && npx tsc --noEmit
   ```
3. **Production Static Compilation**:
   ```bash
   cd client && npm run build
   ```

---

## 🏁 Auto-Deployment Pipelines
All three hosting platforms (**Vercel** and **Render**) are directly integrated with your GitHub repository `main` branch. 
* Any commit pushed to the remote repository (`git push origin main`) will automatically trigger parallel build and redeploy processes, keeping your cloud instances completely updated without manual intervention!
