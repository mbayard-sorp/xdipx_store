-- 101_drop_runpod_idle_video_job_cols.sql
-- RunPod video pipeline deprecation (ADR-016 Phase 4). RunPod's serverless
-- endpoint and network volume are already deleted (owner blocker 225), and
-- the only code that read or wrote these two columns was removed on the
-- ordinary lane in PR #1315: confirmRunpodIdle (video-pipeline.server.ts)
-- and the /cron/runpod-pod-watch handler (server/cron.ts). Nothing on main
-- reads or writes them once #1315 is merged.
--
--   video_jobs.runpod_idle_confirmed_at  DROP.
--   video_jobs.runpod_idle_probe_json    DROP.
--
-- NOT ADDITIVE (a DROP COLUMN, not an ADD): protected path per
-- app/lib/github.server.ts, escalates to the owner, not an ordinary-lane
-- merge. Depends on PR #1315 merging first -- this branch is stacked on it,
-- not on bare main, and the schema.ts lines removing RunpodIdleProbe and the
-- two Drizzle column definitions ship in the same commit as this file.
--
-- If the owner would rather not run a DROP right now, skipping this
-- migration is safe: the columns are already dead weight with #1315 merged,
-- just not reclaimed.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 101
-- Idempotent: safe to re-run (IF EXISTS guards a rerun after partial apply).

ALTER TABLE video_jobs DROP COLUMN IF EXISTS runpod_idle_confirmed_at;
ALTER TABLE video_jobs DROP COLUMN IF EXISTS runpod_idle_probe_json;
