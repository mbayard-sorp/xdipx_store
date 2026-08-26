-- 086_video_episodes.sql
-- The serialized video program's production ledger (ticket #5711, all-hands
-- 2026-08-26). Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 086
--
-- FULLY ADDITIVE BY DESIGN: only CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT
-- EXISTS, and CREATE [UNIQUE] INDEX IF NOT EXISTS, so this file rides the
-- ordinary release lane once migration-dry-run is green. No UPDATE/backfill
-- statements (the media_kind backfill happens in app code behind the existing
-- URL/videoJobId inference fallback), and no valve INSERT (a missing
-- pipeline_settings row already reads as OFF, which is the intended ship
-- state for video_program_enabled; the owner's first flip creates the row).
--
-- What this creates:
--   video_series    the show bible's database half: near-static identity rows.
--   video_episodes  the unit of production. One row per intended video,
--                   created by the writers room BEFORE any spend. The owner's
--                   approval on this row is what arms a render; the enqueue
--                   guard (ticket #5712) compares spoken text byte-for-byte
--                   against script_json here and refuses drift.
--
-- Deliberate absences:
--   - No stored display status beyond production_status's coarse phases:
--     the owner-facing label derives in app code from (episode, job, posts).
--   - No 'owned' placement role and no 'personal_experience' mention type in
--     the documented vocabulary: shoppers-not-owners is enforced by the app
--     validators against the licensed lists (considered|compared|gifted|
--     rejected and spec_cited|review_pattern|price|category).
--   - No FK on video_jobs.episode_id / social_posts.episode_id (plain ints):
--     social_posts carries no FKs by convention, and the jobs<->episodes pair
--     would otherwise be circular. video_episodes.video_job_id carries the
--     one real FK.

CREATE TABLE IF NOT EXISTS video_series (
  id              serial PRIMARY KEY,
  slug            varchar(48)  NOT NULL,
  title           varchar(120) NOT NULL,
  premise         text,
  status          varchar(12)  NOT NULL DEFAULT 'active',   -- active|paused|retired
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_video_series_slug ON video_series (slug);

CREATE TABLE IF NOT EXISTS video_episodes (
  id                  serial PRIMARY KEY,
  episode_uid         varchar(36)  NOT NULL,                -- randomUUID; stable external handle
  series_id           integer      NOT NULL REFERENCES video_series(id) ON DELETE RESTRICT,
  season_number       smallint     NOT NULL DEFAULT 1,
  episode_number      integer      NOT NULL,

  -- Concept (writers room, phase: idea/drafting)
  concept             text,
  logline             varchar(240) NOT NULL,
  formula             varchar(32)  NOT NULL,                -- validated against VIDEO_FORMULAS
  arc_position        varchar(16)  NOT NULL DEFAULT 'standalone', -- setup|escalation|turn|payoff|standalone
  opens_loop_key      varchar(48),
  pays_off_loop_key   varchar(48),
  callback_to_episode integer,                              -- aired episode_number named on screen (SE5)
  part2_hook          text,

  -- Story
  storyboard_json     jsonb,                                -- beats the studio renders read-only pre-approval
  hook_text           varchar(240),
  hook_pattern        varchar(32),                          -- validated against HOOK_PATTERNS
  cast_slugs          jsonb        NOT NULL DEFAULT '[]'::jsonb,
  product_placements  jsonb        NOT NULL DEFAULT '[]'::jsonb,
  script_json         jsonb,                                -- the VideoScriptJson the pipeline receives verbatim
  site_cut_json       jsonb,                                -- register-9 written treatment {title, dek, copy}
  model_tier          varchar(16),
  est_cost_usd        numeric(10,5),
  gate_verdicts_json  jsonb,                                -- {doctor, voice} verdicts attached at propose

  -- Owner gate
  production_status   varchar(16)  NOT NULL DEFAULT 'idea', -- idea|drafting|pending_approval|approved|needs_changes|rejected|rendering|rendered|scheduled|posted|measured|shelved|failed
  approved_by         varchar(60),
  approved_at         timestamptz,
  batch_id            varchar(36),                          -- one owner sitting = one batch
  reject_reason       text,
  review_notes_json   jsonb,                                -- append-only [{at, decision, tags[], note, by}]
  is_reserve          boolean      NOT NULL DEFAULT false,  -- evergreen fallback episode

  -- Render
  video_job_id        integer REFERENCES video_jobs(id) ON DELETE SET NULL,
  prior_job_ids_json  jsonb,                                -- retakes: superseded video_jobs ids
  render_started_at   timestamptz,
  rendered_at         timestamptz,
  actual_cost_usd     numeric(10,5),

  -- Distribution
  planned_slot_at     timestamptz,                          -- fanOutVideoToSocialDrafts writes this into scheduled_at
  posted_at           timestamptz,
  measured_at         timestamptz,

  created_by          varchar(60)  NOT NULL DEFAULT 'agent',
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_video_episodes_uid    ON video_episodes (episode_uid);
CREATE UNIQUE INDEX IF NOT EXISTS uq_video_episodes_number ON video_episodes (series_id, season_number, episode_number);
CREATE INDEX IF NOT EXISTS idx_video_episodes_status ON video_episodes (production_status, planned_slot_at);
CREATE INDEX IF NOT EXISTS idx_video_episodes_batch  ON video_episodes (batch_id);
CREATE INDEX IF NOT EXISTS idx_video_episodes_job    ON video_episodes (video_job_id);
CREATE INDEX IF NOT EXISTS idx_video_episodes_place  ON video_episodes USING gin (product_placements jsonb_path_ops);

-- Learn-mode attribution seam + stored media kind (collapses five duplicated
-- inference predicates; inference stays as the fallback for pre-086 rows).
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS episode_id integer;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS media_kind varchar(8);   -- image|video|none

-- Repair the three columns db/schema.ts:203-206 declares but whose migration
-- (085_social_posts_alt_text_brief.sql) was lost in a squash merge; PR #920
-- already ships code writing alt_text. Idempotent if prod was hand-patched.
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS alt_text    text;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS image_brief text;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS subject     text;

CREATE INDEX IF NOT EXISTS idx_social_posts_episode ON social_posts (episode_id);

-- Back-reference + per-video RunPod idle confirmation (ticket #5717).
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS episode_id               integer;
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS runpod_idle_confirmed_at timestamptz;
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS runpod_idle_probe_json   jsonb;

CREATE INDEX IF NOT EXISTS idx_video_jobs_episode ON video_jobs (episode_id);
CREATE INDEX IF NOT EXISTS idx_video_jobs_runpod_unconfirmed ON video_jobs (completed_at)
  WHERE runpod_idle_confirmed_at IS NULL;
