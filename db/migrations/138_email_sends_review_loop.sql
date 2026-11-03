-- 138: ticket #17445, the owner review loop for the daily promo email
-- (owner direction 2026-10-23: "I want to view them before they are sent and
-- have a way to send back for changes").
--
-- Two columns on email_sends, separate from the existing `status` column
-- (drafted|sent|skipped, the Klaviyo send lifecycle): `review_status` is the
-- owner's review workflow state layered on top of that lifecycle, so a row
-- can be `status='drafted'` and `review_status='changes_requested'` at the
-- same time. pending_review is the default so every existing and future
-- drafted row starts in the review queue; approved|changes_requested are
-- written by the admin actions in admin.email.tsx.
--
-- `review_notes` is an append-only JSON array of {at, note} objects, one
-- entry per "Request changes" click, read by POST /api/team/email
-- {op:'revisions'} so routine-email-daily.md can see what the owner asked
-- for without opening the admin UI.
--
-- FULLY ADDITIVE: two ADD COLUMN IF NOT EXISTS. No DROP, no RENAME, no
-- ALTER TYPE, no DML. Existing rows read as pending_review / [] through the
-- defaults.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 138
-- Idempotent: safe to re-run.

ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending_review';
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS review_notes jsonb NOT NULL DEFAULT '[]';
