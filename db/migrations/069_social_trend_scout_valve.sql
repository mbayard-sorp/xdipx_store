-- 069_social_trend_scout_valve.sql
-- Social-trend-scout valve.
--
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 069
--
-- Why:
--  social_trend_scout_enabled gates the new weekly social-trend-scout routine
--  (Monday 17:00 UTC, team social): platform format trends, trending-sound
--  lyrics verdicts, and competitor/creator activity for the video pipeline.
--  Ships OFF; the owner flips it on the Social tab of /admin/homepage-team
--  after a supervised manual run. See
--  docs/store-team/routine-social-trend-scout.md.

INSERT INTO pipeline_settings (key, value, updated_at) VALUES
  ('social_trend_scout_enabled', 'false', NOW())
ON CONFLICT (key) DO NOTHING;
