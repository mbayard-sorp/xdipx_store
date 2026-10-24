-- 137: Meta CRM integration for Instant Form leads.
-- meta_leads holds one row per Meta-generated lead (leadgen_id), written by the
-- leadgen webhook (app/routes/api.webhooks.meta-leadgen.tsx) and the hourly
-- backfill (/cron/meta-crm-sync). Contact details are stored only as Meta's
-- SHA-256 match hashes; the address itself lives in Klaviyo.
-- meta_lead_stage_events is the send ledger for the funnel-stage events
-- (raw Lead, then Converted at first order) that go to the dataset with the
-- lead_id, one row per lead per stage. app/lib/meta-crm.server.ts owns both.
--
-- FULLY ADDITIVE: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS
-- only. No DROP, no RENAME, no ALTER, no DML.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 137
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS meta_leads (
  id bigserial PRIMARY KEY,
  lead_id text NOT NULL UNIQUE,
  form_id text,
  page_id text,
  ad_id text,
  adset_id text,
  campaign_id text,
  platform text,
  lead_created_at timestamptz NOT NULL,
  email_hash text,
  phone_hash text,
  first_name_hash text,
  interest text,
  klaviyo_profile_id text,
  subscribed_at timestamptz,
  converted_at timestamptz,
  converted_value numeric(10, 2),
  ingest_attempts integer NOT NULL DEFAULT 0,
  ingest_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meta_leads_lead_created ON meta_leads(lead_created_at DESC);

CREATE TABLE IF NOT EXISTS meta_lead_stage_events (
  id bigserial PRIMARY KEY,
  lead_id text NOT NULL,
  stage text NOT NULL,
  event_id text NOT NULL UNIQUE,
  event_time bigint NOT NULL,
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  fbtrace_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_lead_stage_events_lead_stage ON meta_lead_stage_events(lead_id, stage);
CREATE INDEX IF NOT EXISTS idx_meta_lead_stage_events_created ON meta_lead_stage_events(created_at DESC);
