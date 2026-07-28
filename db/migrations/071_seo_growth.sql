-- 071_seo_growth.sql
-- Two tables behind the SEO growth loop: an IndexNow push ledger and a
-- day-level coverage/diagnosis record.
--
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 071
--
-- Why:
--  indexnow_pings — the bulk pusher (app/lib/indexnow-bulk.server.ts) has to
--  know what it already told the engines about. Without a ledger a daily cron
--  would re-submit the same ~1,565 stale-verdict URLs every morning, which is
--  the spam pattern IndexNow explicitly penalises. Keyed by url so the
--  14-day suppression window is a single indexed lookup.
--
--  seo_coverage_daily — gsc_index_daily already records index *counts*; this
--  records the daily *diagnosis* built on top of them (week-over-week deltas,
--  coverage-state transitions, live regression-probe results, tickets filed)
--  plus catalog-side coverage counters that explain thin-content rejections.
--  One row per day, upserted, so a re-run corrects rather than duplicates.

CREATE TABLE IF NOT EXISTS indexnow_pings (
  url         TEXT PRIMARY KEY,
  pinged_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  batch_id    VARCHAR(48),        -- e.g. 'bulk-2026-07-27'
  engine      VARCHAR(16) DEFAULT 'indexnow',
  status_code INTEGER
);

CREATE INDEX IF NOT EXISTS indexnow_pings_pinged_idx ON indexnow_pings (pinged_at DESC);
CREATE INDEX IF NOT EXISTS indexnow_pings_batch_idx  ON indexnow_pings (batch_id);

CREATE TABLE IF NOT EXISTS seo_coverage_daily (
  day                       DATE PRIMARY KEY,
  discovery_total           INTEGER,   -- products in the live discovery index
  has_type_dial             INTEGER,   -- of those, with a product_type_dial
  has_mood                  INTEGER,   -- of those, with >= 1 mood tag
  has_image                 INTEGER,   -- of those, with a featured image
  enriched_distinct_products INTEGER,  -- count(distinct product_id) in product_enrichment_cache
  notes                     JSONB,     -- the full SeoDailyResult for the day
  created_at                TIMESTAMPTZ DEFAULT now()
);
