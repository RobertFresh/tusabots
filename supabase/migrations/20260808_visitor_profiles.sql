-- Phase 3: lightweight "living bot" visitor memory.
-- Unit-7 builds a tiny profile on each visitor MECHANICALLY (no extra AI calls),
-- so remembering is free. The profile is only read into the prompt on the rare
-- occasions the bot already decided to reply.
--
-- Run this once in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS visitor_profiles (
  visitor_id   TEXT        PRIMARY KEY,          -- IP (matches public_messages.visitor_id)
  display_name TEXT,                             -- latest cowboy handle they used
  msg_count    INTEGER     NOT NULL DEFAULT 0,   -- how many messages they've sent over time
  recent_lines JSONB       NOT NULL DEFAULT '[]'::jsonb, -- last few short things they said
  first_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS on. Only the service_role (the Netlify function) ever touches this table;
-- anon/clients never read or write profiles directly.
ALTER TABLE visitor_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "visitor_profiles_service_all" ON visitor_profiles
  FOR ALL USING (
    (current_setting('request.jwt.claims', true)::json ->> 'role') = 'service_role'
  );

-- Base table privileges (REQUIRED — RLS policies alone are NOT enough).
GRANT SELECT, INSERT, UPDATE ON visitor_profiles TO service_role;
