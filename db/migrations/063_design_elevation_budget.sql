-- 063_design_elevation_budget.sql
-- Lift the homepage team's budget ceilings for the design-elevation push.
--
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 063
--
-- Why: explicit owner direction (2026-07-20) to lift budget constraints on the
-- homepage team so the design-elevation work (competitor teardown, fold-first
-- imagery pass, variant-b flip) is not throttled. Two gate mechanics drive the
-- numbers, per team review of the plan:
--   * gate() only enforces homepage_team_daily_cents; design-cycle spend
--     (homepage-design / homepage-images) bills against the SAME daily bucket
--     as Routine A, so the daily ceiling must cover a full design cycle plus
--     the day's merchandising run. homepage_team_build_cents stays an advisory
--     self-limit for the cycle, not a gate input.
--   * homepage_team_max_runs at the old default of 4 would lock out a
--     design-cycle run mid-day (over_run_cap) once the daily merchandiser,
--     retries, and checkpointed cycle segments are counted.
-- The kill switch (homepage_team_enabled) and every downstream approval gate
-- are unchanged. Flip values back down from /admin/homepage-team at any time.

INSERT INTO pipeline_settings (key, value, updated_at) VALUES
  ('homepage_team_daily_cents', '60000', NOW()),
  ('homepage_team_max_images', '100', NOW()),
  ('homepage_team_build_cents', '50000', NOW()),
  ('homepage_team_max_runs', '10', NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
