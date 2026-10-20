-- 132: Ads Control Plane, phase 6b (ticket #16435). ADR-018 and
-- docs/store-team/ads-control-plane-plan.md section 3.3.
-- ad_audiences mirrors the audiences each ad platform reports: Meta custom
-- audiences, lookalikes and saved audiences, keyed by the platform's own id.
-- The entity sync cron fills it after the entity pull. role is derived from
-- the mirrored ad sets' targeting: an audience any ad set excludes is
-- 'exclusion', one any ad set targets is 'targeting', anything else is
-- 'unknown'. The console's exclusions check reads it for docs/ads-policy.md
-- M8. Read-only mirror: nothing here writes to a platform.
--
-- FULLY ADDITIVE: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS
-- only. No DROP, no RENAME, no ALTER, no DML.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 132
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS ad_audiences (
  id bigserial PRIMARY KEY,
  platform text NOT NULL,
  external_id text NOT NULL,
  name text,
  kind text CHECK (kind IN ('custom', 'lookalike', 'saved')),
  role text CHECK (role IN ('targeting', 'exclusion', 'unknown')),
  approx_size integer,
  status text,
  raw jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_id)
);
CREATE INDEX IF NOT EXISTS idx_ad_audiences_platform_role ON ad_audiences(platform, role);
