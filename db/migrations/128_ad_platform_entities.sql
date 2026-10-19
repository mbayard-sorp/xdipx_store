-- 128: Ads Control Plane, phase 1a (ticket #16403). ADR-018 and
-- docs/store-team/ads-control-plane-plan.md section 3.3.
-- ad_platform_entities mirrors what each ad platform reports: one row per
-- campaign, ad set, ad or creative, keyed by the platform's own id. The
-- phase 1c entity sync cron fills it and the console reads it. creative_id
-- links a mirrored row back to the Ad Studio creative it came from, when
-- there is one. raw keeps the last platform payload for fields we have not
-- promoted to columns yet.
--
-- FULLY ADDITIVE: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS
-- only. No DROP, no RENAME, no ALTER, no DML.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 128
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS ad_platform_entities (
  id bigserial PRIMARY KEY,
  platform text NOT NULL,
  account_id text NOT NULL,
  level text NOT NULL CHECK (level IN ('campaign', 'adset', 'ad', 'creative')),
  external_id text NOT NULL,
  parent_external_id text,
  name text,
  status text,
  effective_status text,
  objective text,
  daily_budget_cents integer,
  lifetime_budget_cents integer,
  bid_strategy text,
  creative_id integer REFERENCES ad_creatives(id) ON DELETE SET NULL,
  review_feedback jsonb,
  raw jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_platform_entities_platform_external ON ad_platform_entities(platform, external_id);
CREATE INDEX IF NOT EXISTS idx_ad_platform_entities_level ON ad_platform_entities(platform, level);
CREATE INDEX IF NOT EXISTS idx_ad_platform_entities_parent ON ad_platform_entities(parent_external_id);
CREATE INDEX IF NOT EXISTS idx_ad_platform_entities_creative ON ad_platform_entities(creative_id);
