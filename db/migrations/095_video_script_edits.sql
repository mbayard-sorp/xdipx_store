-- 095_video_script_edits.sql
-- Per-field before/after diff of owner script edits (ticket #7567, B1 of
-- #7559 -- Part B of #7557). Written by editEpisodeScript() on every owner
-- save; read by a future writers-room prompt change (B2, agent-editor's
-- lane) as a line-level "what the owner changed" signal.
--
-- FULLY ADDITIVE: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS
-- only. No DROP, no RENAME, no ALTER TYPE, no DML.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 095
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS video_script_edits (
  id          serial PRIMARY KEY,
  episode_id  integer      NOT NULL REFERENCES video_episodes(id) ON DELETE CASCADE,
  field       varchar(64)  NOT NULL,
  before      text,
  after       text         NOT NULL,
  edited_by   varchar(60)  NOT NULL,
  created_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_video_script_edits_episode
  ON video_script_edits (episode_id, created_at);
