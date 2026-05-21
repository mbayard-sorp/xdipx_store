-- 038_import_candidates.sql
-- Daily Nalpac import-automation: candidate queue + run audit, plus an
-- agent_type discriminator on the admin chat threads so a second
-- (product-manager) chat persona can share the table.
-- All statements idempotent (IF NOT EXISTS) — safe to re-run.

-- One LIVE row per SKU. The monitor upserts on sku; the dashboard works
-- the pending/watching rows. status TS union (not a DB enum, to keep future
-- additions migration-free): pending | approved | rejected | watching | imported | skipped
CREATE TABLE IF NOT EXISTS import_candidates (
  id               SERIAL PRIMARY KEY,
  sku              VARCHAR(20) NOT NULL UNIQUE,
  brand            VARCHAR(100),
  product_title    TEXT,
  categories       JSON,
  tier             VARCHAR(10) NOT NULL,        -- 'A' | 'B' | 'C' | 'D'
  gap_reason       TEXT,
  deal_score       DECIMAL(5,3),
  msrp             DECIMAL(10,2),
  wholesale_cost   DECIMAL(10,2),
  map_price        DECIMAL(10,2),
  proposed_price   DECIMAL(10,2),
  margin_pct       DECIMAL(5,2),
  profit_per_unit  DECIMAL(10,2),
  qty_available    INTEGER,
  image_count      INTEGER,
  in_top100_feed   BOOLEAN NOT NULL DEFAULT FALSE,
  in_new_feed      BOOLEAN NOT NULL DEFAULT FALSE,
  in_sale_feed     BOOLEAN NOT NULL DEFAULT FALSE,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending',
  rejection_reason TEXT,
  watch_score      DECIMAL(5,3),                -- score snapshot when set to 'watching'
  watch_price      DECIMAL(10,2),               -- price snapshot when set to 'watching'
  deal_history_id  INTEGER,                     -- FK -> deal_history.id, set on import
  run_date         DATE NOT NULL,
  first_seen_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  reviewed_at      TIMESTAMP,
  reviewed_by      VARCHAR(100),
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_candidates_status_run ON import_candidates (status, run_date);
CREATE INDEX IF NOT EXISTS idx_import_candidates_tier_score ON import_candidates (tier, deal_score DESC);

-- One row per monitor run (cron or manual) — audit trail for the dashboard header.
CREATE TABLE IF NOT EXISTS import_monitor_runs (
  id                    SERIAL PRIMARY KEY,
  run_date              DATE NOT NULL,
  started_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  finished_at           TIMESTAMP,
  source                VARCHAR(20) NOT NULL DEFAULT 'cron',  -- 'cron' | 'manual'
  feeds_ok              BOOLEAN NOT NULL DEFAULT FALSE,
  candidates_found      INTEGER NOT NULL DEFAULT 0,
  candidates_new        INTEGER NOT NULL DEFAULT 0,
  candidates_resurfaced INTEGER NOT NULL DEFAULT 0,
  auto_imported         INTEGER NOT NULL DEFAULT 0,
  error_message         TEXT
);

CREATE INDEX IF NOT EXISTS idx_import_monitor_runs_date ON import_monitor_runs (run_date);

-- Second admin chat persona shares emma_chat_threads. Existing rows default to 'emma'.
ALTER TABLE emma_chat_threads ADD COLUMN IF NOT EXISTS agent_type VARCHAR(20) NOT NULL DEFAULT 'emma';
