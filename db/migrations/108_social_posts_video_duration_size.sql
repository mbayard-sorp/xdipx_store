-- 108_social_posts_video_duration_size.sql
-- Ticket #11155. After PR #1308 (X chunked video upload), the 140s X duration
-- pre-flight in app/lib/social-publish/x.server.ts cannot fire from the
-- hourly tick because social_posts carries no duration: a 141s clip uploads
-- fully, fails at FINALIZE, and burns one of the two retry attempts.
--
-- duration_sec/size_bytes are populated by fanOutVideoToSocialDrafts from
-- the video job's final asset (media_assets.duration_seconds, plus a
-- best-effort HEAD request for byte size) and read by mediaForPost onto the
-- PublishMedia the X/Instagram adapters already know how to pre-flight
-- against, closing the gap without changing either adapter.
--
-- FULLY ADDITIVE: ADD COLUMN IF NOT EXISTS only. No DROP, no RENAME, no
-- ALTER TYPE, no DML.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 108
-- Idempotent: safe to re-run.

ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS duration_sec numeric(6, 2);
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS size_bytes integer;
