CREATE TABLE IF NOT EXISTS sms_turns (
  id                  SERIAL PRIMARY KEY,
  phone               VARCHAR(20) NOT NULL,
  conversation_id     UUID NOT NULL,
  twilio_message_sid  VARCHAR(64),
  direction           VARCHAR(10) NOT NULL,
  stage_in            VARCHAR(32),
  stage_out           VARCHAR(32),
  intent              VARCHAR(32),
  intent_confidence   REAL,
  customer_msg        TEXT,
  emma_msg            TEXT,
  tool_calls          JSONB,
  input_tokens        INT,
  output_tokens       INT,
  latency_ms          INT,
  errors              JSONB,
  fabrication_caught  VARCHAR(32),
  pipeline_version    VARCHAR(8) NOT NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sms_turns_twilio_sid_uniq
  ON sms_turns (twilio_message_sid)
  WHERE twilio_message_sid IS NOT NULL;

CREATE INDEX IF NOT EXISTS sms_turns_phone_created_idx
  ON sms_turns (phone, created_at DESC);
