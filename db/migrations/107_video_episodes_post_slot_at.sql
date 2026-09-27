-- 107_video_episodes_post_slot_at.sql
-- Ticket #11153: video_episodes.planned_slot_at was overloaded. claimNextEpisode
-- reads it as a render-by date (only claims rows whose slot is now or past),
-- while fanOutVideoToSocialDrafts used the same column as the social draft's
-- post date. The season-1 interim sets planned_slot_at to the render Thursday
-- while the intended post date lived only in prose (concept).
--
-- post_slot_at is the intended POST date; planned_slot_at remains the
-- render-by date read by claimNextEpisode. fanOutVideoToSocialDrafts and the
-- calendar's videoClips now prefer post_slot_at when it is set.
--
-- FULLY ADDITIVE: ADD COLUMN IF NOT EXISTS only. No DROP, no RENAME, no
-- ALTER TYPE, no DML.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 107
-- Idempotent: safe to re-run.

ALTER TABLE video_episodes ADD COLUMN IF NOT EXISTS post_slot_at timestamptz;
