-- 134: Ads Control Plane, phase 2d (ticket #16410). ADR-018 and
-- docs/store-team/ads-control-plane-plan.md sections 7, 9.2, 9.3 and 9.8.
-- ad_health_samples holds the hourly health counters the L3 funnel-break rule
-- and the phase 3 console read: hello_ok, lead_posts_1h, landing_views_1h,
-- landing_views_today, lead_events_6h and growth_campaign_active, one row per
-- key per /cron/ads-insights run. /api/lead also writes one lead_post_event
-- row per successful capture, which is what lead_posts_1h counts. 132 and 133
-- are reserved for audiences and experiments.
--
-- FULLY ADDITIVE: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS
-- only. No DROP, no RENAME, no ALTER, no DML.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 134
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS ad_health_samples (
  id bigserial PRIMARY KEY,
  sampled_at timestamptz NOT NULL DEFAULT now(),
  key text NOT NULL,
  value numeric NOT NULL,
  detail jsonb
);

CREATE INDEX IF NOT EXISTS idx_ad_health_samples_key_sampled ON ad_health_samples(key, sampled_at);
