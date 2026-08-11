-- Security hardening — audit 11/08/2026 (findings #6 + #7)
-- Run once in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- #6: Explicit UPDATE/DELETE deny on public_messages.
--     anon has no UPDATE/DELETE grant today, so it's already safe, but with RLS
--     enabled and no permissive UPDATE/DELETE policy the effect is deny-by-default.
--     We make it explicit + belt-and-braces by NOT granting those privileges.
--     (Nothing to add for a hard deny beyond ensuring no such GRANT exists.)
--
-- #7: Auto-prune public_messages so the table can't grow unbounded (compounds the
--     per-IP flood risk). Keep the newest 500 rows; delete the rest. Runs via a
--     trigger after each insert (cheap: a single DELETE using the id index).

-- ── #7: keep only the newest 500 public messages ────────────────────────────
CREATE OR REPLACE FUNCTION prune_public_messages() RETURNS trigger AS $$
BEGIN
  DELETE FROM public_messages
  WHERE id < (
    SELECT MIN(id) FROM (
      SELECT id FROM public_messages ORDER BY id DESC LIMIT 500
    ) keep
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prune_public_messages ON public_messages;
CREATE TRIGGER trg_prune_public_messages
  AFTER INSERT ON public_messages
  FOR EACH STATEMENT
  EXECUTE FUNCTION prune_public_messages();

-- ── #6: make the UPDATE/DELETE denial explicit for anon/service_role ─────────
-- RLS is already ENABLED with only SELECT + INSERT policies, so UPDATE/DELETE are
-- denied by default. Revoke to be certain no stray grant exists.
REVOKE UPDATE, DELETE ON public_messages FROM anon;
REVOKE UPDATE, DELETE ON public_messages FROM service_role;

-- ── Optional cheap win: DESC index so newest-first loads/counts stay fast ────
-- (public_messages currently has only an ASC created_at index; the client loads
--  newest-50 DESC and counts scan DESC.)
CREATE INDEX IF NOT EXISTS idx_public_messages_created_desc
  ON public_messages (created_at DESC);
