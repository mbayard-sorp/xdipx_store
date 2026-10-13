-- 122: widen homepage_team_suggestions.decided_by from varchar(24) to
-- varchar(32), matching its sibling actor columns assignee and verified_by
-- (both varchar(32)) on the same table.
--
-- Ticket #15009. decided_by was added by migration 062 back when it only
-- ever held 'auto' or 'owner' (4/5 chars). Since then transitionSuggestion
-- (app/lib/team.server.ts) started writing the full agent actor string into
-- it on any proposed/approved -> dismissed edge, including every
-- `agent:<slug>` dismissal and the delegated-supersession path (#3573).
-- 'agent:email-marketing-manager' alone is 29 characters, so any dismissal
-- by that agent -- or by adult-business-researcher (31), loyalty-referral-
-- manager (30), sanity-content-builder (28), and others -- hit Postgres's
-- "value too long for type character varying(24)" on the UPDATE. Because
-- transitionSuggestion writes its note links BEFORE that UPDATE (ticket
-- #10506's ordering fix, so a write failure never hides the stated reason),
-- the failure mode was doubly confusing in production: the dismissal note
-- landed on the ticket, twice on a retried call, while the ticket's own
-- status stayed stuck at 'approved'/'proposed' and the caller saw a bare
-- 500. Reproduced 2026-10-12 against five real rows (4117, 4118, 5394, 5395,
-- 2607), all stuck exactly this way.
--
-- NOT additive (ALTER COLUMN TYPE, not ADD COLUMN IF NOT EXISTS) -- escalates
-- to the owner per routine-dev-daily.md Step 2. Safe and idempotent to
-- re-run: widening the same column to the same width a second time is a
-- no-op data-wise, though Postgres will still run the rewrite.

ALTER TABLE homepage_team_suggestions
  ALTER COLUMN decided_by TYPE varchar(32);
