-- 070_ticket_system.sql
-- Turn the improvement bus (homepage_team_suggestions) into a real ticket
-- system: assignment, claims with expiry, priority, dedupe, dependency links,
-- retry accounting, and verification.
--
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 070
--
-- Why: the bus today is a flat proposed -> approved -> pr_open -> applied
-- ladder with no owner, no priority, and no way to stop the same recurring
-- signal from filing the same row every day. A daily automated diagnosis
-- (see 071 + app/lib/seo-daily.server.ts) makes that failure mode immediate:
-- one flapping metric would flood the queue within a week.
--
-- Scope note: this migration is ADDITIVE ONLY. It adds columns, two indexes,
-- one table, and two settings rows. The transition/claim logic that reads
-- assignee / claimed_at / blocked_by_id ships separately; nothing but
-- db/schema.ts references these columns yet, so applying this is inert.

-- 1. Widen `status` so the ticket vocabulary has room beyond the current
--    12-char ceiling ('proposed' | 'approved' | 'pr_open' | 'applied' |
--    'dismissed'). Widening a varchar in place is metadata-only in Postgres:
--    no table rewrite, no lock beyond a brief ACCESS EXCLUSIVE.
ALTER TABLE homepage_team_suggestions
  ALTER COLUMN status TYPE varchar(16);

-- 2. Ticket fields. Every one is nullable or carries a default so existing
--    rows stay valid and no backfill is required.
ALTER TABLE homepage_team_suggestions
  ADD COLUMN IF NOT EXISTS assignee         varchar(32),
  ADD COLUMN IF NOT EXISTS claimed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS priority         smallint NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS due_at           timestamptz,
  ADD COLUMN IF NOT EXISTS dedupe_key       varchar(64),
  ADD COLUMN IF NOT EXISTS supersedes_id    integer,
  ADD COLUMN IF NOT EXISTS blocked_by_id    integer,
  ADD COLUMN IF NOT EXISTS attempt_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error       text,
  ADD COLUMN IF NOT EXISTS verified_by      varchar(32),
  ADD COLUMN IF NOT EXISTS verified_at      timestamptz;

-- 3. Dedupe. A recurring signal (say "indexed count fell again this week")
--    should reopen the conversation on ONE ticket, not file a new one every
--    run. The uniqueness only binds while the ticket is still live: once it
--    reaches 'applied' or 'dismissed' the same key is free to file again, so
--    a regression that returns next quarter gets a fresh ticket rather than
--    silently colliding with a closed one.
--
--    Partial-unique pattern mirrors uq_api_token_log_request_id (043).
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_sugg_dedupe_key
  ON homepage_team_suggestions (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status NOT IN ('applied', 'dismissed');

-- 4. Work-queue indexes: "what is on my plate, most urgent first" and the
--    unassigned equivalent for whoever picks next.
CREATE INDEX IF NOT EXISTS idx_team_sugg_assignee_queue
  ON homepage_team_suggestions (assignee, status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_team_sugg_priority_queue
  ON homepage_team_suggestions (status, priority, created_at);

-- 5. Links out of a ticket: the PR that implements it, the run that filed it,
--    the URL it is about, the doc it amends. Kept as a side table rather than
--    more columns because the cardinality is genuinely one-to-many (one
--    ticket, several PRs across retries) and `kind` will keep growing.
CREATE TABLE IF NOT EXISTS suggestion_links (
  id            SERIAL PRIMARY KEY,
  suggestion_id INTEGER NOT NULL REFERENCES homepage_team_suggestions(id) ON DELETE CASCADE,
  kind          VARCHAR(12),            -- pr|issue|run|url|doc|commit
  ref           TEXT NOT NULL,          -- URL, path, or id, depending on kind
  state         VARCHAR(16),            -- open|merged|closed|passed|failed
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suggestion_links_sugg_kind
  ON suggestion_links (suggestion_id, kind);

-- 6. Release-engine valves, seeded OFF. The engine that will consume this
--    ticket structure (claim -> PR -> verify -> merge) is not written yet;
--    seeding the switch now means turning it on later is a dashboard action
--    rather than another migration. DO NOTHING so a re-run never flips a
--    valve the owner has already set by hand.
INSERT INTO pipeline_settings (key, value, updated_at) VALUES
  ('release_engine_enabled', 'false', NOW()),
  ('release_engine_max_merges_per_day', '6', NOW())
ON CONFLICT (key) DO NOTHING;
