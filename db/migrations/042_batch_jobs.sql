-- 042_batch_jobs.sql
-- Registry for asynchronous enrichment jobs driven through the Anthropic
-- Message Batches API. A job owns N products and walks the lockstep batched
-- runner turn-by-turn; one Anthropic batch is submitted per turn. The
-- enrichment-batch-poller cron advances in-flight jobs and applies completed
-- ProductWrites idempotently to Shopify.

CREATE TABLE IF NOT EXISTS batch_jobs (
  id              SERIAL PRIMARY KEY,
  job_id          VARCHAR(64)  NOT NULL,             -- public uuid handed back to callers / KV mirror
  job_type        VARCHAR(32)  NOT NULL,             -- 'full-enrichment' | 'emma-take' | 'emma-hero' | 'regenerate'
  status          VARCHAR(20)  NOT NULL DEFAULT 'queued',
                                                     -- queued | submitted | processing | applying | done | failed
  source          VARCHAR(32)  NOT NULL,             -- entry point: 'bulk-import' | 'import-product' | 'regenerate-keywords' | 'deal-manager' | 'emma-hero' | 'emma-take' | 'backfill'
  -- products in this job (skus + shopify ids + the OrchestratorInput brief)
  sku_list        JSONB        NOT NULL,             -- string[]  (for quick display / dedupe)
  products        JSONB        NOT NULL,             -- Array<{ productId, sku, input: OrchestratorInput }>
  -- lockstep runner progress
  turn            INTEGER      NOT NULL DEFAULT 0,   -- turns completed so far
  max_turns       INTEGER      NOT NULL DEFAULT 24,
  batch_ids       JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- Anthropic batch id per turn, ordered
  current_batch_id VARCHAR(64),                      -- batch awaiting poll (null when none in flight)
  -- per-product runner state (messages[], finished, writes-so-far, telemetry, retries)
  runner_state    JSONB        NOT NULL DEFAULT '{}'::jsonb,
  -- terminal results
  results         JSONB,                             -- Array<{ productId, sku, ok, writesApplied?, error? }>
  error           TEXT,
  -- gating: deals that must not go live until this job is done
  gates_deal_id   INTEGER,                           -- dealHistory.id this job gates (nullable)
  -- idempotency: products whose ProductWrites have been pushed to Shopify
  applied_skus    JSONB        NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMP    NOT NULL DEFAULT now(),
  submitted_at    TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT now(),
  completed_at    TIMESTAMP,
  failed_at       TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_batch_jobs_job_id ON batch_jobs (job_id);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_status ON batch_jobs (status, created_at);
-- Poller drain: pick up jobs that need advancing.
CREATE INDEX IF NOT EXISTS idx_batch_jobs_inflight ON batch_jobs (updated_at)
  WHERE status IN ('queued','submitted','processing','applying');
CREATE INDEX IF NOT EXISTS idx_batch_jobs_gates_deal ON batch_jobs (gates_deal_id)
  WHERE gates_deal_id IS NOT NULL;

-- Enrichment-cache dead-row hygiene (see Part G of spec). The cache table
-- predates a created_at column; add one (nullable, no backfill) so the
-- post-rollout cleanup can be time-bounded if desired. Safe additive change.
ALTER TABLE product_enrichment_cache ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT now();
