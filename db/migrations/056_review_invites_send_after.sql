-- 056_review_invites_send_after.sql
-- Fix review-invite delivery: the orders/fulfilled webhook used an in-process
-- setTimeout(inviteDelayDays) that died with the serverless instance, so no
-- delayed invite ever fired. Invites are now inserted immediately with
-- status 'scheduled' and a send_after timestamp; the daily
-- /cron/review-reminders job sends the due ones and flips them to 'sent'.
--
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 056

ALTER TABLE review_invites ADD COLUMN IF NOT EXISTS send_after TIMESTAMPTZ;

ALTER TABLE review_invites DROP CONSTRAINT IF EXISTS review_invites_status_check;
ALTER TABLE review_invites ADD CONSTRAINT review_invites_status_check
  CHECK (status IN ('scheduled','sent','opened','clicked','completed','expired'));

CREATE INDEX IF NOT EXISTS review_invites_due_idx
  ON review_invites (send_after)
  WHERE status = 'scheduled';
