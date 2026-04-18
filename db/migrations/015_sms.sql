CREATE TABLE IF NOT EXISTS sms_optouts (
  id         SERIAL PRIMARY KEY,
  phone      VARCHAR(20) NOT NULL UNIQUE,
  reason     VARCHAR(20) NOT NULL DEFAULT 'stop',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sms_messages (
  id         SERIAL PRIMARY KEY,
  phone      VARCHAR(20) NOT NULL,
  direction  VARCHAR(10) NOT NULL,
  body       TEXT NOT NULL,
  twilio_sid VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sms_messages_phone_idx   ON sms_messages (phone, created_at);
CREATE INDEX IF NOT EXISTS sms_messages_created_idx ON sms_messages (created_at);
