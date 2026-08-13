-- 078_owner_blockers.sql
-- The owner blocker list: one row per thing only Mike can clear.
--
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 078
--
-- Why: the daily digest's "Needs Mike" section reads Postgres, so it only ever
-- knew about blockers that already had a row somewhere (a blocked ticket, a
-- needs-owner PR, an approved promo). The blockers that actually stall
-- features are decided in conversation and land in prose: "apply migration
-- 068", "allowlist *.fal.media", "enable Imagen billing", "flip the trend
-- valve". Those lived in docs/store-team/ops-blockers.md, in memory files, or
-- nowhere, and nothing could tell you whether they were still true. This gives
-- an owner action an id, a lifecycle, and where possible a probe that clears
-- it automatically the moment the owner does the thing.
--
-- The probe is the load-bearing part. A hand-maintained list rots into another
-- ops-blockers.md within a month; a list that verifies itself every morning
-- and closes its own rows stays worth reading.

CREATE TABLE IF NOT EXISTS owner_blockers (
  id              serial       PRIMARY KEY,

  -- Stable identity so the same blocker found by the doc parser, the DB sweep,
  -- and the transcript miner collapses to one row instead of three. Convention
  -- is '<category>:<subject>', e.g. 'schema:owner_blockers', 'valve:trend_scout_enabled',
  -- 'egress:fal.media', 'console:gcp-imagen-billing'.
  dedupe_key      varchar(80)  NOT NULL UNIQUE,

  -- Imperative, what the owner does. Shown as the line item in the email.
  title           varchar(200) NOT NULL,
  -- Why it is blocked and what it is costing.
  detail          text,
  -- What ships the moment this clears. The reason to bother.
  unblocks        text,
  -- Where to go: an admin URL, a console page, a command to run.
  where_to_go     text,

  category        varchar(24)  NOT NULL DEFAULT 'other',
    -- migration | valve | console | credential | approval | merge | execute | other
  priority        smallint     NOT NULL DEFAULT 3,   -- 1 highest .. 5 lowest

  status          varchar(16)  NOT NULL DEFAULT 'open',   -- open | cleared | dismissed

  -- Provenance. source_ref carries a session id, a doc anchor, a ticket id, or
  -- a PR url so the row can always be traced back to where the claim came from.
  source          varchar(32)  NOT NULL DEFAULT 'agent',
    -- blocker-scout | session | agent | ops-doc | sweep | owner
  source_ref      text,
  -- Verbatim quote that justifies the row. Required by the scout's own rules:
  -- a blocker with no evidence is a guess, and guesses are what made the last
  -- list unreadable.
  evidence        text,

  -- Named read-only probe that decides whether this is still true. NULL means
  -- no machine check exists and only the owner (or an agent with proof) can
  -- close it. See PROBES in app/lib/owner-blockers.server.ts; args are matched
  -- against an allowlist there, never interpolated into SQL.
  verify_probe    varchar(32),
  verify_arg      text,
  last_verified_at timestamptz,
  -- What the probe said last time, for the "verified 4h ago" line in the email.
  last_verify_ok  boolean,

  first_seen_at   timestamptz  NOT NULL DEFAULT now(),
  -- Bumped every time a sweep re-observes an open blocker: age is the signal
  -- that something has been sitting on the owner's desk too long.
  last_seen_at    timestamptz  NOT NULL DEFAULT now(),
  cleared_at      timestamptz,
  cleared_by      varchar(24),                        -- auto | owner | agent
  clear_note      text,

  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owner_blockers_open
  ON owner_blockers (status, priority, first_seen_at);

CREATE INDEX IF NOT EXISTS idx_owner_blockers_verify
  ON owner_blockers (status, last_verified_at);

-- Cadence for the scout. Daily sweep + mine; the one-time backfill over
-- historical sessions is a manual script run, not a schedule.
INSERT INTO pipeline_settings (key, value)
VALUES ('blocker_scout_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- Separate short email, split out from the 14-section daily digest so a task
-- list reads like a task list. On by default: this is the whole point.
INSERT INTO pipeline_settings (key, value)
VALUES ('blocker_email_enabled', 'true')
ON CONFLICT (key) DO NOTHING;
