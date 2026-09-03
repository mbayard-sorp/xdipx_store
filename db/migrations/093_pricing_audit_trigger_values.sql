-- 093_pricing_audit_trigger_values.sql
-- The pricing audit log has been silently rejecting half its writes.
--
-- pricing_audit_log_trigger_check allowed exactly four values:
--   webhook | batch | manual | clearance_ladder
-- while app/lib/pricing-apply-v2.server.ts has been passing 'batch_catchup'
-- (the pricing-ops rescue run) and, since PR #1017, 'batch_continuation' (a
-- resumed slice of the same day's walk). Every insert carrying either violated
-- the CHECK. The write is wrapped in a try/catch that logs to the console and
-- carries on, so the runs reported success and nothing else noticed.
--
-- Measured on production 2026-09-03, the first day the resumable walk ran end
-- to end: the 07:00 'batch' pass wrote 3,019 audit rows, and the four
-- 'batch_continuation' passes that followed applied 1,426 price changes and
-- wrote NONE. The only surviving evidence was the id sequence -- last_value
-- 448,767 against max(id) 445,447, so 3,320 insert attempts had consumed a
-- sequence value and then been rolled back.
--
-- Two costs, and the second is the one that matters. The obvious one is the
-- missing price history on the money path. The other is that catalog coverage
-- -- the A1 milestone's entire acceptance criterion -- is measured off this
-- table, so it read 3,019 of 6,786 SKUs (44%) on a day the walk had in fact
-- reached 6,371 (94%). The fix worked; the metric said it had not.
--
-- NOT ADDITIVE: ALTER TABLE ... DROP/ADD CONSTRAINT is not one of the three
-- shapes classifyFile calls 'auto', so this file never runs at build time and
-- stays on the manual path (scripts/apply-migrations.ts), escalating to the
-- owner like any other schema change.
--
-- Nothing waits on it, which is the point. The same PR teaches the walk to
-- COUNT its failed audit writes and return them in the run result
-- (auditWriteFailures), so until this runs the breakage is loud in cron_runs
-- instead of silent, and pricing-trigger-values.test.ts holds the list below
-- equal to PRICING_TRIGGERS in the code so the next value cannot ship ahead of
-- the migration that permits it.
--
-- Apply (manual, owner-run): DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 093
-- Idempotent: DROP ... IF EXISTS followed by ADD is safe to re-run.

ALTER TABLE pricing_audit_log
  DROP CONSTRAINT IF EXISTS pricing_audit_log_trigger_check;

ALTER TABLE pricing_audit_log
  ADD CONSTRAINT pricing_audit_log_trigger_check
  CHECK (trigger = ANY (ARRAY[
    'webhook'::text,
    'batch'::text,
    'manual'::text,
    'clearance_ladder'::text,
    'batch_catchup'::text,
    'batch_continuation'::text
  ]));
