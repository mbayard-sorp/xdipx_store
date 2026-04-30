ALTER TABLE sms_turns
  ADD COLUMN IF NOT EXISTS channel VARCHAR(8) NOT NULL DEFAULT 'sms';

CREATE INDEX IF NOT EXISTS sms_turns_channel_idx ON sms_turns (channel, created_at DESC);
