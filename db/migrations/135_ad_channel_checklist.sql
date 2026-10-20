-- 135: Ads Control Plane, phase 7a (ticket #16438). ADR-018 and
-- docs/store-team/ads-control-plane-plan.md sections 6 and 7.
-- ad_channel_checklist holds the channel enablement checklist from plan
-- section 6: one row per channel per item, written only from an admin
-- session on /admin/ads/channels. checked_at is null while an item is open.
-- checked_by is whoever last changed the row, and evidence is what they
-- wrote down as proof (a date, a source URL, a screenshot link). The nine
-- item keys live in app/lib/ads/channels-core.ts. A channel's mutate
-- capability reads as blocked until all nine are checked.
--
-- FULLY ADDITIVE: CREATE TABLE IF NOT EXISTS only. No DROP, no RENAME, no
-- ALTER, no DML.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 135
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS ad_channel_checklist (
  id bigserial PRIMARY KEY,
  channel text NOT NULL,
  item text NOT NULL,
  checked_at timestamptz,
  checked_by text,
  evidence text,
  UNIQUE (channel, item)
);
