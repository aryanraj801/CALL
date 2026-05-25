# AGENTS.md — System Overview & Autonomous Directives for Jules

Welcome, Jules! This document details the repository standards, system architecture, Supabase schema configurations, and verification routines for NexaLink, enabling you to work autonomously and asynchronously on this codebase.

---

## 🛠️ Technology Stack & Project Structure

NexaLink is a premium secure real-time communications application composed of:
1. **Python Backend Service (`/server`):** Built with FastAPI, SQLAlchemy, and standard python library connections to Supabase.
2. **WebRTC Signalling Server (`/signalling`):** Managed via Node.js and Socket.IO.
3. **Vite + React Frontend Client (`/client`):** Powered by React, Lucide icons, and Vanilla CSS themes.

### Repository Map
- `client/` — Vite + React frontend client.
  - `src/App.tsx` — Main application logic, UI router, state variables, and WebRTC layout grid.
  - `src/index.css` — Global CSS styling tokens, scroll rules, and resizer styles.
  - `src/components/Whiteboard.tsx` — Dynamic collaborative whiteboard drawing canvas.
- `server/` — FastAPI Python backend server.
  - `main.py` — Core REST endpoints, auth verification, and CORS routing.
  - `db/supabase_api.py` — Database REST wrapper executing Supabase calls.
  - `db/models.py` — SQLAlchemy ORM schemas.
  - `db/session.py` — Database engine pooling and connection handles.
  - `db_optimize.py` — Migration script executing SQL and applying indexes.
- `infra/` — Shared infrastructure and migrations.
  - `migrations/supabase_schema.sql` — PostgreSQL database schemas, triggers, and RLS policies.

---

## 💾 Supabase Schema & Database Integration

NexaLink connects to a cloud-based Supabase PostgreSQL instance. All main tables use Row-Level Security (RLS) policies.

### Active Tables
1. **`public.user_profiles`** — Linked to Supabase Auth.
   - Schema: `id UUID`, `username VARCHAR(50)`, `email VARCHAR(100)`, `bio TEXT`, `profile_pic TEXT`.
   - Populated automatically upon sign-up via Postgres triggers.
2. **`public.rooms`** — Live room session catalog.
3. **`public.call_logs`** — Tracking active and historic joins/leaves.
4. **`public.direct_messages`** — 1-to-1 contacts persistent chat history.
5. **`public.direct_call_logs`** — Secure direct call records.
6. **`public.recording_consents`** & **`public.whiteboard_saves`** — Audit trails.

### Database Performance Indexes
High-speed indexes are applied to the following fields:
- `call_logs(username)` & `call_logs(room_id)`
- `meeting_summaries(room_name)`
- `recording_consents(room_name)`
- `direct_messages(conversation_key, sent_at DESC)`
- `direct_call_logs(conversation_key, started_at DESC)`

---

## 📋 Developer Directives for Jules

Jules, when you receive a task to improve or optimize the codebase, please adhere to these guidelines:

### 1. Database & Backend API Optimizations
- Keep all database credentials loaded safely from environment variables (`.env`).
- Ensure PostgREST parameters and query strings are URL-encoded (`urllib.parse.quote()`) before execution to prevent filter injection vulnerabilities.
- If editing SQLAlchemy ORM models, make sure any transaction poolers on port `6543` bypass client-side pools to prevent connection leaks (configure using `sqlalchemy.pool.NullPool`).

### 2. Client-Side Constraints (No `localStorage`)
- **NEVER** write or read session/state variables from standard local storage (`localStorage`).
- Always keep token, username, contacts list, current view, and notification indicators resident inside in-memory tab-scoped `sessionStorage` or backend endpoints.
- User profile data (`bio`, `profilePic`) must remain strictly database-driven: fetch from `/api/profile/{username}` on load, and push updates directly to `/api/profile/save` on modification.

### 3. Verification & Testing Routines
Before submitting a pull request, you MUST execute these standard verification commands:
- **Database Schema & Index Checks:**
  ```bash
  python server/db_optimize.py
  ```
  *(Verify that all public tables, triggers, and indices display a green checkout/report)*.
- **Client TypeScript Compile Validation:**
  ```bash
  cd client && npx tsc --noEmit
  ```
  *(Verify that type checking passes completely with zero errors)*.
- **Client Production Compilation Bundle:**
  ```bash
  cd client && npm run build
  ```
  *(Verify that the Vite build is successful and output chunks are compiled safely)*.

Please maintain this document's directives and always perform adversarial reviews of your own changes to ensure absolute code quality. Good luck!
