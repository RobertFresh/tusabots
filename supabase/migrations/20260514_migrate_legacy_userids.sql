-- Phase 3 Data Migration — Legacy user_id cleanup
-- Run BEFORE enabling RLS
--
-- WHAT IT DOES:
--   1. Guards: aborts if the user hasn't signed up yet
--   2. Migrates all 'global' conversation history to James's real UUID
--   3. Deletes 'test' / 'test-final' test artifacts
--   4. Reports before/after row distribution
--
-- EDIT: Replace 'delightfulsower@gmail.com' with James's actual sign-up email

BEGIN;

-- STEP 1: Guard — abort with clear message if user not signed up yet
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE email = 'delightfulsower@gmail.com'
  ) THEN
    RAISE EXCEPTION 'delightfulsower@gmail.com not found in auth.users — sign up at tusabots.com first';
  END IF;
END $$;

-- STEP 2: Preview — state before migration
SELECT 'BEFORE MIGRATION' AS phase;
SELECT user_id, COUNT(*) AS rows FROM messages GROUP BY user_id ORDER BY user_id;

-- STEP 3: Migrate 'global' history to James's real UUID
UPDATE messages
SET user_id = (
  SELECT id FROM auth.users
  WHERE email = 'delightfulsower@gmail.com'
  LIMIT 1
)
WHERE user_id = 'global';

-- STEP 4: Delete test artifacts
DELETE FROM messages WHERE user_id IN ('test', 'test-final');

-- STEP 5: Confirm results
SELECT 'AFTER MIGRATION' AS phase;
SELECT user_id, COUNT(*) AS rows, MIN(created_at) AS earliest, MAX(created_at) AS latest
FROM messages GROUP BY user_id ORDER BY user_id;

COMMIT;

-- POST-MIGRATION VERIFICATION (run this after the migration commits cleanly):
-- Should return 0 rows — any non-UUID user_ids indicate incomplete migration
-- SELECT DISTINCT user_id FROM messages
-- WHERE user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';