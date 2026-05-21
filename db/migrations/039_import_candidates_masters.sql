-- Migration 039: reshape import_candidates to MASTER-level rows.
--
-- The table previously held one row per SKU. We're moving to one row per
-- master product (grouped by brand+base_title). All ALTERs are additive and
-- idempotent. The old per-SKU UNIQUE constraint on `sku` is replaced by a
-- UNIQUE INDEX on the new `master_key` column.
--
-- `sku` remains NOT NULL (holds the representative/sample SKU).
-- `msrp`, `wholesale_cost`, `map_price` now hold MEDIAN values.
-- `qty_available` mirrors `total_qty`.
-- `deal_score` now stores the gap_score (formula in master-collapse.server.ts).
-- `tier` and `gap_reason` keep their meaning; tier is computed from master signals.

-- 1. Drop the old per-SKU unique constraint so we can pivot to master_key.
ALTER TABLE import_candidates DROP CONSTRAINT IF EXISTS import_candidates_sku_key;

-- 2. Add master-level columns (all IF NOT EXISTS for idempotency).
ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS master_key    VARCHAR(200);
ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS base_title    TEXT;
ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS variant_skus  JSON;
ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS variant_count INTEGER;
ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS in_stock_variants INTEGER;
ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS colors        JSON;
ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS sizes         JSON;
ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS volumes       JSON;
ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS axes          JSON;
ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS total_qty     INTEGER;
ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS needs_review  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS upc           VARCHAR(40);
ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS sample_image  TEXT;

-- 3. Unique index on master_key (the new stable identity).
CREATE UNIQUE INDEX IF NOT EXISTS idx_import_candidates_master_key
  ON import_candidates (master_key);
