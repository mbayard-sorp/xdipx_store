-- 041_meta_capi_failures.sql
-- Durable retry queue for Meta Conversions API (CAPI) Purchase events.
-- Purchase is the revenue-critical conversion signal; a failed CAPI POST must
-- not be silently dropped. The order-created webhook inserts a row here on
-- failure, and the profit-summary cron drains unresolved rows (bounded attempts).

CREATE TABLE IF NOT EXISTS meta_capi_failures (
  id          SERIAL PRIMARY KEY,
  order_id    VARCHAR(64) NOT NULL,
  event_id    VARCHAR(128) NOT NULL,
  payload     JSONB NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT now(),
  resolved_at TIMESTAMP
);

-- Drain query targets unresolved rows; partial index keeps it cheap.
CREATE INDEX IF NOT EXISTS idx_meta_capi_failures_unresolved
  ON meta_capi_failures (created_at)
  WHERE resolved_at IS NULL;

-- One failure row per order (idempotent on webhook retries / repeated drains).
CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_capi_failures_order
  ON meta_capi_failures (order_id);
