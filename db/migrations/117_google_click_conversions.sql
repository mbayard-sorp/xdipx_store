-- 117: Google Ads offline-conversion ledger (tickets #3422/#3535). The
-- gclid/gbraid/wbraid capture -> cookie -> cart-attribute pipeline
-- (attribution.server.ts, attribution-cart.server.ts) already worked; this
-- table is the missing persistence step so the order webhook can record
-- each gclid-tagged order for later upload to Google Ads as an offline
-- conversion. One row per order, written best-effort from orders/create,
-- gated on stored marketing consent. Fully additive.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 117
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS google_click_conversions (
  id          SERIAL PRIMARY KEY,
  order_id    VARCHAR(64) NOT NULL,
  gclid       VARCHAR(256) NOT NULL,
  gclid_type  VARCHAR(16) NOT NULL,
  value       NUMERIC(10,2) NOT NULL,
  currency    VARCHAR(8) NOT NULL,
  click_time  TIMESTAMP NOT NULL,
  order_time  TIMESTAMP NOT NULL,
  exported_at TIMESTAMP,
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS google_click_conversions_order_id_uniq
  ON google_click_conversions (order_id);

CREATE INDEX IF NOT EXISTS idx_google_click_conversions_unexported
  ON google_click_conversions (created_at);
