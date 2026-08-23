-- 083_video_jobs_scenes.sql
-- Multi-scene video jobs (Phase 3, 20-60s videos, ticket TBD). A job may now
-- describe 2-8 scenes rendered as separate clips and concatenated into one
-- longer video, instead of always one scene frame + one clip.
--
-- scenes_json: the validated + normalized scene list (video-pipeline.server.ts's
-- validateScenes), parallel-indexed with scene_state_json. Both columns are
-- NULL for every existing row and every single-scene job going forward — the
-- poller branches on scenes_json's presence/length, so the single-clip MVP
-- path (scene_frame -> clip -> lipsync -> assembly -> poster -> done) stays
-- byte-for-byte unchanged when they are absent.
--
-- FULLY ADDITIVE — two nullable ADD COLUMN statements, nothing else. Merges on
-- the ordinary release-engine lane once migration-dry-run is green (no owner
-- escalation required).
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 083
-- Idempotent: safe to re-run.

ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS scenes_json jsonb;
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS scene_state_json jsonb;
