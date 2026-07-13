-- Migration 060: bounded-retry quality gate for post-import enrichment.
--
-- WS4: the auto-import enrichment path is switching from the 24-turn tool-use
-- orchestrator to the single-call full-enrichment batch (submitFullEnrichmentBatch
-- / collectFullEnrichmentBatch), and adding a real quality gate so a failed or
-- incomplete enrichment no longer gets published silently.
--
-- Two columns on import_candidates track the retry/park lifecycle:
--   - enrich_attempts: how many times we've tried to enrich this candidate.
--     Incremented on every gate failure (or missing/errored batch result).
--   - enrich_failed_at: set once enrich_attempts reaches the retry cap (2).
--     A parked row is left alone -- enrich_batch_id is NOT cleared, so
--     submitEnrichmentBatch never re-selects it and collectEnrichmentBatch
--     never re-processes it. Editors can review parked rows manually.
--
-- Both ADDs are additive + idempotent.

ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS enrich_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS enrich_failed_at timestamp;
