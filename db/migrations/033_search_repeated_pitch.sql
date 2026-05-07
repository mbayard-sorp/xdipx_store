-- Migration 033: add search_repeated_pitch to sms_turns
-- ADR-003a Fix 3: telemetry flag written when the dedup filter returns
-- all_results_previously_pitched (all search results were in pitchedHandlesLog).
-- Distinct from tool_budget_exhausted — surfaces this specific failure mode in
-- turn analytics without requiring parsing of the tool result reason code.
--
-- DO NOT apply without explicit user approval. See project migration workflow.

ALTER TABLE sms_turns
  ADD COLUMN IF NOT EXISTS search_repeated_pitch boolean NOT NULL DEFAULT false;
