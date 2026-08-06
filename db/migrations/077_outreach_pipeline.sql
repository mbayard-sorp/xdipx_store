-- 077_outreach_pipeline.sql
-- Autonomous guest-post / brand-partnership outreach by email. Two tables and
-- two settings rows. Ships entirely OFF: outreach_send_enabled seeds 'false',
-- so nothing sends until the owner flips the valve after working through the
-- enablement checklist in docs/store-team/outreach-pipeline.md.
--
--   DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 077
--
-- Why: the offsite-scout routine already drafts pitches, but the chain stops
-- at approved suggestion rows the owner must send by hand from
-- hello@xdipx.com. This gives the loop a send arm (valve-gated, capped) and a
-- reply ear (IMAP poll that only ever reads), looping the owner in at his
-- alert addresses when a prospect replies positively.

-- Vetted outreach targets. One row per domain; the seed script upserts from
-- docs/store-team/outreach-prospects.md and the offsite-scout can add more
-- via POST /api/team/outreach {op:'upsert-prospect'}.
CREATE TABLE IF NOT EXISTS outreach_prospects (
  id              serial      PRIMARY KEY,
  domain          varchar(255) NOT NULL UNIQUE,
  name            varchar(255),
  contact_email   varchar(255),
  contact_channel varchar(8)  NOT NULL DEFAULT 'email',  -- 'email' | 'form' | 'dm'
  source          varchar(64),                           -- 'prospects-doc' | 'offsite-scout' | ...
  status          varchar(20) NOT NULL DEFAULT 'new',
    -- new | researching | queued | sent | replied_positive | replied_negative
    -- | bounced | on_hold | landed | rejected
  policy_note     text,                                  -- caveat carried from vetting
  notes           text,
  suggestion_id   integer REFERENCES homepage_team_suggestions(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_prospects_status
  ON outreach_prospects (status, updated_at);

-- Every outreach email, both directions. Outbound rows record the SMTP
-- Message-ID so the inbox poller can match replies by In-Reply-To/References;
-- inbound rows record the classification the poller assigned.
CREATE TABLE IF NOT EXISTS outreach_messages (
  id                serial      PRIMARY KEY,
  prospect_id       integer     NOT NULL REFERENCES outreach_prospects(id) ON DELETE CASCADE,
  direction         varchar(3)  NOT NULL,               -- 'in' | 'out'
  subject           text,
  body_text         text,
  message_id        text,                               -- RFC 5322 Message-ID
  in_reply_to       text,
  references_header text,
  classification    varchar(12),                        -- positive | negative | neutral | auto_reply
  sent_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_messages_prospect
  ON outreach_messages (prospect_id, direction, sent_at);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_message_id
  ON outreach_messages (message_id);

-- Valve (OFF) and daily cap. getValve-style read: a missing row means OFF,
-- so even before this migration is applied the send path stays dead.
INSERT INTO pipeline_settings (key, value, updated_at) VALUES
  ('outreach_send_enabled',   'false', NOW()),
  ('outreach_daily_send_cap', '5',     NOW())
ON CONFLICT (key) DO NOTHING;
