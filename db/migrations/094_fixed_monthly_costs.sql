-- 094_fixed_monthly_costs.sql
-- The denominator the estate has never had.
--
-- Every cost surface in this repo measures metered Anthropic spend and nothing
-- else. `api_token_log.est_cost_usd` is zero for every Max-subscription row by
-- design, `daily_profit_summary.ad_spend` is the only non-COGS cost anywhere in
-- the schema, and it is per-day. So Vercel, Neon, Sanity, Upstash, Atlas, fal,
-- ElevenLabs, Twilio, Klaviyo, RunPod and the Max subscription itself appear in
-- no query, no digest and no admin page.
--
-- The consequence, measured in the 2026-09-04 audit: the owner's money block
-- reported $96.91 of 30-day estate spend against a store earning $28.11 in the
-- same window, and the true figure was unknowable from inside the repo. A
-- spend-to-revenue ratio computed off an unknown denominator is not a
-- conservative estimate, it is a wrong one, and it was the number the audit had
-- to reach for when asking whether the machine earns its keep.
--
-- Hand-maintained on purpose. There is no billing API wired here and inventing
-- one to avoid typing nine numbers once a month would be the more expensive
-- mistake. `effective_from` makes it a ledger rather than a mutable row, so a
-- price change is recorded rather than overwriting history, and a NULL
-- `effective_to` means "still current".
--
-- ADDITIVE: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS only, so
-- `classifyFile` reads this as `auto` and the production build applies it
-- unattended. No seed rows here for exactly that reason: an INSERT would make
-- the whole file `manual` and cost an owner merge for a table definition.

CREATE TABLE IF NOT EXISTS fixed_monthly_costs (
  id             serial PRIMARY KEY,
  vendor         varchar(48)  NOT NULL,
  note           text,
  monthly_usd    numeric(10,2) NOT NULL,
  effective_from date         NOT NULL DEFAULT CURRENT_DATE,
  effective_to   date,
  created_at     timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fixed_monthly_costs_current_idx
  ON fixed_monthly_costs (vendor, effective_from DESC);
