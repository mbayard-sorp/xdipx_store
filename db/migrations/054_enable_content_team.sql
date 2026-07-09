-- 054_enable_content_team.sql
-- Adds the sixth agent team: content (daily Notebook blog writer).
-- Ships OFF. Enablement is a deliberate owner step from /admin/homepage-team
-- (Content tab) after the first supervised run passes; see
-- docs/store-team/routine-content-daily.md enablement runbook.
--
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 054
--
-- content_team_autopublish is the owner-approved day-one auto-publish valve:
-- when false the routine still runs but leaves posts as Sanity drafts.

INSERT INTO pipeline_settings (key, value, updated_at) VALUES
  ('content_team_enabled',     'false', NOW()),
  ('content_team_daily_cents', '300',   NOW()),
  ('content_team_max_runs',    '2',     NOW()),
  ('content_team_autopublish', 'false', NOW())
ON CONFLICT (key) DO NOTHING;
