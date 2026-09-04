-- 094_video_script_edits.sql
-- Owner script edits as a writers-room learning signal (ticket #7557).
--
-- The owner can now edit an episode's script text in place on
-- /admin/video-studio/scripts/{id} and save it. Every save captures the
-- before -> after of each changed field so the writers room can read what the
-- owner actually changes and improve, instead of re-deriving it from prose
-- notes. One row per changed field per save.
--
--   video_script_edits
--     episode_id   FK -> video_episodes(id), the episode edited
--     field        which part changed: voiceover | shareLine | presenterLine |
--                    caption.<platform> | siteCut.title | siteCut.dek |
--                    siteCut.copy
--     before_text  the agent-authored text the room shipped (nullable: a field
--                    the room left empty that the owner filled)
--     after_text   the owner's text (nullable: a field the owner cleared)
--     edited_by    the admin email that saved the edit
--     created_at   when
--
-- FULLY ADDITIVE: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS only.
-- No DROP, no RENAME, no ALTER TYPE, no DML. Merges on the ordinary
-- release-engine lane once migration-dry-run is green.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 094
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS video_script_edits (
  id          serial PRIMARY KEY,
  episode_id  integer NOT NULL REFERENCES video_episodes(id) ON DELETE CASCADE,
  field       varchar(48) NOT NULL,
  before_text text,
  after_text  text,
  edited_by   varchar(120) NOT NULL,
  created_at  timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_video_script_edits_episode ON video_script_edits(episode_id);
CREATE INDEX IF NOT EXISTS idx_video_script_edits_created ON video_script_edits(created_at);
