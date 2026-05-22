-- Migration 040: post-import enrichment + publish lifecycle.
--
-- Auto-import (Phase 2) and manual approve produce a bare, unpublished Shopify
-- DRAFT. This migration adds the state needed to drive the rest of the flow:
-- import -> enrich (Anthropic Batch API) -> publish (draft->active).
--
-- Two pieces:
--   1. Lifecycle timestamps on import_candidates so the enrich/publish cron can
--      find work and /admin/imports can show where each product sits. We keep
--      the existing terminal `status='imported'` and track the post-import
--      stages with timestamps instead of new status strings.
--   2. enrichment_batches — durable record of each submitted Anthropic batch so
--      the 60s-capped cron can submit on one tick and collect on a later one.
--
-- All ALTERs are additive + idempotent.

-- 1. Lifecycle columns on import_candidates.
ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS enriched_at     TIMESTAMP;
ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS published_at    TIMESTAMP;
ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS enrich_batch_id VARCHAR(100);

-- Find unenriched imported products fast (status='imported' AND enriched_at IS NULL).
CREATE INDEX IF NOT EXISTS idx_import_candidates_enrich
  ON import_candidates (status, enriched_at);

-- 2. enrichment_batches — one row per submitted Anthropic Message Batch.
CREATE TABLE IF NOT EXISTS enrichment_batches (
  id            SERIAL PRIMARY KEY,
  batch_id      VARCHAR(100) NOT NULL UNIQUE,
  status        VARCHAR(20)  NOT NULL DEFAULT 'pending',  -- pending | collected | failed
  candidate_ids JSON         NOT NULL,                    -- int[] of import_candidates.id
  product_ids   JSON         NOT NULL,                    -- string[] of Shopify product gids
  succeeded     INTEGER      NOT NULL DEFAULT 0,
  failed        INTEGER      NOT NULL DEFAULT 0,
  error         TEXT,
  submitted_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
  collected_at  TIMESTAMP
);

-- Pending-batch lookup for the collect step.
CREATE INDEX IF NOT EXISTS idx_enrichment_batches_status
  ON enrichment_batches (status, submitted_at);
