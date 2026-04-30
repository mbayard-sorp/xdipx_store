CREATE TABLE IF NOT EXISTS sms_conversations (
  phone                 VARCHAR(20) PRIMARY KEY,
  stage                 VARCHAR(32) NOT NULL DEFAULT 'GREETING',
  current_pitch_handle  TEXT,
  current_upsell_handle TEXT,
  last_quote_url        TEXT,
  last_quote_items      JSONB,
  last_quote_created_at TIMESTAMP,
  customer_gid          TEXT,
  stage_set_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  last_active_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  conversation_id       UUID NOT NULL DEFAULT gen_random_uuid()
);
