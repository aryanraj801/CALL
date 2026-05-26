-- NexaLink Production Database Migrations Schema (Supabase PostgreSQL)
-- Run this script inside the SQL Editor of your Supabase project dashboard (uejwhikwtjikrsbnaabo).

-- Enable pgvector for semantic transcripts search
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Create Public User Profiles Table (Linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    bio TEXT,
    profile_pic TEXT,
    theme TEXT DEFAULT 'dark',
    chat_settings JSONB DEFAULT '{"pressEnterToSend": true, "soundEnabled": true, "typingIndicators": true}',
    notif_settings JSONB DEFAULT '{"desktopEnabled": true, "showToastAlerts": true, "pushWakingEnabled": true}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Ensure columns exist on pre-existing tables in live Supabase instances
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS profile_pic TEXT;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'dark';
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS chat_settings JSONB DEFAULT '{"pressEnterToSend": true, "soundEnabled": true, "typingIndicators": true}';
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS notif_settings JSONB DEFAULT '{"desktopEnabled": true, "showToastAlerts": true, "pushWakingEnabled": true}';

-- Force Supabase PostgREST to reload its schema cache to pick up the new columns immediately
NOTIFY pgrst, 'reload schema';

-- Row Level Security (RLS)
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow public read access to profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Allow users to update their own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Allow users to update your own profile" ON public.user_profiles;

-- Create policies
CREATE POLICY "Allow public read access to profiles" 
ON public.user_profiles FOR ALL USING (true);

-- Trigger to automatically map Auth users to Public user_profiles upon signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, username, email)
    VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
        new.email
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- 2. Create Room Sessions Table
CREATE TABLE IF NOT EXISTS public.rooms (
    id VARCHAR(50) PRIMARY KEY,
    room_name VARCHAR(100) NOT NULL,
    ephemeral_mode BOOLEAN DEFAULT TRUE,
    metadata_stripping BOOLEAN DEFAULT TRUE,
    data_residency_region VARCHAR(10) DEFAULT 'US',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    concluded_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow room access policies" ON public.rooms;
CREATE POLICY "Allow room access policies" ON public.rooms FOR ALL USING (true);


-- 3. Create Call Logs Table (Tracks who joined, when, and when they left)
CREATE TABLE IF NOT EXISTS public.call_logs (
    id BIGSERIAL PRIMARY KEY,
    room_id VARCHAR(50) REFERENCES public.rooms(id) ON DELETE SET NULL,
    room_name VARCHAR(100) NOT NULL,
    username VARCHAR(50) NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    left_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow call logs access" ON public.call_logs;
CREATE POLICY "Allow call logs access" ON public.call_logs FOR ALL USING (true);


-- 4. Create Selective Recording Consent Audit Trails
CREATE TABLE IF NOT EXISTS public.recording_consents (
    id BIGSERIAL PRIMARY KEY,
    room_name VARCHAR(100) NOT NULL,
    participant_id VARCHAR(100) NOT NULL,
    consent_granted BOOLEAN NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.recording_consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow recording consents access" ON public.recording_consents;
CREATE POLICY "Allow recording consents access" ON public.recording_consents FOR ALL USING (true);


-- 5. Create Meeting Summaries & Action Items Table
CREATE TABLE IF NOT EXISTS public.meeting_summaries (
    id BIGSERIAL PRIMARY KEY,
    room_name VARCHAR(100) NOT NULL,
    transcript TEXT NOT NULL,
    summary TEXT NOT NULL,
    action_items JSONB NOT NULL, -- Stored as queryable JSON documents
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.meeting_summaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow meeting summaries access" ON public.meeting_summaries;
CREATE POLICY "Allow meeting summaries access" ON public.meeting_summaries FOR ALL USING (true);


-- 6. Create Whiteboard Saves Table (referenced by save_whiteboard_snapshot_db)
CREATE TABLE IF NOT EXISTS public.whiteboard_saves (
    id BIGSERIAL PRIMARY KEY,
    room_name VARCHAR(100) NOT NULL,
    url TEXT NOT NULL,
    saved_by VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.whiteboard_saves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow whiteboard saves access" ON public.whiteboard_saves;
CREATE POLICY "Allow whiteboard saves access" ON public.whiteboard_saves FOR ALL USING (true);


-- 7. Direct Messages Table
--    Stores 1-to-1 chat messages between users persistently.
--    conversation_key = sorted concatenation of both usernames e.g. "alice|bob"
CREATE TABLE IF NOT EXISTS public.direct_messages (
    id          BIGSERIAL PRIMARY KEY,
    conversation_key  VARCHAR(120) NOT NULL,  -- sorted "userA|userB"
    sender      VARCHAR(50)  NOT NULL,
    recipient   VARCHAR(50)  NOT NULL,
    text        TEXT         NOT NULL,
    sent_at     TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    read        BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_direct_messages_convo
    ON public.direct_messages (conversation_key, sent_at DESC);

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow direct messages access" ON public.direct_messages;
CREATE POLICY "Allow direct messages access" ON public.direct_messages FOR ALL USING (true);


-- 8. Direct Call Logs Table
--    One row per call attempt between two users.
CREATE TABLE IF NOT EXISTS public.direct_call_logs (
    id               BIGSERIAL PRIMARY KEY,
    conversation_key VARCHAR(120) NOT NULL,
    caller           VARCHAR(50)  NOT NULL,
    callee           VARCHAR(50)  NOT NULL,
    call_type        VARCHAR(10)  NOT NULL DEFAULT 'video',  -- 'video' | 'voice'
    status           VARCHAR(20)  NOT NULL DEFAULT 'missed', -- 'accepted' | 'declined' | 'missed'
    room_name        VARCHAR(120),
    started_at       TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    ended_at         TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_direct_call_logs_convo
    ON public.direct_call_logs (conversation_key, started_at DESC);

ALTER TABLE public.direct_call_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow direct call logs access" ON public.direct_call_logs;
CREATE POLICY "Allow direct call logs access" ON public.direct_call_logs FOR ALL USING (true);

-- 9. Contacts Table (E2E persistent contact lists)
CREATE TABLE IF NOT EXISTS public.contacts (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    contact_username VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(username, contact_username)
);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow contacts access" ON public.contacts;
CREATE POLICY "Allow contacts access" ON public.contacts FOR ALL USING (true);


-- 10. File Transfers Table (Tracks metadata & status of secure transfers)
CREATE TABLE IF NOT EXISTS public.file_transfers (
    id BIGSERIAL PRIMARY KEY,
    conversation_key VARCHAR(120) NOT NULL,
    sender VARCHAR(50) NOT NULL,
    recipient VARCHAR(50) NOT NULL,
    file_name TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'declined'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_file_transfers_recipient_status
    ON public.file_transfers (recipient, status);
CREATE INDEX IF NOT EXISTS idx_file_transfers_convo
    ON public.file_transfers (conversation_key, created_at DESC);

ALTER TABLE public.file_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow file transfers access" ON public.file_transfers;
CREATE POLICY "Allow file transfers access" ON public.file_transfers FOR ALL USING (true);

