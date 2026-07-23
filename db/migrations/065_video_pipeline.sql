-- 065_video_pipeline.sql
-- Social video pipeline (fal.ai) + ad studio creatives.
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 065
-- Idempotent: safe to re-run.

-- Shared byte/URL/cost ledger for generated media. Bytes live in Vercel Blob;
-- approved product videos graduate to Shopify Files as a second hop.
CREATE TABLE IF NOT EXISTS media_assets (
  id               serial PRIMARY KEY,
  kind             varchar(12) NOT NULL,
  purpose          varchar(24) NOT NULL,
  blob_url         text NOT NULL,
  content_type     varchar(64) NOT NULL,
  duration_seconds decimal(6,2),
  width            integer,
  height           integer,
  cost_usd         decimal(10,5) NOT NULL DEFAULT 0,
  source_model     varchar(64),
  created_at       timestamp NOT NULL DEFAULT NOW()
);

-- One row per video: brief metadata + the stage machine advanced by
-- /cron/video-job-poller. awaiting_frame_approval parks the job for the
-- owner's scene-frame pick before any video spend (video_frame_review valve).
CREATE TABLE IF NOT EXISTS video_jobs (
  id                   serial PRIMARY KEY,
  job_id               varchar(36) NOT NULL,
  product_handle       varchar(255) NOT NULL,
  shopify_product_gid  varchar(64),
  formula              varchar(32) NOT NULL,
  presenter            varchar(64) NOT NULL DEFAULT 'none',
  script_json          jsonb NOT NULL,
  ai_disclosure        boolean NOT NULL DEFAULT true,
  model_tier           varchar(16) NOT NULL,
  target_platforms     jsonb NOT NULL DEFAULT '[]',
  stage                varchar(16) NOT NULL DEFAULT 'scene_frame',
  status               varchar(24) NOT NULL DEFAULT 'queued',
  provider_request_ids jsonb NOT NULL DEFAULT '{}',
  scene_frame_asset_id integer REFERENCES media_assets(id) ON DELETE SET NULL,
  final_asset_id       integer REFERENCES media_assets(id) ON DELETE SET NULL,
  poster_asset_id      integer REFERENCES media_assets(id) ON DELETE SET NULL,
  cost_usd             decimal(10,5) NOT NULL DEFAULT 0,
  metrics_json         jsonb,
  error                text,
  team                 varchar(24) NOT NULL DEFAULT 'video',
  run_id               integer REFERENCES homepage_team_runs(id) ON DELETE SET NULL,
  created_at           timestamp NOT NULL DEFAULT NOW(),
  updated_at           timestamp NOT NULL DEFAULT NOW(),
  completed_at         timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_video_jobs_job_id ON video_jobs (job_id);
CREATE INDEX IF NOT EXISTS idx_video_jobs_status ON video_jobs (status, created_at);
-- Poller drain query index. awaiting_frame_approval is EXCLUDED: parked jobs
-- wait for the owner, not the poller.
CREATE INDEX IF NOT EXISTS idx_video_jobs_inflight ON video_jobs (updated_at)
  WHERE status IN ('queued', 'running', 'awaiting_provider', 'applying');

-- media_assets back-reference to its owning job (added after video_jobs exists).
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS
  video_job_id integer REFERENCES video_jobs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_media_assets_job ON media_assets (video_job_id);

-- Ad studio creative variants under an ad_campaigns proposal. policy_check is
-- required per creative (docs/ads-policy.md; Meta/TikTok push stubs hard-block
-- the pleasure catalog).
CREATE TABLE IF NOT EXISTS ad_creatives (
  id             serial PRIMARY KEY,
  ad_campaign_id integer NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  format         varchar(8) NOT NULL,
  asset_id       integer NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  hook_copy      text,
  status         varchar(16) NOT NULL DEFAULT 'draft',
  policy_check   text NOT NULL,
  created_at     timestamp NOT NULL DEFAULT NOW(),
  updated_at     timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_campaign ON ad_creatives (ad_campaign_id, status);

-- Correlation key for per-clip spend attribution (video_jobs.job_id, ad batch id).
ALTER TABLE api_token_log ADD COLUMN IF NOT EXISTS ref_id varchar(64);

-- Video fan-out linkage on social drafts.
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS video_job_id integer REFERENCES video_jobs(id) ON DELETE SET NULL;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS poster_url text;

-- Video team valves + youtube posting frequency. Everything ships OFF except
-- the frame-review gate, which ships ON (owner approves frames before video
-- spend until they flip it). DO NOTHING so later owner flips are never clobbered.
INSERT INTO pipeline_settings (key, value, updated_at) VALUES
  ('video_team_enabled',                  'false', NOW()),
  ('video_team_daily_cents',              '2000',  NOW()),
  ('video_team_max_runs',                 '1',     NOW()),
  ('video_team_auto_approve_suggestions', 'false', NOW()),
  ('video_team_autopublish',              'false', NOW()),
  ('video_team_max_cost_cents',           '600',   NOW()),
  ('video_frame_review',                  'true',  NOW()),
  ('social_freq_youtube',                 '0',     NOW())
ON CONFLICT (key) DO NOTHING;
