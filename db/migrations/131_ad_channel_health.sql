-- 131: Ads Control Plane, phase 1d (ticket #16406). ADR-018 and
-- docs/store-team/ads-control-plane-plan.md sections 3.4 and 8.
-- ad_channel_health keeps the latest token health reading per ad channel, so
-- the phase 3 console can show it without calling the platform. One row per
-- channel, overwritten by /cron/ads-token-health each day. state is the
-- verdict the cron acted on: ok, expiring, invalid, or unknown (could not
-- ask, which never files a blocker). valid, expires_at and scopes are what the
-- platform reported.
--
-- FULLY ADDITIVE: CREATE TABLE IF NOT EXISTS only. No DROP, no RENAME, no
-- ALTER, no DML.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 129
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS ad_channel_health (
  channel text PRIMARY KEY,
  checked_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL CHECK (state IN ('ok', 'expiring', 'invalid', 'unknown')),
  valid boolean NOT NULL,
  expires_at timestamptz,
  data_access_expires_at timestamptz,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  env_var text
);
