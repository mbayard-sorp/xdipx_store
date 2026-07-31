-- 075_content_team_run_cap.sql
-- Raise the content team's run cap from 3 to 8.
--
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 075
--
-- Why: the weekly podcast review (routine 12) shares `team=content` with the
-- daily content writer (routine 9), and the gate allows one run per team at a
-- time. On 2026-07-29 the writer's run 120 started 15:10 UTC and held the lock
-- for 143 minutes; the 16:05 podcast fire opened run 122 at 16:33 and was
-- refused `run_in_progress`. No brief was written, so Thursday's run 131 fell
-- back to a care post. Only two podcastReviewBrief docs and two podcast-notes
-- posts have ever existed (2026-07-15/16 and 07-19/23).
--
-- The trigger moved to 21:05 UTC Wednesdays, clear of every observed writer
-- run including the longest (200 min, ending 18:31 UTC) and the same-day retry
-- pattern (run 123: 17:46 -> 19:13 UTC). But the cap is the second half of the
-- same failure: the cap counts every run ROW regardless of status, and a retry
-- day already burns three (writer + skipped podcast + retry), so the podcast
-- run would hit `over_run_cap` even after the lock cleared.
--
-- 8 matches what `strategy_team_max_runs` was sized to in 074 for the same
-- reason: cap above the scheduled count, not equal to it. Budget is unchanged
-- and is still checked BEFORE the cap in gate(), so `content_team_daily_cents`
-- (500) remains the real ceiling on a runaway day.
--
-- ON CONFLICT DO UPDATE (not DO NOTHING) is deliberate: the point is to correct
-- the existing row that 068 versioned at 3.

INSERT INTO pipeline_settings (key, value, updated_at) VALUES
  ('content_team_max_runs', '8', NOW())
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = NOW();
