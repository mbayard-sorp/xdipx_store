-- 114: Ad Studio v2, PR-A (docs/store-team/ad-studio-v2-plan.md section 5).
-- Ideas, owner feedback on ideas and creatives, new ad_creatives columns,
-- the daily metrics ledger and the rule event log. The last two are created
-- now so the metrics and rules PRs (G, H) need no further migration.
-- Feedback is OWNER WRITE ONLY (admin routes behind requireAdmin), same
-- contract as social_asset_feedback (migration 104).
--
-- FULLY ADDITIVE: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS and
-- CREATE INDEX IF NOT EXISTS only. No DROP, no RENAME, no ALTER TYPE, no DML.
-- Settings keys are read through code defaults (app/lib/ad-settings.server.ts),
-- so nothing is seeded here.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 114
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS ad_ideas (
  id serial PRIMARY KEY,
  run_id integer,
  concept_slug varchar(64) NOT NULL,
  lane varchar(24) NOT NULL,
  register_tier varchar(8) NOT NULL,
  title varchar(160) NOT NULL,
  one_liner text,
  products jsonb NOT NULL DEFAULT '[]',
  headlines jsonb NOT NULL DEFAULT '[]',
  body jsonb NOT NULL DEFAULT '[]',
  audience jsonb,
  destination_url text,
  break_even_json jsonb,
  policy_check text NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'proposed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ad_ideas_status ON ad_ideas(status, created_at);
CREATE INDEX IF NOT EXISTS idx_ad_ideas_lane ON ad_ideas(lane, status);

CREATE TABLE IF NOT EXISTS ad_idea_feedback (
  id serial PRIMARY KEY,
  idea_id integer NOT NULL REFERENCES ad_ideas(id) ON DELETE CASCADE,
  verdict varchar(4) NOT NULL CHECK (verdict IN ('up', 'down')),
  reasons jsonb NOT NULL DEFAULT '[]',
  note text,
  rated_by varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_idea_feedback_idea ON ad_idea_feedback(idea_id);

CREATE TABLE IF NOT EXISTS ad_creative_feedback (
  id serial PRIMARY KEY,
  creative_id integer NOT NULL REFERENCES ad_creatives(id) ON DELETE CASCADE,
  verdict varchar(4) NOT NULL CHECK (verdict IN ('up', 'down')),
  reasons jsonb NOT NULL DEFAULT '[]',
  note text,
  rated_by varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_creative_feedback_creative ON ad_creative_feedback(creative_id);

ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS idea_id integer REFERENCES ad_ideas(id) ON DELETE SET NULL;
ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS lane varchar(24);
ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS register_tier varchar(8);
ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS slogan text;
ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS layout_template varchar(64);
ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS plate_asset_id integer;
ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS width integer;
ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS height integer;
ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS export_payload jsonb;
ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS external_ad_id varchar(64);
ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS launched_at timestamptz;
ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS paused_at timestamptz;
ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS pause_reason text;
CREATE INDEX IF NOT EXISTS idx_ad_creatives_idea ON ad_creatives(idea_id);

-- One row per creative per day per platform. creative_id is nullable so an
-- account-level day (a Shop Campaigns CSV row with no creative mapping) can
-- still land and feed the burn bar.
CREATE TABLE IF NOT EXISTS ad_creative_daily_metrics (
  id serial PRIMARY KEY,
  creative_id integer REFERENCES ad_creatives(id) ON DELETE CASCADE,
  day date NOT NULL,
  platform varchar(20) NOT NULL,
  spend_cents integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  orders integer NOT NULL DEFAULT 0,
  net_revenue_cents integer NOT NULL DEFAULT 0,
  source varchar(12) NOT NULL DEFAULT 'csv',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ad_metrics_day ON ad_creative_daily_metrics(day);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_metrics_creative_day ON ad_creative_daily_metrics(creative_id, day, platform);

CREATE TABLE IF NOT EXISTS ad_rule_events (
  id serial PRIMARY KEY,
  rule_id varchar(4) NOT NULL,
  creative_id integer REFERENCES ad_creatives(id) ON DELETE CASCADE,
  fired_at timestamptz NOT NULL DEFAULT now(),
  action varchar(24) NOT NULL,
  detail jsonb,
  applied_by varchar(64),
  applied_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ad_rule_events_creative ON ad_rule_events(creative_id, fired_at);
