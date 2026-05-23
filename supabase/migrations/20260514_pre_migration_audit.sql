-- Phase 3 Pre-migration Audit — READ ONLY
-- Run this in Supabase Dashboard → SQL Editor BEFORE enabling RLS
--
-- This script only runs SELECT queries inside a READ ONLY transaction.
-- It inspects but never modifies anything.
--
-- Run each query block separately and save the output.

BEGIN;
SET TRANSACTION READ ONLY;

-- 1. Which tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- 2. messages columns
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'messages'
ORDER BY ordinal_position;

-- 3. files columns
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'files'
ORDER BY ordinal_position;

-- 4. messages row stats
SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT user_id) AS unique_users,
  COUNT(*) FILTER (WHERE user_id IS NULL) AS null_user_id,
  MIN(created_at) AS earliest,
  MAX(created_at) AS latest
FROM messages;

-- 5. Identify orphaned/non-UUID user_id values
SELECT id, user_id::text, LEFT(content, 60), created_at
FROM messages
WHERE user_id IS NULL
   OR user_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
ORDER BY created_at DESC
LIMIT 30;

-- 6. files row stats
SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT user_id) AS unique_users,
  COUNT(*) FILTER (WHERE user_id IS NULL) AS null_user_id
FROM files;

-- 7. Storage bucket configuration
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE name = 'tusabot-files';

-- 8. Current RLS status
SELECT relname AS table_name, relrowsecurity AS rls_enabled,
  (SELECT COUNT(*) FROM pg_policies WHERE tablename = relname) AS policy_count
FROM pg_class
WHERE relname IN ('messages', 'files') AND relkind = 'r';

-- 9. Auth user count
SELECT COUNT(*) AS total_users, MIN(created_at) AS earliest_user FROM auth.users;

COMMIT;