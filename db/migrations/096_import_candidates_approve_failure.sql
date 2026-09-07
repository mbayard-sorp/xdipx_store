-- 096_import_candidates_approve_failure.sql
-- Ticket #7983: approveAndImport() failures (e.g. "master no longer in
-- feed") were silent on the candidate row -- no count, no reason -- so a
-- systemically-broken import queue read as an ordinary, empty /admin/imports
-- page instead of a visible fleet of failures. These two columns let the
-- caller stamp the outcome on the row it just failed to import. Named
-- import_* (not attempt_count/last_error) so they cannot be confused with
-- the unrelated enrich_attempts/enrich_failed_at pair from migration 060,
-- which gates a different lifecycle stage (enrich, not approve/import).
--
--   import_attempt_count  integer, not null, default 0. Incremented by the
--                          caller on every failed approveAndImport() call for
--                          this row.
--   import_last_error     text, nullable. The error string from the most
--                          recent failed approveAndImport() attempt (e.g.
--                          "master no longer in feed").
--
-- FULLY ADDITIVE: ADD COLUMN IF NOT EXISTS only. No DROP, no RENAME, no ALTER
-- TYPE, no DML. Merges on the ordinary release-engine lane once
-- migration-dry-run is green.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 096
-- Idempotent: safe to re-run.

ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS import_attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS import_last_error text;
