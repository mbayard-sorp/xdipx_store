-- 049_homepage_team.sql
-- Control-plane tables for the autonomous homepage merchandising team.
--
-- Cost/spend is NOT stored here — it lives in api_token_log (feature
-- 'homepage-merchandise' | 'homepage-design' | 'homepage-images') and surfaces
-- on /admin/usage. These tables track run status, the activity/transcript feed
-- for the admin dashboard, and the process-optimizer's suggestions.
--
-- NOT YET APPLIED in this PR — apply with:
--   npx tsx scripts/apply-migrations.ts --from 049

-- One row per team run (daily merchandise run, or a weekly design cycle).
CREATE TABLE IF NOT EXISTS homepage_team_runs (
  id             SERIAL PRIMARY KEY,
  run_type       VARCHAR(24) NOT NULL,            -- 'merchandise' | 'design' | 'manual'
  status         VARCHAR(16) NOT NULL DEFAULT 'running', -- running|succeeded|failed|skipped|rolled_back
  current_phase  VARCHAR(48),                     -- live status for the dashboard
  current_agent  VARCHAR(48),                     -- which role is active right now
  summary        TEXT,                            -- human-readable result summary
  pr_url         TEXT,                            -- design-cycle PR link, if any
  error          TEXT,
  attempt_count  INTEGER NOT NULL DEFAULT 1,      -- self-heal circuit-breaker counter
  started_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  finished_at    TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_homepage_team_runs_started ON homepage_team_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_homepage_team_runs_status  ON homepage_team_runs (status, started_at DESC);

-- Per-step / per-agent activity feed — powers the dashboard timeline and the
-- conversation viewer. Full verbatim transcripts go to private Vercel Blob;
-- transcript_ref points at them. `summary` holds the readable inline line.
CREATE TABLE IF NOT EXISTS homepage_team_events (
  id             SERIAL PRIMARY KEY,
  run_id         INTEGER NOT NULL REFERENCES homepage_team_runs(id) ON DELETE CASCADE,
  ts             TIMESTAMP NOT NULL DEFAULT NOW(),
  agent_role     VARCHAR(48),                     -- 'homepage-orchestrator' | 'emma-copywriter' | ...
  phase          VARCHAR(48),
  event_type     VARCHAR(16) NOT NULL,            -- step|message|tool|decision|error
  summary        TEXT NOT NULL,
  transcript_ref TEXT                             -- Vercel Blob key for full verbatim, if any
);

CREATE INDEX IF NOT EXISTS idx_homepage_team_events_run ON homepage_team_events (run_id, ts);

-- process-optimizer suggestions — human-approved before anything changes.
CREATE TABLE IF NOT EXISTS homepage_team_suggestions (
  id              SERIAL PRIMARY KEY,
  run_id          INTEGER REFERENCES homepage_team_runs(id) ON DELETE SET NULL,
  category        VARCHAR(32) NOT NULL,           -- 'model'|'turns'|'caching'|'prompt'|'agents'|'other'
  suggestion      TEXT NOT NULL,
  est_savings_usd DECIMAL(10,4) NOT NULL DEFAULT 0,
  cx_risk         VARCHAR(8) NOT NULL DEFAULT 'low', -- low|med|high
  status          VARCHAR(12) NOT NULL DEFAULT 'proposed', -- proposed|approved|applied|dismissed
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_homepage_team_suggestions_status ON homepage_team_suggestions (status, created_at DESC);

-- Marketing calendar — promos, holidays, campaign themes the team merchandises around.
CREATE TABLE IF NOT EXISTS marketing_calendar (
  id          SERIAL PRIMARY KEY,
  event_date  DATE NOT NULL,
  name        VARCHAR(120) NOT NULL,
  type        VARCHAR(16) NOT NULL DEFAULT 'promo', -- holiday|promo|campaign
  theme       TEXT,
  status      VARCHAR(12) NOT NULL DEFAULT 'planned', -- planned|active|done|skipped
  assets_json JSON,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_calendar_date ON marketing_calendar (event_date);
