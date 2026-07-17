-- 062_suggestion_auto_approve.sql
-- Per-team auto-approval of the improvement-bus suggestions, plus an audit
-- column recording WHO moved each row off 'proposed'.
--
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 062
--
-- Why: the owner asked to stop being the triage bottleneck on "Suggestions
-- (all teams)". Auto-approve removes the owner from the proposed->approved
-- step for a given team; it does NOT remove the downstream execution gates
-- (agent-editor PRs are still merged by the owner; campaign/promo/code kinds
-- are still executed by hand). Rolled out to the homepage team first; other
-- teams stay manual until their own valve is flipped from the dashboard.

-- 1. Audit column: 'auto' (valve) | 'owner' (dashboard) | NULL (legacy rows).
ALTER TABLE homepage_team_suggestions
  ADD COLUMN IF NOT EXISTS decided_by varchar(24);

-- 2. Turn homepage auto-approve ON now (explicit owner direction). Other teams
--    default OFF; flip `{team}_team_auto_approve_suggestions` on the matching
--    tab of /admin/homepage-team when ready. DO UPDATE so re-seeding is
--    idempotent and the flip is deliberate rather than skipped.
INSERT INTO pipeline_settings (key, value, updated_at) VALUES
  ('homepage_team_auto_approve_suggestions', 'true', NOW())
ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW();

-- 3. Turn the agent-editor apply valve ON so auto-approved instruction/config
--    rows actually become PRs (the owner still merges every PR). Force-set per
--    owner direction; DO UPDATE because this key was seeded OFF earlier.
INSERT INTO pipeline_settings (key, value, updated_at) VALUES
  ('suggestion_apply_enabled', 'true', NOW())
ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW();
