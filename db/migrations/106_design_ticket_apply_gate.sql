-- 106_design_ticket_apply_gate.sql
-- Ticket #11084: three of four design-critic findings marked `applied` were
-- not actually fixed on the live page -- one shipped a remedy scoped to a
-- single named SKU when the finding was catalog-wide, one was never applied
-- at all despite reading `applied`. Nothing on the ticket status-transition
-- schema recorded whether a design-kind remedy was an INSTANCE fix (one named
-- item) or a CLASS fix (the whole defect class), or whether anyone had
-- re-captured fresh pixels since the fix landed. See the gate added in
-- app/lib/team.server.ts (isDesignTicket / normalizeRemedyScope / the
-- `to === 'applied'` check in transitionSuggestion).
--
-- remedy_scope:  'instance' | 'class', set once on a design-kind ticket
--                (category = 'design') before it may reach `applied`.
-- recapture_ref / recapture_at: evidence path/URL and timestamp for the
--                fresh screenshot re-score that confirmed the fix, mirrored
--                onto the row for a cheap read; the same evidence is also
--                recorded as a `suggestion_links` row with kind='recapture'
--                (its own created_at is the "dated" part of that record).
--
-- FULLY ADDITIVE: ADD COLUMN IF NOT EXISTS only. No DROP, no RENAME, no
-- ALTER TYPE, no DML.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 106
-- Idempotent: safe to re-run.

ALTER TABLE homepage_team_suggestions ADD COLUMN IF NOT EXISTS remedy_scope varchar(8);
ALTER TABLE homepage_team_suggestions ADD COLUMN IF NOT EXISTS recapture_ref text;
ALTER TABLE homepage_team_suggestions ADD COLUMN IF NOT EXISTS recapture_at timestamptz;
