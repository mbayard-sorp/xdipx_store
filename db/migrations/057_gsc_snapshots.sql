-- 057_gsc_snapshots.sql
-- Weekly Google Search Console snapshots: last-28-day top queries/pages and
-- sitemap status, pulled by /cron/gsc-snapshot (Monday 06:00 UTC) so the
-- Monday-noon weekly strategy run reads fresh search data. The cron no-ops
-- with a logged skip until the GSC service-account env vars are set.
--
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 057

CREATE TABLE IF NOT EXISTS gsc_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  totals JSONB NOT NULL DEFAULT '{}',       -- { clicks, impressions, ctr, position }
  top_queries JSONB NOT NULL DEFAULT '[]',  -- [{ query, clicks, impressions, ctr, position }]
  top_pages JSONB NOT NULL DEFAULT '[]',    -- [{ page, clicks, impressions, ctr, position }]
  sitemaps JSONB NOT NULL DEFAULT '[]'      -- [{ path, lastSubmitted, isPending, errors, warnings }]
);

CREATE INDEX IF NOT EXISTS gsc_snapshots_captured_idx ON gsc_snapshots (captured_at DESC);
