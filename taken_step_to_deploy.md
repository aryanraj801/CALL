# 📜 NexaLink Cloud Deployment: Chronology of Taken Steps

This document chronicles the exact sequence of actions taken to deploy the secure, multi-tier **NexaLink** real-time communications app to public cloud hosting environments (**Render** + **Vercel** + **Supabase**). Use this as a step-by-step history and playbook for reproducing or updating the production pipeline.

---

## 🗺️ Live Cloud Deployment Overview

The application architecture has been fully distributed across optimized, high-performance cloud providers:

| Service Component | Host Platform | Production URL |
| :--- | :--- | :--- |
| **Frontend Web Client** (`/client`) | **Vercel** | `https://my-call-app-pi.vercel.app` |
| **Backend REST API** (`/server`) | **Render** | `https://nexalink-backend-xjx6.onrender.com` |
| **Signalling WebSocket Server** (`/signalling`) | **Render** | `https://nexalink-signalling.onrender.com` |
| **Relational Database & Auth** | **Supabase** | `https://uejwhikwtjikrsbnaabo.supabase.co` |

---

## 🏁 Step-by-Step Chronicles

### 📦 Phase 1: Cloud Hosting Decisions
1. **Evaluated Koyeb Hosting Options**:
   * Explored Koyeb as a possible deployment target for backend/signalling workloads.
   * Due to free-tier restrictions and convenience of setup for multi-root monorepos, opted for a combination of **Render** (dedicated Python/Node service containers) and **Vercel** (global edge-cached static hosting).

---

### 🐍 Phase 2: Deploying the FastAPI Backend Server on Render
1. Logged into the **Render Dashboard**, clicked **New +**, and chose **Web Service**.
2. Authorized and linked the GitHub repository `CALL` (Branch: `main`).
3. Set the following configuration parameters:
   * **Name**: `nexalink-backend`
   * **Root Directory**: `server`
   * **Runtime**: `Python 3`
   * **Build Command**: `pip install -r requirements.txt`
   * **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   * **Instance Type**: Selected **Free** ($0/month).
4. Clicked **Add from .env** and supplied all necessary security credentials and operational environment variables:
   * `SUPABASE_URL` &rarr; `https://uejwhikwtjikrsbnaabo.supabase.co`
   * `SUPABASE_ANON_KEY` &rarr; *(Supabase anonymous key)*
   * `DATABASE_URL` &rarr; `postgresql://postgres.uejwhikwtjikrsbnaabo:Aryanrajsinha801@aws-1-ap-south-1.pooler.supabase.com:6543/postgres`
   * `JWT_SECRET_KEY` &rarr; `3f8a2c1d9e7b4f6a0d5c8e2b1a9f3d7e4c6b0a8f2e5d1c9b7a4f3e6d0c2b8a5f`
   * `ENV` &rarr; `production`
   * `CORS_ORIGINS` &rarr; `https://my-call-app-pi.vercel.app`
5. Triggered the build and verified the backend compiled successfully. Visited `https://nexalink-backend-xjx6.onrender.com/api/health` to confirm the return payload:
   ```json
   { "status": "ONLINE" }
   ```

---

### 🔌 Phase 3: Deploying the WebRTC Signalling Server on Render
1. Created another **Web Service** on **Render** using the same `CALL` repository.
2. Setup the signalling server parameters:
   * **Name**: `nexalink-signalling`
   * **Root Directory**: `signalling`
   * **Runtime**: `Node`
   * **Build Command**: `npm install`
   * **Start Command**: `node server.js`
   * **Instance Type**: Selected **Free** ($0/month).
3. Provided the WebRTC & Web Push environment variables:
   * `PORT` &rarr; `8000`
   * `SUPABASE_URL` &rarr; `https://uejwhikwtjikrsbnaabo.supabase.co`
   * `SUPABASE_ANON_KEY` &rarr; *(Supabase anonymous key)*
   * `ALLOWED_ORIGIN` &rarr; `https://my-call-app-pi.vercel.app`
   * `VAPID_PUBLIC_KEY` &rarr; `BH6MzhQZspefYizh2fqf4sekOsVWaDXUd31RNyACDGgecTC31eAvA4iGS_MyzpYknuNXgx2zojIUSQ3M9ubtshA`
   * `VAPID_PRIVATE_KEY` &rarr; `0EhREuRxRzyg-Bv2Ot2r5IT5eGlWnSUkE6sZoLIS_9s`
   * `VAPID_EMAIL` &rarr; `mailto:admin@nexalink.app`
4. Deployed the service and verified that socket listener handshakes loaded cleanly under `https://nexalink-signalling.onrender.com`.

---

### 🎨 Phase 4: Setting Up & Building the React Client on Vercel
1. Connected the `CALL` repository to **Vercel** as a static website project.
2. In the Vercel project **Settings &rarr; Build and Deployment**:
   * Set **Framework Preset** explicitly to **Vite**.
   * Selected the **Root Directory** as **`client`** so Vercel compiles inside the React subfolder instead of the repository root.
3. In **Settings &rarr; Environment Variables**, saved the core API endpoints:
   * `VITE_API_URL` &rarr; `https://nexalink-backend-xjx6.onrender.com`
   * `VITE_WS_URL` &rarr; `https://nexalink-signalling.onrender.com`
4. **Encountered & Diagnosed First-Build Issues ("Failed to Fetch")**:
   * **Symptoms**: The initial login or registration requests returned standard network "Failed to fetch" blockages.
   * **Root Cause**: 
     1. Vite environment variables are static and are **baked directly into the javascript build output** during Vercel's compile phase. If they are added after the build, they will not be active.
     2. When initially saved, Vercel default-checked only the `Development` CLI scope for the environment variables, leaving them empty during the public `Production` and `Preview` compile phases.
   * **Resolution Checklist**:
     * Navigated to Vercel Environment Variables dashboard &rarr; clicked **Edit** next to `VITE_API_URL` and `VITE_WS_URL`.
     * Explicitly checked **`Production`** and **`Preview`** scopes to make them available in the cloud build process.
     * Saved changes.
     * Navigated to the Vercel **Deployments** tab &rarr; clicked **Redeploy** to compile a clean client bundle incorporating the correct endpoints.

---

### 🧪 Phase 5: Verification & Verification Checks
1. Opened the final live URL: `https://my-call-app-pi.vercel.app`.
2. Verified that login, registration, and user session handshakes interact seamlessly with the live Render Python backend.
3. Verified WebSocket connection handshakes to `nexalink-signalling.onrender.com` execute correctly when navigating chat lobbies or initiating rooms.
4. Created local repository configuration documentations:
   * Created [DEPLOYMENT.md](file:///e:/calls/DEPLOYMENT.md) to serve as a persistent manual of operations and endpoints.
   * Updated [CONTEXT.md](file:///e:/calls/CONTEXT.md) to list the production URLs, architecture mapping, and updated repository directories.
5. Safely pushed all deployment configurations and scripts to remote GitHub branch `main`.

---

> [!NOTE]
> All Render and Vercel services are configured with **Auto-Deploy on Git Push**. Any new commits pushed to the repository `main` branch will trigger concurrent redeployments, keeping all live cloud resources continuously synchronized.
