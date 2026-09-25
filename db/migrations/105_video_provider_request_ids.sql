-- 105_video_provider_request_ids.sql
-- Make a provider request id (Atlas, fal, Wavespeed) resolvable to the job,
-- episode and asset it produced (ticket #11552, live gap in #11310).
--
-- media_assets.provider_request_id records the provider call that produced a
-- scene frame, clip or lipsync asset. The GIN index on
-- video_jobs.provider_request_ids makes the per-stage handle lookup
-- (provider_request_ids @? '$.* ? (@.requestId == "...")') indexable.
--
-- FULLY ADDITIVE: ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS only.
-- No DROP, no RENAME, no ALTER TYPE, no DML.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 105
-- Idempotent: safe to re-run.

ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS provider_request_id varchar(64);
CREATE INDEX IF NOT EXISTS idx_media_assets_provider_request_id ON media_assets(provider_request_id);
CREATE INDEX IF NOT EXISTS idx_video_jobs_provider_request_ids ON video_jobs USING GIN (provider_request_ids);
