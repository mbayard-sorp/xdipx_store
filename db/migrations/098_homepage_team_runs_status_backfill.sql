-- 098_homepage_team_runs_status_backfill.sql
-- One-time backfill of homepage_team_runs.status/finished_at for rows written
-- before the API validated status against a fixed enum and before ticket
-- #8027's `finish` path (api.team.event.tsx) made status and finished_at
-- travel together. Ticket #9336 (tracker milestone c3-runsem,
-- self-healing-automation.md).
--
-- Bug (two related defects, same root cause): POST /api/team/run
-- {op:'update', id, update} (app/routes/api.team.run.tsx) cast the request
-- body's `update` straight into RunUpdate with no runtime check, so any
-- caller could write a status string outside the type union
-- ('running'|'succeeded'|'failed'|'skipped'|'rolled_back') and it would land
-- unvalidated. Live rows show FIVE stale spellings ('completed', 'success',
-- 'done', 'finished', plus 'completed' recurring) written before that gap
-- was closed elsewhere. Separately, a caller could set status:'succeeded'
-- without also passing finished:true, leaving finished_at permanently NULL
-- on an otherwise-terminal row. The companion PR (ticket #9336, this same
-- migration's sibling code change) closes both gaps going forward in
-- app/routes/api.team.run.tsx; this migration is the one-time cleanup of
-- rows written before that fix landed.
--
-- NOT ADDITIVE: this file is UPDATE (DML), not DDL. Per
-- scripts/apply-additive-migrations.ts, a data-mutating statement never
-- auto-applies at build time and stays on the manual path
-- (scripts/apply-migrations.ts), same as app/lib/github.server.ts's
-- migration classifier: this PR is protected-path and needs an owner to run
-- it, not just merge it.
--
-- Scope: every row in homepage_team_runs, computed 2026-09-15 against
-- production, whose status is outside the five valid values, OR whose status
-- is 'succeeded' with finished_at NULL (51 rows total: 14 with a stale
-- status spelling, 37 already 'succeeded' but never stamped). All 14
-- stale-status rows read as a successful completion under every spelling
-- ('completed'/'success'/'done'/'finished') -- none reads as a failure --
-- so every status fix below normalizes to 'succeeded'.
--
-- finished_at backfill value, in priority order: the row's own finished_at
-- if it already had one (status-only fix); otherwise the latest
-- homepage_team_events.ts recorded against that run_id (the closest real
-- signal of when the run's last activity happened); otherwise, for the small
-- number of rows with no recorded events at all, started_at (a documented
-- floor estimate, not a claim of zero duration).
--
-- Each statement is scoped by id AND the row's exact current (status,
-- finished_at) pair, so a second run against a DB where some rows were
-- already corrected by hand is a no-op rather than clobbering a newer write,
-- matching the pattern in 092_owner_blockers_dedupe_key_canonicalize.sql.
--
-- Apply (manual, owner-run): DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 098
-- Idempotent: safe to re-run.

-- Status-only fixes (already had a finished_at; just the spelling was stale).
UPDATE homepage_team_runs SET status = 'succeeded' WHERE id = 170 AND status = 'completed' AND finished_at = '2026-08-03T22:30:50.023Z';
UPDATE homepage_team_runs SET status = 'succeeded' WHERE id = 207 AND status = 'success' AND finished_at = '2026-08-07T08:32:52.151Z';
UPDATE homepage_team_runs SET status = 'succeeded' WHERE id = 234 AND status = 'completed' AND finished_at = '2026-08-09T09:47:27.883Z';
UPDATE homepage_team_runs SET status = 'succeeded' WHERE id = 302 AND status = 'success' AND finished_at = '2026-08-13T22:34:21.770Z';
UPDATE homepage_team_runs SET status = 'succeeded' WHERE id = 303 AND status = 'done' AND finished_at = '2026-08-14T02:27:24.992Z';
UPDATE homepage_team_runs SET status = 'succeeded' WHERE id = 398 AND status = 'completed' AND finished_at = '2026-08-19T14:17:57.091Z';
UPDATE homepage_team_runs SET status = 'succeeded' WHERE id = 477 AND status = 'finished' AND finished_at = '2026-08-24T05:23:49.360Z';
UPDATE homepage_team_runs SET status = 'succeeded' WHERE id = 584 AND status = 'done' AND finished_at = '2026-08-30T10:20:05.246Z';

-- Status + finished_at fixes (stale spelling AND never stamped).
UPDATE homepage_team_runs SET status = 'succeeded', finished_at = '2026-08-09T03:46:15.609Z' WHERE id = 231 AND status = 'completed' AND finished_at IS NULL;
UPDATE homepage_team_runs SET status = 'succeeded', finished_at = '2026-08-10T02:25:35.137Z' WHERE id = 243 AND status = 'success' AND finished_at IS NULL;
UPDATE homepage_team_runs SET status = 'succeeded', finished_at = '2026-08-11T08:06:45.299Z' WHERE id = 261 AND status = 'success' AND finished_at IS NULL;
UPDATE homepage_team_runs SET status = 'succeeded', finished_at = '2026-08-15T15:34:33.225Z' WHERE id = 328 AND status = 'completed' AND finished_at IS NULL;
UPDATE homepage_team_runs SET status = 'succeeded', finished_at = '2026-08-16T15:47:03.184Z' WHERE id = 347 AND status = 'completed' AND finished_at IS NULL;
UPDATE homepage_team_runs SET status = 'succeeded', finished_at = '2026-09-05T10:29:01.862Z' WHERE id = 698 AND status = 'completed' AND finished_at IS NULL;

-- finished_at-only fixes (status was already 'succeeded'; never stamped).
UPDATE homepage_team_runs SET finished_at = '2026-07-06T00:26:52.293Z' WHERE id = 12 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-07-14T14:16:28.004Z' WHERE id = 32 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-07-21T14:12:26.075Z' WHERE id = 68 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-07-22T14:14:09.253Z' WHERE id = 77 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-07-28T14:19:18.969Z' WHERE id = 109 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-07-30T01:54:16.568Z' WHERE id = 125 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-03T21:16:26.929Z' WHERE id = 169 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-06T03:34:38.095Z' WHERE id = 190 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-10T21:12:53.896Z' WHERE id = 256 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-16T14:44:41.441Z' WHERE id = 345 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-16T20:38:46.540Z' WHERE id = 349 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-19T22:46:41.325Z' WHERE id = 406 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-24T15:23:59.573Z' WHERE id = 483 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-24T21:13:06.304Z' WHERE id = 489 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-24T22:47:42.722Z' WHERE id = 491 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-25T15:18:39.312Z' WHERE id = 500 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-25T17:29:35.476Z' WHERE id = 508 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-27T03:34:22.109Z' WHERE id = 529 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-27T15:14:19.042Z' WHERE id = 536 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-27T16:35:06.763Z' WHERE id = 541 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-27T22:46:26.745Z' WHERE id = 548 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-28T10:37:24.314Z' WHERE id = 553 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-28T15:01:20.926Z' WHERE id = 556 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-28T22:59:35.126Z' WHERE id = 563 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-29T14:37:14.486Z' WHERE id = 572 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-30T11:34:21.774Z' WHERE id = 586 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-30T14:52:17.243Z' WHERE id = 588 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-08-31T23:24:26.971Z' WHERE id = 614 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-09-01T16:57:11.418Z' WHERE id = 630 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-09-02T21:34:10.075Z' WHERE id = 656 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-09-03T22:41:48.538Z' WHERE id = 676 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-09-04T12:23:35.821Z' WHERE id = 684 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-09-04T15:07:22.926Z' WHERE id = 685 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-09-05T19:01:04.876Z' WHERE id = 703 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-09-06T11:34:23.666Z' WHERE id = 717 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-09-08T11:34:46.290Z' WHERE id = 754 AND status = 'succeeded' AND finished_at IS NULL;
UPDATE homepage_team_runs SET finished_at = '2026-09-12T22:22:35.539Z' WHERE id = 840 AND status = 'succeeded' AND finished_at IS NULL;
