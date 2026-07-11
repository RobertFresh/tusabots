-- Public group chat table
-- Completely separate from the private "messages" table.
-- No auth required to read; writes go through the public-chat Netlify function.

CREATE TABLE IF NOT EXISTS public_messages (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sender_name TEXT        NOT NULL DEFAULT 'Visitor',
  content     TEXT        NOT NULL,
  is_bot      BOOLEAN     NOT NULL DEFAULT FALSE,
  visitor_id  TEXT,                              -- fingerprint hash for rate limiting
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for ordering (newest last) and visitor lookups
CREATE INDEX idx_public_messages_created ON public_messages (created_at ASC);
CREATE INDEX idx_public_messages_visitor ON public_messages (visitor_id, created_at DESC);

-- Enable Row Level Security (required for Supabase best practice)
ALTER TABLE public_messages ENABLE ROW LEVEL SECURITY;

-- Allow anyone to SELECT (public chat is readable by all)
CREATE POLICY "public_messages_select" ON public_messages
  FOR SELECT USING (true);

-- Allow inserts only from the service role (the Netlify function uses service_role key)
-- This prevents random visitors from inserting directly via the anon key.
CREATE POLICY "public_messages_insert_service" ON public_messages
  FOR INSERT WITH CHECK (
    (current_setting('request.jwt.claims', true)::json ->> 'role') = 'service_role'
  );

-- Enable Supabase Realtime on this table
ALTER PUBLICATION supabase_realtime ADD TABLE public_messages;

-- Optional: auto-prune old messages (keep last 200) via a cron or manual cleanup
-- For now we'll just let them accumulate — free tier has 500MB which is plenty for text.
