CREATE TABLE IF NOT EXISTS web_conversations (
  session_id            VARCHAR(64)  PRIMARY KEY,
  stage                 VARCHAR(32)  NOT NULL DEFAULT 'GREETING',
  current_pitch_handle  TEXT,
  current_upsell_handle TEXT,
  last_quote_url        TEXT,
  last_quote_items      JSONB,
  last_quote_created_at TIMESTAMP,
  customer_gid          TEXT,
  customer_first_name   TEXT,
  customer_default_zip  TEXT,
  page_handle           TEXT,
  page_route            TEXT,
  stage_set_at          TIMESTAMP    NOT NULL DEFAULT NOW(),
  last_active_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
  conversation_id       UUID         NOT NULL DEFAULT gen_random_uuid()
);
