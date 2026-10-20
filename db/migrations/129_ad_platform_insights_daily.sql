-- 129: Ads Control Plane, phase 2a (ticket #16407). ADR-018 and
-- docs/store-team/ads-control-plane-plan.md section 3.3.
-- ad_platform_insights_daily holds one row per platform entity per day, as
-- the platform's insights API reports it: spend, delivery, clicks, leads and
-- the platform's own purchase claims. It is keyed by (platform, level,
-- external_id, day), so the hourly pull re-upserts today's row instead of
-- keeping a separate hourly table. actions keeps every action count the
-- platform returned, keyed by action type, for counts not promoted to
-- columns. Platform purchase numbers are what the platform claims;
-- order_attribution stays the source of truth for revenue.
-- ad_creative_daily_metrics gains leads so API rows mapped to a creative
-- (source 'api') carry the lead count. That table stays the rules engine's
-- only input.
--
-- FULLY ADDITIVE: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS and
-- ADD COLUMN IF NOT EXISTS only. No DROP, no RENAME, no type change, no DML.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 129
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS ad_platform_insights_daily (
  id bigserial PRIMARY KEY,
  platform text NOT NULL,
  level text NOT NULL,
  external_id text NOT NULL,
  day date NOT NULL,
  spend_cents integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  reach integer,
  frequency numeric(8,3),
  clicks integer NOT NULL DEFAULT 0,
  link_clicks integer,
  leads integer,
  platform_purchases integer,
  platform_purchase_value_cents integer,
  actions jsonb,
  pulled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, level, external_id, day)
);
CREATE INDEX IF NOT EXISTS idx_ad_platform_insights_daily_platform_day ON ad_platform_insights_daily(platform, day);
CREATE INDEX IF NOT EXISTS idx_ad_platform_insights_daily_external_day ON ad_platform_insights_daily(external_id, day);

ALTER TABLE ad_creative_daily_metrics ADD COLUMN IF NOT EXISTS leads integer;
