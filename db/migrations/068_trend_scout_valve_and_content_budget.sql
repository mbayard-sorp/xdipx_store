-- 068_trend_scout_valve_and_content_budget.sql
-- Trend-scout valve + content-team budget/run-cap versioning.
--
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 068
--
-- Why:
--  1. trend_scout_enabled gates the new weekly trend-scout routine (Saturday
--     16:00 UTC, team content). Ships OFF; the owner flips it on the Content
--     tab of /admin/homepage-team after a supervised manual run. See
--     docs/store-team/routine-trend-scout.md.
--  2. content_team_daily_cents 300 -> 500: the daily post now also passes the
--     sex-wellness-reviewer accuracy gate (WebSearch claim verification adds
--     ~30-60c/post) and Saturdays carry the trend-scout research run
--     (~100-150c). 500 covers the worst day with margin.
--  3. content_team_max_runs = 3 versions the 2026-07-21 prod hand-edit that
--     the 2026-07-22 automation-drift audit flagged as unversioned. Double
--     days (Sat trend-scout, Sun SEO curation, Wed podcast review) need the
--     third slot as gate-retry headroom.
-- Guarded UPDATEs only upgrade the seeded defaults; any other owner-set value
-- is left alone.

INSERT INTO pipeline_settings (key, value, updated_at) VALUES
  ('trend_scout_enabled', 'false', NOW()),
  ('content_team_daily_cents', '500', NOW()),
  ('content_team_max_runs', '3', NOW())
ON CONFLICT (key) DO NOTHING;

UPDATE pipeline_settings SET value = '500', updated_at = NOW()
  WHERE key = 'content_team_daily_cents' AND value = '300';

UPDATE pipeline_settings SET value = '3', updated_at = NOW()
  WHERE key = 'content_team_max_runs' AND value = '2';
