-- Daily pricing review agent — change log + queue
-- Records every price change proposed by the agent. Status drives the queue.

CREATE TABLE IF NOT EXISTS pricing_changes (
  id              BIGSERIAL PRIMARY KEY,
  proposed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_date        DATE        NOT NULL,
  sku             TEXT        NOT NULL,
  product_id      TEXT        NOT NULL,
  product_handle  TEXT,
  product_title   TEXT,
  variant_id      TEXT        NOT NULL,
  variant_title   TEXT,
  vendor          TEXT,
  tier            TEXT        NOT NULL,
  old_price        NUMERIC(10, 2),
  new_price        NUMERIC(10, 2) NOT NULL,
  old_compare_at   NUMERIC(10, 2),
  new_compare_at   NUMERIC(10, 2),
  old_wholesale    NUMERIC(10, 2),
  new_wholesale    NUMERIC(10, 2),
  map_price        NUMERIC(10, 2),
  margin_pct       NUMERIC(6, 4),
  reason          TEXT        NOT NULL,
  map_respected   BOOLEAN     NOT NULL DEFAULT TRUE,
  status          TEXT        NOT NULL DEFAULT 'pending',
    -- pending | auto_applied | approved | rejected | failed | skipped_dry_run
  applied_at      TIMESTAMPTZ,
  approved_by     TEXT,
  apply_error     TEXT,
  CONSTRAINT pricing_changes_status_chk CHECK (status IN
    ('pending', 'auto_applied', 'approved', 'rejected', 'failed', 'skipped_dry_run'))
);

CREATE INDEX IF NOT EXISTS pricing_changes_run_date_idx
  ON pricing_changes (run_date DESC);

CREATE INDEX IF NOT EXISTS pricing_changes_status_idx
  ON pricing_changes (status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS pricing_changes_variant_idx
  ON pricing_changes (variant_id, proposed_at DESC);

CREATE INDEX IF NOT EXISTS pricing_changes_sku_idx
  ON pricing_changes (sku, proposed_at DESC);
