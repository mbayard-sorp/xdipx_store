CREATE TABLE IF NOT EXISTS sms_age_consent (
  phone         VARCHAR(20) PRIMARY KEY,
  consented_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  method        VARCHAR(20) NOT NULL DEFAULT 'sms_yes'
);
