-- Failure queue for GA4 Measurement Protocol purchase sends, mirroring
-- meta_capi_failures. handleOrderCreated enqueues on a failed send; the nightly
-- profit-summary cron drains it. Idempotent.
CREATE TABLE IF NOT EXISTS ga4_purchase_failures (
  id          serial      PRIMARY KEY,
  order_id    varchar(64) NOT NULL UNIQUE,
  payload     jsonb       NOT NULL,
  attempts    integer     NOT NULL DEFAULT 0,
  last_error  text,
  created_at  timestamp   NOT NULL DEFAULT now(),
  resolved_at timestamp
);

CREATE INDEX IF NOT EXISTS idx_ga4_purchase_failures_unresolved ON ga4_purchase_failures (created_at);
