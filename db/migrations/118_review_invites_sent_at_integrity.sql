-- 118: review_invites sent_at/status integrity (ticket #13663).
--
-- Two rows (ids 04444133-d0c8-42ae-99cf-cba9a5ebe7af and
-- 32780be9-d7ad-4b57-b702-816457d5a03e, orders #1007/#1006) carry status
-- 'sent' with sent_at = 2026-10-12 16:00:00.000 -- a week in the future from
-- when loyalty-referral-manager found them (2026-10-05), and an exact-hour
-- timestamp no now() call produces. Their three sibling rows from the same
-- backfill batch (identical send_after, 2026-10-03T18:51:04.800Z) were
-- genuinely sent nine seconds later by the daily /cron/review-reminders run
-- (verified live, 2026-10-07). Nothing in the current application code can
-- produce the bad shape: createInvite()'s scheduled branch never writes
-- sent_at at all (the column's own DEFAULT now() stamps it at INSERT time --
-- a separate, harmless wart, since that branch's row reads 'scheduled' until
-- the cron actually sends it) and markInviteSent() always writes
-- sent_at = now(). Whichever process wrote these two rows bypassed the app
-- entirely, and because no Klaviyo "Review Invite Sent" event is logged for
-- either order, the invite was never actually delivered -- it only looks
-- delivered, which overstates every invites-sent report by two.
--
-- Fix, two parts:
--  1. Restore the two known-bad rows to 'scheduled' with sent_at reset to
--     their original send_after (already in the past), so the next
--     /cron/review-reminders run sends them for real through the normal
--     path (Klaviyo event + markInviteSent) and stamps a true sent_at.
--  2. A CHECK constraint makes "a non-scheduled invite is never dated into
--     the future" enforced rather than merely conventional: Postgres
--     evaluates a CHECK expression against now() at write time (it is never
--     re-validated against a later clock reading), which is exactly the
--     write-time guard this needs -- it blocks the next bypass-the-app write
--     that tries this again, whatever wrote the first two.
--
-- NOT additive (DML + a non-additive constraint): manual path only, same as
-- the backfill this is correcting.
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 118
-- Idempotent: the UPDATE only matches rows still in the bad 'sent'-but-future
-- shape, and DROP + ADD CONSTRAINT (no "ADD CONSTRAINT IF NOT EXISTS" exists
-- in Postgres) mirrors migration 056's own status-check pattern.

UPDATE review_invites
SET status = 'scheduled', sent_at = send_after
WHERE id IN ('04444133-d0c8-42ae-99cf-cba9a5ebe7af', '32780be9-d7ad-4b57-b702-816457d5a03e')
  AND status = 'sent'
  AND sent_at > now();

ALTER TABLE review_invites DROP CONSTRAINT IF EXISTS review_invites_sent_at_not_future;
ALTER TABLE review_invites ADD CONSTRAINT review_invites_sent_at_not_future
  CHECK (status = 'scheduled' OR sent_at <= now());
