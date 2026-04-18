-- Per-call cost + observability log. Populated by the IVR bridge on WS close
-- and by the Twilio voice webhook on rate-limit rejection.

CREATE TABLE IF NOT EXISTS call_log (
  id            SERIAL PRIMARY KEY,
  call_sid      VARCHAR(64)  NOT NULL UNIQUE,
  from_number   VARCHAR(20)  NOT NULL,
  to_number     VARCHAR(20),
  direction     VARCHAR(10),
  end_reason    VARCHAR(20),
  duration_sec  INTEGER,
  tokens_total  INTEGER,
  voicemail_id  INTEGER,
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS call_log_from_idx    ON call_log (from_number, created_at);
CREATE INDEX IF NOT EXISTS call_log_created_idx ON call_log (created_at);
