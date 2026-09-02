-- 090_cron_runs.sql
-- Durable records for scheduled work (2026-09-01 automation audit, Stage C).
--
-- Invariant 2 of the self-healing program: nothing is healed that is not first
-- recorded. Today a cron's only trace is a Vercel function log nothing reads,
-- and scheduler status is treated as a health signal even though a scheduler
-- reports "fired", never "worked". The pricing batch proved the cost: it was
-- SIGKILLed at the 300s ceiling every morning for at least four days, wrote no
-- error (a SIGKILL is not a throw), and the digest printed GOOD on every one of
-- those days because its test was `COUNT(*) > 0`.
--
--   cron_runs           one row per recorded invocation. Written in a `finally`
--                       so both timestamps and the terminal status land in a
--                       single INSERT: an INSERT-then-UPDATE pair doubles the
--                       writes AND invents a started-without-finish class that
--                       is indistinguishable from a real kill.
--
--   cron_expectations   the floor each scheduled surface is held to. Covers
--                       BOTH scheduler planes. `vercel.json` is not the whole
--                       truth: `.github/workflows/checkout-probe.yml` runs the
--                       browser checkout probe at 30 7 * * * from GitHub
--                       Actions, outside Vercel, outside the wrapper, and it is
--                       the closest thing this estate has to "can a customer
--                       actually reach checkout". A manifest asserting only the
--                       29 Vercel crons would certify that blindness as healthy.
--
-- DELIBERATELY NOT EVERY CRON. server/cron.ts:915-940 gives the two
-- every-2-minute pollers a KV negative cache with an explicit comment saying it
-- exists so 1,440 daily invocations touch Neon zero times. A wrapper-level
-- INSERT fires BEFORE that check and would reinstate 2,880 writes a day whose
-- entire content is `skipped: idle`, pinning Neon compute awake around the clock
-- on a platform billed by compute-hour. So ~12 routes whose failure has a next
-- actor get a row (~360/day, ~5 MB/month); the high-frequency rest get a KV
-- heartbeat the sweep reads, same invariant, no Neon wake.
--
-- "Killed" is necessarily inferred, never observed: a process that got SIGKILLed
-- cannot write its own epitaph. It is a route with no row and no heartbeat
-- inside `period_minutes` + a grace, derived at read time. That needs no third
-- table and no Vercel API call on the hot path.
--
-- NO SEED ROWS HERE, ON PURPOSE. `cron_expectations` is upserted from
-- app/lib/cron-expectations.ts by the sweep. An INSERT in this file would fail
-- the additive allowlist in migration-classify.server.ts, making the whole
-- migration `manual` and costing an owner merge for a table definition. Keeping
-- the manifest in code is also where it belongs: adding a cron then requires
-- adding its expectation in the same PR, which a test can assert, and prose
-- never becomes the source of truth for a live fact.
--
-- FULLY ADDITIVE: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS
-- only. No DROP, no RENAME, no ALTER TYPE, no DML. Merges on the ordinary
-- release-engine lane once migration-dry-run is green.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 090
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS cron_runs (
  id            serial PRIMARY KEY,
  -- The route path as registered, e.g. '/cron/pricing-batch-recompute'. Free
  -- text rather than a FK to cron_expectations: a run of a route nobody
  -- declared must still be recorded, or the record inherits the manifest's
  -- blind spots.
  route         varchar(120) NOT NULL,
  started_at    timestamptz  NOT NULL DEFAULT now(),
  -- NULL only while a row is being written; every terminal status carries it.
  -- A row that somehow lands terminal with a NULL finish is a bug in the
  -- wrapper, and the sweep asserts against exactly that.
  finished_at   timestamptz,
  -- 'succeeded' | 'skipped' | 'failed'. Three spellings, not the six the run
  -- API accumulated ('completed', 'finished', 'done' were all in use in a
  -- single 14-day window). 'skipped' is a real outcome, not a failure: an idle
  -- poller and a gate-closed routine both did their job.
  status        varchar(16)  NOT NULL,
  -- The error text when status='failed'. Cleared by construction on a later
  -- success, since each run is its own row.
  error         text,
  -- Whatever the handler returned, for a post-hoc read. Bounded by the handler,
  -- not by this column; a handler returning something enormous is its own bug.
  result        jsonb,
  -- 'schedule' (GET, Vercel's native cron) | 'manual' (POST: a human, another
  -- service, or an internal self-continuation). Distinguishing them is what
  -- makes "the scheduler stopped firing" separable from "nobody triggered it".
  trigger_kind  varchar(16)  NOT NULL DEFAULT 'schedule',
  created_at    timestamptz  NOT NULL DEFAULT now()
);

-- The sweep's only read shape: "did <route> finish inside its period?"
CREATE INDEX IF NOT EXISTS idx_cron_runs_route_started
  ON cron_runs (route, started_at DESC);

-- Retention scans and the failure digest both filter on status first.
CREATE INDEX IF NOT EXISTS idx_cron_runs_status_started
  ON cron_runs (status, started_at DESC);

CREATE TABLE IF NOT EXISTS cron_expectations (
  -- Route path for the Vercel plane; workflow file path for the Actions plane.
  route            varchar(120) PRIMARY KEY,
  -- 'vercel' | 'actions'. Two planes exist and the second one carries the
  -- checkout probe, so the plane is data, not an assumption.
  plane            varchar(16)  NOT NULL DEFAULT 'vercel',
  -- The declared cadence, verbatim, so a drift test can compare against
  -- vercel.json and the workflow files without re-deriving it.
  schedule         varchar(64),
  -- How often this surface must produce evidence of life. Derived from
  -- `schedule` at manifest-authoring time; stored so the sweep does no cron
  -- parsing on the hot path.
  period_minutes   integer      NOT NULL,
  -- Extra slack before absence counts as a breach. A 300s lambda plus a cold
  -- start plus scheduler jitter is real; a floor with no grace fires on
  -- ordinary variance and is trained away within a week, which is exactly how
  -- the "enrich stage may be stalled" line came to warn every day for six
  -- weeks against a table that stopped being written on 2026-07-21.
  grace_minutes    integer      NOT NULL DEFAULT 10,
  -- Whether this surface is recorded in cron_runs (true) or only heartbeated in
  -- KV (false). The distinction is a cost decision about Neon compute, so it is
  -- recorded next to the expectation rather than buried in the wrapper.
  recorded         boolean      NOT NULL DEFAULT false,
  -- A breach here is a money-path event and may page; everything else files a
  -- ticket at the owning lane.
  money_relevant   boolean      NOT NULL DEFAULT false,
  -- Which team's lane owns a breach. A floor breach files a ticket THERE, never
  -- an email to the owner (invariant 3).
  owner_team       varchar(24),
  notes            text,
  updated_at       timestamptz  NOT NULL DEFAULT now()
);
