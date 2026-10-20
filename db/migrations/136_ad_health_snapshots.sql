-- 136: Ads Control Plane, signal snapshots (ticket #16686). ADR-018 and
-- docs/store-team/ads-control-plane-plan.md sections 9.2 and 12.
-- ad_health_snapshots holds what the console's Signals and Breakdowns tabs
-- and the Signal health card read: one row per reading of one kind on one
-- channel. The daily ads routine records pixel, errors, opportunity and
-- anomaly snapshots through POST /api/team/ad-health-snapshot. The hourly
-- /cron/ads-insights run records account and activity snapshots from the
-- Graph API, and its Sunday restatement run records breakdown snapshots.
-- Kinds and payload shapes live in app/lib/ads/health-snapshots-core.ts.
--
-- FULLY ADDITIVE: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS
-- only. No DROP, no RENAME, no ALTER, no DML.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 136
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS ad_health_snapshots (
  id bigserial PRIMARY KEY,
  channel text NOT NULL,
  kind text NOT NULL,
  observed_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  source text NOT NULL DEFAULT 'routine',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_health_snapshots_channel_kind_observed ON ad_health_snapshots(channel, kind, observed_at DESC);
