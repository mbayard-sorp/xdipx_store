-- 127: repair of 118_review_invites_sent_at_integrity.sql, whose predicate
-- expired before it was ever applied (ticket #16267).
--
-- 118's UPDATE matched rows with `sent_at > now()` -- correct the day it was
-- written (2026-10-12 16:00:00 was then still in the future), but it was
-- never applied before that timestamp passed, so the predicate now matches
-- zero rows, forever. 118 is already merged, so per routine-dev-daily.md
-- Step 2 ("never edit a migration that has already merged; add a new one")
-- this repeats its fix here instead, with a predicate that pins the exact
-- known-bad shape rather than comparing against a moving now(): an exact
-- match on the bad sent_at, with opened_at/completed_at still both null (the
-- invite was never actually opened or completed -- see 118's own note for the
-- full story of how these two rows got here).
--
-- Also nulls reminder_sent_at for the same two rows: whatever process wrote
-- the bad 'sent' state never sent a real reminder either, so the next
-- /cron/review-reminders pass must not skip them as already-reminded once
-- they are back to 'scheduled'.
--
-- The CHECK constraint is unchanged from 118, repeated here (idempotent --
-- DROP then ADD, never a duplicate error) because if 118 genuinely never
-- ran, this is the first time it lands in prod at all.
--
-- NOT additive (DML, and repeats a constraint from an already-merged
-- migration): protected path, owner merges.
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 127
-- Idempotent: the UPDATE only matches the two rows still in the exact bad
-- shape, and DROP + ADD CONSTRAINT mirrors 118's own pattern.

UPDATE review_invites
SET status = 'scheduled', sent_at = send_after, reminder_sent_at = NULL
WHERE id IN ('04444133-d0c8-42ae-99cf-cba9a5ebe7af', '32780be9-d7ad-4b57-b702-816457d5a03e')
  AND sent_at = '2026-10-12 16:00:00+00'
  AND opened_at IS NULL
  AND completed_at IS NULL;

ALTER TABLE review_invites DROP CONSTRAINT IF EXISTS review_invites_sent_at_not_future;
ALTER TABLE review_invites ADD CONSTRAINT review_invites_sent_at_not_future
  CHECK (status = 'scheduled' OR sent_at <= now());
