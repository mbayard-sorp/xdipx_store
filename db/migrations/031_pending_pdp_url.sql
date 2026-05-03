ALTER TABLE sms_conversations
  ADD COLUMN IF NOT EXISTS pending_pdp_url TEXT DEFAULT NULL;

ALTER TABLE web_conversations
  ADD COLUMN IF NOT EXISTS pending_pdp_url TEXT DEFAULT NULL;
