-- 120: hand-entered ad spend for the admin P&L (/admin, Costs tab).
--
-- Until each ad platform's spend is imported automatically, the owner types
-- one total per platform per month. The P&L spreads it evenly over
-- period_start..period_end (the whole month for a past month, the 1st through
-- the entry date for the current one), so a partial-month range and the daily
-- chart carry their fair share instead of one lump on a single day.
--
-- One row per (platform, period_start): entering the same platform and month
-- again replaces the figure. Imported spend (ad_creative_daily_metrics) is
-- separate; the dashboard warns when the two overlap.
--
-- ADDITIVE: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS only, so
-- the production build applies it unattended. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS pnl_ad_spend (
  id            serial PRIMARY KEY,
  platform      varchar(40)   NOT NULL,
  period_start  date          NOT NULL,
  period_end    date          NOT NULL,
  amount_usd    numeric(10,2) NOT NULL,
  note          text,
  created_by    varchar(255),
  created_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pnl_ad_spend_platform_period_uniq
  ON pnl_ad_spend (platform, period_start);
