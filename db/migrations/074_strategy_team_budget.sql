-- 074_strategy_team_budget.sql
-- Version the strategy team's spend and run ceilings, which no migration ever
-- seeded.
--
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 074
--
-- Why: `strategy` is the busiest team on the board and the only active one
-- whose valves were never written. 052 seeded `strategy_team_enabled` and
-- stopped there, so `strategy_team_daily_cents` has never existed as a row and
-- getTeamConfig falls back to TEAM_DEFAULTS.strategy — 300 cents, i.e. $3.00
-- a day, a number chosen when the team meant one advisory retro a week.
--
-- Six routines now run as team=strategy on a Monday (Weekly Strategy with five
-- sub-agents, R-DEV twice, R-QA, Cost Review, Apply Pass), two of them coding
-- passes that run typecheck, tests, and a build per ticket. gate() checks the
-- budget BEFORE the run cap (app/lib/team.server.ts), so the failure this
-- produces reads as `over_budget` on the later runs and looks like a spend
-- problem rather than an unset valve.
--
-- The run cap is the same story one step further along: docs/store-team/
-- routine-schedule.md has required 8 since the cap-sizing audit, production
-- carries a hand-written 6, and the cap counts every run ROW whether or not the
-- run succeeded — so six scheduled runs on six slots means the first retry,
-- manual fire, or crashed run locks out the Apply Pass. This is the same
-- failure that hid every apply run from 2026-07-07 to 07-21, when the cap was 1.
--
-- ON CONFLICT DO UPDATE (not DO NOTHING) is deliberate for the run cap: the
-- point is to correct the existing under-sized row. The budget row is written
-- the same way so re-running the migration converges rather than leaving
-- whatever a later hand-edit left behind.

INSERT INTO pipeline_settings (key, value, updated_at) VALUES
  ('strategy_team_daily_cents', '1500', NOW()),
  ('strategy_team_max_runs',    '8',    NOW())
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = NOW();
