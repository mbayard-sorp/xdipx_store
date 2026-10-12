-- 121: ledger tables for the daily promo email program (owner direction
-- 2026-10-12; routine docs: docs/store-team/routine-email-daily.md, PR to
-- follow).
--
-- email_sends: one row per drafted/sent daily campaign, keyed by
-- campaign_key (e.g. daily-20261014) so a day's send is never duplicated.
-- email_campaign_metrics: Klaviyo performance pulls against a campaign_key,
-- one row per pull so metrics history is append-only rather than overwritten.
--
-- ADDITIVE: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS only,
-- so the production build applies it unattended. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS email_sends (
  id                 serial PRIMARY KEY,
  campaign_key       text UNIQUE NOT NULL,
  send_date          date,
  klaviyo_campaign_id text,
  klaviyo_template_id text,
  template_version   text,
  audience           text,
  subject            text,
  preview_text       text,
  featured_handles   jsonb,
  blocks             jsonb,
  hypothesis         text,
  voice_gate_verdict  text,
  design_check_verdict text,
  run_id             integer,
  status             text NOT NULL DEFAULT 'drafted',
  approved_by        text,
  sent_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_campaign_metrics (
  id                  serial PRIMARY KEY,
  campaign_key        text NOT NULL,
  klaviyo_campaign_id text,
  pulled_at           timestamptz NOT NULL DEFAULT now(),
  recipients          integer,
  delivered           integer,
  opens_unique        integer,
  clicks_unique       integer,
  conversions         integer,
  conversion_value    numeric(10,2),
  unsubscribes        integer,
  spam_complaints     integer,
  bounced             integer,
  attributed_orders   integer,
  attributed_revenue  numeric(10,2),
  by_block            jsonb
);

CREATE INDEX IF NOT EXISTS idx_email_campaign_metrics_campaign_key
  ON email_campaign_metrics (campaign_key);
