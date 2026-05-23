-- supabase/migrations/20260514_enable_rls.sql
-- Phase 3: Enable Row Level Security on messages and files tables
-- Run AFTER the data migration script completes cleanly
--
-- ROLLBACK at any time:
--   SELECT drop_rls_policies_and_triggers();
-- Then verify with:
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('messages','files');

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Guardrails: abort if data migration was not run first
-- ─────────────────────────────────────────────────────────────────────────────

-- Check 1: no non-UUID user_ids remain in messages
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM messages
    WHERE user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) THEN
    RAISE EXCEPTION 'Non-UUID user_id found in messages — run data migration script first';
  END IF;
END $$;

-- Check 2: no NULL user_id in messages
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM messages WHERE user_id IS NULL) THEN
    RAISE EXCEPTION 'NULL user_id found in messages';
  END IF;
END $$;

-- Check 3: no NULL user_id in files
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM files WHERE user_id IS NULL) THEN
    RAISE EXCEPTION 'NULL user_id found in files';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Enable RLS on both tables
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE files   ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- Drop existing policies (idempotent — safe if no policies exist yet)
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can select their own messages" ON messages;
DROP POLICY IF EXISTS "Users can insert their own messages" ON messages;
DROP POLICY IF EXISTS "Users can delete their own messages" ON messages;
DROP POLICY IF EXISTS "Users can select their own files"  ON files;
DROP POLICY IF EXISTS "Users can insert their own files"   ON files;
DROP POLICY IF EXISTS "Users can delete their own files"   ON files;

-- ─────────────────────────────────────────────────────────────────────────────
-- messages policies — SELECT / INSERT / DELETE per user
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "Users can select their own messages"
  ON messages FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own messages"
  ON messages FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own messages"
  ON messages FOR DELETE USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- files policies — SELECT / INSERT / DELETE per user
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "Users can select their own files"
  ON files FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own files"
  ON files FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own files"
  ON files FOR DELETE USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback helper — run this to instantly remove all policies and RLS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION drop_rls_policies_and_triggers()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DROP POLICY IF EXISTS "Users can select their own messages" ON messages;
  DROP POLICY IF EXISTS "Users can insert their own messages" ON messages;
  DROP POLICY IF EXISTS "Users can delete their own messages" ON messages;
  DROP POLICY IF EXISTS "Users can select their own files"  ON files;
  DROP POLICY IF EXISTS "Users can insert their own files"   ON files;
  DROP POLICY IF EXISTS "Users can delete their own files"   ON files;
  ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
  ALTER TABLE files   DISABLE ROW LEVEL SECURITY;
END;
$$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-MIGRATION VERIFICATION — run these separately after the migration
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Confirm RLS is enabled:
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('messages','files');
-- Expected: both rows show relrowsecurity = true
--
-- Confirm 3 policies per table:
--   SELECT policyname, cmd, qual FROM pg_policies WHERE tablename IN ('messages','files');
-- Expected: 6 rows total (3 per table)
--
-- Confirm all user_ids are valid UUIDs after migration:
--   SELECT DISTINCT user_id FROM messages
--   WHERE user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
-- Expected: 0 rows