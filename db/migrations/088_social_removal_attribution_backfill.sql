-- 088_social_removal_attribution_backfill.sql
-- Backfills removal_source (added in 087) on the three social_posts rows
-- already known to be deleted, per the facts on record as of ticket #6758:
--
--   #145 (Instagram) -> 'owner'    the owner said in-session (2026-08-31) he
--                                  removed this post himself; owner blocker
--                                  #59 was dismissed on that statement.
--   #23, #80 (Instagram) -> 'platform'  owner blocker #18 ("Instagram removed
--                                  2 posts in 14 days; autopublish turned
--                                  OFF") — Instagram, not the owner, took
--                                  these down.
--   #64 (X) -> 'unknown'           owner blocker #19 flagged the same
--                                  ambiguity for this post and it was never
--                                  answered either way; still open.
--
-- NOT ADDITIVE: this file is UPDATE (DML), not DDL. Per
-- scripts/apply-additive-migrations.ts, a data-mutating statement never
-- auto-applies at build time and stays on the manual path
-- (scripts/apply-migrations.ts), same as app/lib/github.server.ts's
-- migration classifier: this PR is protected-path and needs an owner to run
-- it, not just merge it.
--
-- Scoped by id AND the current status/value, so a second run (or a run
-- against a DB where one of these rows was already re-attributed by hand)
-- is a no-op rather than clobbering a newer answer.
--
-- Apply (manual, owner-run): DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 088
-- Idempotent: safe to re-run.

UPDATE social_posts SET removal_source = 'owner'
  WHERE id = 145 AND status = 'deleted' AND (removal_source IS NULL OR removal_source = 'unknown');

UPDATE social_posts SET removal_source = 'platform'
  WHERE id IN (23, 80) AND status = 'deleted' AND (removal_source IS NULL OR removal_source = 'unknown');

UPDATE social_posts SET removal_source = 'unknown'
  WHERE id = 64 AND status = 'deleted' AND removal_source IS NULL;
