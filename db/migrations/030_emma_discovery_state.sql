-- 030_emma_discovery_state.sql
--
-- Adds the discovery gate-state machine and slot accumulator to the SMS and
-- web conversation tables, plus a soft-beat telemetry flag on sms_turns for
-- vulnerability-disclosure moments.
--
-- discovery_state: discriminated-union JSONB carrying { gate, slots, resumeGate? }.
--   NULL on rows that pre-date this migration; the gate machine treats NULL as
--   "initialize on first read."
--
-- discovered_slots: flat accumulator JSONB. Defaults to '{}' so existing code
--   that reads the column and merges always sees an object.
--
-- soft_beat: per-turn flag set when the engine recognized a vulnerability
--   disclosure (first time, post-divorce, "embarrassing question", etc.) and
--   suppressed gate advancement / product pitch in favor of an empathy reply.

ALTER TABLE sms_conversations
  ADD COLUMN IF NOT EXISTS discovery_state  JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS discovered_slots JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE web_conversations
  ADD COLUMN IF NOT EXISTS discovery_state  JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS discovered_slots JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE sms_turns
  ADD COLUMN IF NOT EXISTS soft_beat BOOLEAN NOT NULL DEFAULT FALSE;

-- Functional index over the gate value so we can query "where are conversations
-- stalled" without scanning the JSONB on every conversation row.
CREATE INDEX IF NOT EXISTS sms_conversations_discovery_gate_idx
  ON sms_conversations ((discovery_state->>'gate'));

CREATE INDEX IF NOT EXISTS web_conversations_discovery_gate_idx
  ON web_conversations ((discovery_state->>'gate'));

-- Telemetry-side index for analyzing soft-beat frequency over time.
CREATE INDEX IF NOT EXISTS sms_turns_soft_beat_idx
  ON sms_turns (soft_beat, created_at DESC)
  WHERE soft_beat = TRUE;
