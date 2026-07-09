-- 052_enable_teams.sql
-- Owner-directed enablement (2026-07): flip the built-but-off switches for
-- the five agent teams, the suggestion apply path, and the unattended
-- import->live chain. Audit: docs/agent-automation-audit-2026-07.md §4 Tier 1.
--
-- Apply ONLY AFTER the cron.yml homepage-healthcheck fix is merged and
-- verified firing in GitHub Actions — the healthcheck is the homepage
-- team's auto-publish safety net.
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 052
--
-- Deliberately NOT set here: social_team_autopost (draft-only stays) and
-- all budget/cap keys (code-side defaults apply).

INSERT INTO pipeline_settings (key, value, updated_at) VALUES
  ('homepage_team_enabled',    'true', NOW()),
  ('social_team_enabled',      'true', NOW()),
  ('ads_team_enabled',         'true', NOW()),
  ('email_team_enabled',       'true', NOW()),
  ('strategy_team_enabled',    'true', NOW()),
  ('suggestion_apply_enabled', 'true', NOW()),
  ('import_monitor_phase',     '2',    NOW()),
  ('product_manager_enabled',  'true', NOW()),
  ('import_enrich_enabled',    'true', NOW())
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = NOW();
