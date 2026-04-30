ALTER TABLE sms_conversations
  ADD COLUMN IF NOT EXISTS customer_first_name TEXT,
  ADD COLUMN IF NOT EXISTS customer_default_zip TEXT;
-- customer_gid already exists (Phase 0). Adding only the two new columns.
