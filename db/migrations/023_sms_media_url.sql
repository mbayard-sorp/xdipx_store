ALTER TABLE sms_messages
  ADD COLUMN IF NOT EXISTS media_url TEXT;
