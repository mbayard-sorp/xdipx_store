-- 126: Twilio double opt-in for SMS consent on the paid-lead funnel.
--
-- /api/lead used to hand a consented phone to Klaviyo's SMS list, which is
-- unset in production (owner blocker 731) and not expected to be approved
-- for a sex-toy store. The number now goes through the Twilio A2P campaign
-- registered for xdipx (double opt-in): one row per form consent, pending
-- until the person replies YES or START, then confirmed and welcomed once.
-- STOP flips the row to opted_out alongside the sms_optouts insert the
-- compliance path already does. See app/lib/lead-sms.server.ts and
-- docs/store-team/lead-sms.md.
--
-- phone is not unique: a person who opted out can consent again on the form
-- later, and the newest row is the live one.
--
-- FULLY ADDITIVE: one CREATE TABLE IF NOT EXISTS and two CREATE INDEX IF NOT
-- EXISTS. No DROP, no RENAME, no ALTER TYPE, no DML.

CREATE TABLE IF NOT EXISTS lead_sms_subscriptions (
  id serial PRIMARY KEY,
  phone varchar(20) NOT NULL,
  email text NOT NULL,
  first_name text NOT NULL,
  interest text,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  consented_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  confirmed_via text,
  welcome_sent_at timestamptz,
  opted_out_at timestamptz,
  confirm_message_sid text,
  welcome_message_sid text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_sms_subscriptions_phone_created ON lead_sms_subscriptions(phone, created_at);
CREATE INDEX IF NOT EXISTS idx_lead_sms_subscriptions_status ON lead_sms_subscriptions(status);
