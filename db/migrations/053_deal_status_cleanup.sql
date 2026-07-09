-- 053_deal_status_cleanup.sql
-- Unify deal_history.status onto one vocabulary:
--   pending (staged, awaiting owner approval)
--   -> queued (owner-approved, eligible for nightly activation)
--   -> live -> archived
-- Previously the admin queue used pending/approved while the rotator
-- consumed queued/pending_approval, so the nightly activator ignored
-- admin-approved deals and could promote never-approved staged rows.
-- Audit: docs/agent-automation-audit-2026-07.md §3.4.
-- Order matters; the created_at guard keeps re-runs from demoting
-- rows approved after this migration shipped.

-- 1. Old vaulted rows (queued + completed) are past deals.
UPDATE deal_history SET status = 'archived'
  WHERE status = 'queued' AND completed_at IS NOT NULL;

-- 2. Staged-but-never-approved rows lose auto-activation eligibility.
--    Re-approve on /admin/queue if daily deals resume.
UPDATE deal_history SET status = 'pending'
  WHERE status = 'queued' AND completed_at IS NULL AND created_at < '2026-07-09';

-- 3. Owner-approved rows become the activator's feed.
UPDATE deal_history SET status = 'queued' WHERE status = 'approved';

-- 4. Legacy names collapse into pending.
UPDATE deal_history SET status = 'pending'
  WHERE status IN ('pending_approval', 'pending_review', 'draft', 'scheduled');

ALTER TABLE deal_history ALTER COLUMN status SET DEFAULT 'pending';
