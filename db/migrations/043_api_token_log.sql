-- 043_api_token_log.sql
-- Central per-call token-spend log for EVERY Anthropic API-key call (enrichment,
-- Emma chat, SMS, IVR, copy gen). Written best-effort from logApiTokens() at the
-- llm-client seam; a write failure here must never unwind a real API call.

CREATE TABLE IF NOT EXISTS api_token_log (
  id                    SERIAL PRIMARY KEY,
  ts                    TIMESTAMP    NOT NULL DEFAULT now(),
  feature               VARCHAR(48)  NOT NULL,   -- 'enrichment' | 'emma-chat' | 'sms' | 'ivr' | 'copy-gen' | 'reviews' | 'seo-research' | 'log-monitor' | ...
  model                 VARCHAR(64)  NOT NULL,
  source                VARCHAR(16)  NOT NULL,   -- 'batch' | 'sync' | 'agent-sdk'
  batch_id              VARCHAR(64),             -- Anthropic batch id when source='batch'
  product_id            VARCHAR(64),             -- shopify product id when applicable
  sku                   VARCHAR(32),
  caller                VARCHAR(96),             -- free-form: function / route that originated the call
  input_tokens          INTEGER      NOT NULL DEFAULT 0,
  output_tokens         INTEGER      NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER      NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER      NOT NULL DEFAULT 0,
  request_count         INTEGER      NOT NULL DEFAULT 1,  -- >1 when one row aggregates a batch turn
  est_cost_usd          DECIMAL(10,5) NOT NULL DEFAULT 0,
  request_id            VARCHAR(64)            -- idempotency key for the IVR POST path (option B); null otherwise
);

CREATE INDEX IF NOT EXISTS idx_api_token_log_ts ON api_token_log (ts);
-- Idempotency for the optional IVR internal-endpoint path: dedupe on request_id when present.
CREATE UNIQUE INDEX IF NOT EXISTS uq_api_token_log_request_id ON api_token_log (request_id)
  WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_token_log_feature_ts ON api_token_log (feature, ts);
CREATE INDEX IF NOT EXISTS idx_api_token_log_batch ON api_token_log (batch_id)
  WHERE batch_id IS NOT NULL;

-- Daily rollup view -- read by /admin/usage.
CREATE OR REPLACE VIEW api_token_daily AS
SELECT
  date_trunc('day', ts)::date          AS day,
  feature,
  model,
  source,
  SUM(request_count)                   AS calls,
  SUM(input_tokens)                    AS input_tokens,
  SUM(output_tokens)                   AS output_tokens,
  SUM(cache_creation_tokens)           AS cache_creation_tokens,
  SUM(cache_read_tokens)               AS cache_read_tokens,
  SUM(est_cost_usd)                    AS est_cost_usd
FROM api_token_log
GROUP BY 1, 2, 3, 4;
