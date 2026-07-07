-- 051_store_teams.sql
-- Generalizes the homepage-team control plane (049) into a store-wide,
-- multi-team control plane: homepage | social | ads | email | strategy.
--
-- Additive + backward compatible: existing rows get team='homepage' via the
-- column DEFAULT, and the existing /api/homepage-team/* routes keep working
-- unchanged. Spend still lives in api_token_log (feature '{team}-%'), never here.
--
-- Apply with:
--   npx tsx scripts/apply-migrations.ts --from 051

-- Team-scope runs. Events need no team column (they join through runs).
ALTER TABLE homepage_team_runs
  ADD COLUMN IF NOT EXISTS team VARCHAR(24) NOT NULL DEFAULT 'homepage';

-- The suggestions table becomes the store-wide improvement bus.
--   team        — which team's retro produced the suggestion
--   target_team — cross-team routing; NULL means "own team"
--   kind        — process|strategy|instructions|agent-def|config|code|campaign|promo|program
--   apply_ref   — PR URL (agent-editor) or applied artifact reference
--   decided_at  — when the owner approved/dismissed from the dashboard
-- status gains 'pr_open' between approved and applied (fits varchar(12)):
--   proposed -> approved|dismissed (owner, admin UI) -> pr_open (agent-editor PR) -> applied (owner merges)
ALTER TABLE homepage_team_suggestions
  ADD COLUMN IF NOT EXISTS team VARCHAR(24) NOT NULL DEFAULT 'homepage';
ALTER TABLE homepage_team_suggestions
  ADD COLUMN IF NOT EXISTS target_team VARCHAR(24);
ALTER TABLE homepage_team_suggestions
  ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'process';
ALTER TABLE homepage_team_suggestions
  ADD COLUMN IF NOT EXISTS apply_ref TEXT;
ALTER TABLE homepage_team_suggestions
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_team_runs_team ON homepage_team_runs (team, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_team_sugg_team ON homepage_team_suggestions (team, status, created_at DESC);

-- Weekly store-wide strategy brief — written by store-strategist, read by every
-- routine at run start (GET /api/team/brief). Exactly one row is 'active';
-- publishing a new brief supersedes the previous active one.
CREATE TABLE IF NOT EXISTS strategy_briefs (
  id           SERIAL PRIMARY KEY,
  week_start   DATE NOT NULL,
  brief        TEXT NOT NULL,               -- markdown: focus, per-team directives, stop-doing list
  metrics_json JSON,                        -- revenue, GA4, spend, engagement behind the calls
  status       VARCHAR(12) NOT NULL DEFAULT 'active',  -- active|superseded|draft
  created_by   VARCHAR(48) NOT NULL DEFAULT 'store-strategist',
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategy_briefs_status ON strategy_briefs (status, created_at DESC);

-- Ad campaign proposals — the ads-manager stub is propose-only; nothing in this
-- table spends money. Launch is a human action in-platform; once live, the
-- external id + actual spend get synced back for the strategist's retro.
CREATE TABLE IF NOT EXISTS ad_campaigns (
  id                   SERIAL PRIMARY KEY,
  platform             VARCHAR(20) NOT NULL,   -- meta|x|google|reddit|other
  name                 VARCHAR(120) NOT NULL,
  objective            VARCHAR(40) NOT NULL,
  status               VARCHAR(16) NOT NULL DEFAULT 'proposed', -- proposed|approved|launched|paused|ended|rejected
  planned_daily_cents  INTEGER NOT NULL DEFAULT 0,
  planned_total_cents  INTEGER,
  actual_spend_usd     DECIMAL(10,2) NOT NULL DEFAULT 0,        -- synced from platform insights once live
  external_campaign_id VARCHAR(64),
  audience_json        JSON,
  creative_json        JSON,                                     -- copy variants, media refs, landing UTMs
  policy_check         TEXT NOT NULL,                            -- REQUIRED docs/ads-policy.md compliance note
  run_id               INTEGER REFERENCES homepage_team_runs(id) ON DELETE SET NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_status ON ad_campaigns (status, created_at DESC);
