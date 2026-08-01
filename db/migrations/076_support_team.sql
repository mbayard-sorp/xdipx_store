-- 076_support_team.sql
-- Adds the ninth agent team: support (conversation-quality review over the
-- IVR / SMS / Ask Emma chat surfaces). Ships OFF. Enablement is a deliberate
-- owner step from /admin/homepage-team (Support tab) after the routine's
-- first supervised run; see docs/store-team/routine-support-daily.md (Phase 3
-- of the conversation-surfaces plan).
--
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 076
--
-- Also seeds the two conversation-channel kill switches. These are FAIL-OPEN
-- (read via getKillSwitch, not getValve): a missing row means the channel is
-- live, and only an explicit 'false' turns it off. Seeding 'true' makes the
-- current state visible and editable on the dashboard.

INSERT INTO pipeline_settings (key, value, updated_at) VALUES
  ('support_team_enabled',                  'false', NOW()),
  ('support_team_daily_cents',              '300',   NOW()),
  ('support_team_max_runs',                 '2',     NOW()),
  ('support_team_auto_approve_suggestions', 'false', NOW()),
  ('chat_enabled',                          'true',  NOW()),
  ('sms_agent_enabled',                     'true',  NOW())
ON CONFLICT (key) DO NOTHING;
