ALTER TABLE sms_messages
  ADD COLUMN IF NOT EXISTS simulated BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS sms_messages_simulated_idx
  ON sms_messages (simulated, phone, created_at);
