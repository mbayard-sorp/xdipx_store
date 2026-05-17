-- Migration 036: add metadata jsonb column to sms_turns
--
-- Powers the SMS discovery-gate skip-rate analytics required by the v2 "What
-- Matters" launch (see docs/what-matters-final-signoff.md). Co-Work chose the
-- JSONB column over a GA4 Measurement Protocol event because the SMS volume
-- is currently zero and direct SQL queryability matters more than cross-
-- channel funnel joining.
--
-- Shape (initial usage — extensible):
--   { gateAdvance: { from: 'MOOD', to: 'WHO', skipped: false, slotFilled: 'mood' } }
--
-- Future telemetry — A/B test variants, abandonment markers, etc. — can land
-- on the same column without further migrations.
--
-- DO NOT apply without explicit user approval. See project migration workflow.

ALTER TABLE sms_turns
  ADD COLUMN IF NOT EXISTS metadata jsonb;
