-- 092_suggestion_links_dedupe.sql
-- Ticket #7038: suggestion_links re-adds an identical (suggestion_id, kind,
-- ref) link on every cycle instead of upserting. Measured 2026-09-02 against
-- production: 6,671 link rows, only 4,108 distinct triples, so 2,563 rows
-- (38% of the table) are exact duplicates. The worst case, ticket #3895,
-- carries the same https://github.com/mbayard-sorp/xdipx_store/pull/778 link
-- 332 times. The writers are addTicketLinks (app/lib/team.server.ts) and
-- addTicketLink (app/lib/release-engine.server.ts, called every polling
-- cycle from handleProtected/escalateStuckCi/settleDeployment on a PR that is
-- still waiting) — both now insert with onConflictDoNothing targeting the
-- unique index this file adds, so a repeat write of the same triple is a
-- no-op going forward.
--
-- NOT ADDITIVE: this file opens with a DELETE (DML), so the whole file is
-- 'manual' per scripts/apply-additive-migrations.ts / classifyFile — it never
-- auto-applies at build time and stays on the manual path
-- (scripts/apply-migrations.ts), same as 088. Deliberately bundled with the
-- CREATE UNIQUE INDEX below in this ONE file rather than split into a manual
-- dedupe file plus a separate additive index file: the current production
-- table already holds the duplicates this index would reject, so an additive
-- file creating the index by itself would fail the very next production
-- build (CREATE UNIQUE INDEX errors on existing duplicate values) if it ran
-- before an owner had a chance to run a separate dedupe file by hand.
-- Bundling both statements in one manual file means the index can only ever
-- be created in the same transaction as the dedupe that makes it valid.
--
-- Apply (manual, owner-run): DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 092
-- Idempotent: safe to re-run. The DELETE only ever removes a strict subset
-- of later duplicates (keyed on ctid, not a value it could re-derive
-- differently on a second pass), and CREATE UNIQUE INDEX IF NOT EXISTS is a
-- no-op once the index exists.

-- Keep the earliest row (lowest id) per (suggestion_id, kind, ref) triple;
-- delete every later duplicate. kind is compared with IS NOT DISTINCT FROM
-- because the column is nullable in principle, even though both current
-- writers always set it.
DELETE FROM suggestion_links a
  USING suggestion_links b
  WHERE a.id > b.id
    AND a.suggestion_id = b.suggestion_id
    AND a.kind IS NOT DISTINCT FROM b.kind
    AND a.ref = b.ref;

CREATE UNIQUE INDEX IF NOT EXISTS uq_suggestion_links_sugg_kind_ref
  ON suggestion_links (suggestion_id, kind, ref);
