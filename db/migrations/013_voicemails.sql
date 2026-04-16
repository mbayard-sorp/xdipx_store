-- Voicemails captured conversationally by the IVR bridge.
-- One row per call that produced a voicemail. Admin triages from /admin/voicemails.

CREATE TABLE IF NOT EXISTS voicemails (
  id                    SERIAL PRIMARY KEY,
  call_sid              VARCHAR(64)  NOT NULL UNIQUE,
  from_number           VARCHAR(20)  NOT NULL,
  callback_number       VARCHAR(20),
  summary               TEXT         NOT NULL,
  transcript            TEXT         NOT NULL,
  recording_url         TEXT,
  context_order_number  VARCHAR(20),
  status                VARCHAR(20)  NOT NULL DEFAULT 'new',
  created_at            TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS voicemails_status_idx  ON voicemails (status);
CREATE INDEX IF NOT EXISTS voicemails_created_idx ON voicemails (created_at);
