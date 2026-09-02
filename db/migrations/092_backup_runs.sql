-- 092_backup_runs.sql
-- The record of whether this database can be restored (Stage G1 of the
-- 2026-09-01 automation audit response).
--
-- G1 was the one line in that audit's response marked RED with nothing behind
-- it at all. Grepping the whole repo for `pg_dump`, Neon branching, PITR or any
-- restore policy returned zero hits outside prose in two prior audits. Stages
-- B, C, D and E all increased the number of unattended writes this system makes
-- to this database; taking on that write risk with no tested restore path is
-- the wrong order, so this lands late but ahead of the rest of G.
--
--   backup_runs   one row per dump and per restore probe, written in a
--                 `finally` for the same reason cron_runs is: an
--                 INSERT-then-UPDATE pair invents a started-without-finish
--                 class indistinguishable from a real kill.
--
-- WHY THERE IS NO `backup_tables` TABLE. The per-table row counts and byte
-- sizes ride in the `tables` jsonb column. They are read exactly twice: by the
-- restore probe, which compares them against what it actually reads back, and
-- by the drift check, which compares today's counts against the previous run's.
-- Neither read is ever filtered or joined on a single table, so a second table
-- would buy a foreign key and cost 62 extra INSERTs a night.
--
-- WHY A `status` OF 'partial' EXISTS. The dump has a wall-clock and a byte
-- budget, because a 300s lambda will be SIGKILLed if a table grows past what
-- was measured. A run that hits either budget must not write a manifest that
-- reads complete. It records `partial`, names the table it stopped on, and the
-- restore probe treats a partial as a failure rather than as a smaller success.
-- A backup that silently covers less than it claims is the same failure mode as
-- a digest printing GOOD over a dead pipeline, which this estate has already
-- paid for once.
--
-- FULLY ADDITIVE: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS
-- only. No DROP, no RENAME, no ALTER TYPE, no DML. Merges on the ordinary
-- release-engine lane once migration-dry-run is green.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 092
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS backup_runs (
  id            serial PRIMARY KEY,
  -- 'dump' | 'restore-probe'. Both write here so that "the backup ran" and
  -- "the backup was readable" are two facts with two ages, never one.
  kind          varchar(24)  NOT NULL,
  started_at    timestamptz  NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  -- 'succeeded' | 'partial' | 'failed' | 'skipped'. 'skipped' is the honest
  -- outcome when no blob token is configured: the run did its job by declining,
  -- and reading that as a failure would train the alarm away.
  status        varchar(16)  NOT NULL,
  -- The blob prefix this run wrote or read, e.g. 'db-backup/2026-09-02'.
  -- The restore probe resolves the newest dump through this column rather than
  -- by listing blobs, so a probe can never grade a snapshot the dump did not
  -- claim to have finished.
  snapshot_key  varchar(200),
  -- [{ table, rows, bytes }] for every table the run touched, in dump order.
  tables        jsonb,
  total_bytes   bigint,
  -- Set on 'failed' and on 'partial'; on partial it names the table the budget
  -- ran out on, which is the only thing that makes a partial actionable.
  error         text,
  created_at    timestamptz  NOT NULL DEFAULT now()
);

-- Both reads are "the newest run of this kind".
CREATE INDEX IF NOT EXISTS idx_backup_runs_kind_started
  ON backup_runs (kind, started_at DESC);
