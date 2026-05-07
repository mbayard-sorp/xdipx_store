-- 032_conversation_summary.sql
-- Phase 0: rolling conversation summary + pitched handles log + tool_budget_exhausted flag
--
-- sms_conversations: two new columns to persist memory across history truncation
--   conversation_summary   — Haiku-generated 1-2 sentence summary, updated fire-and-forget
--                            each turn. Survives 24h session rotation (copied forward).
--   pitched_handles_log    — Ordered array of last 10 pitched product handles.
--                            Enables "the first one you showed me" resolution.
--
-- web_conversations: mirrors the same columns (per Q1 decision: add to both now,
--   prevent Phase 2 schema reconciliation cost).
--
-- sms_turns: tool_budget_exhausted boolean for telemetry. Enables "how often does
--   the agent run out of tool hops?" dashboard query.

ALTER TABLE sms_conversations
  ADD COLUMN IF NOT EXISTS conversation_summary   text,
  ADD COLUMN IF NOT EXISTS pitched_handles_log    text[];

ALTER TABLE web_conversations
  ADD COLUMN IF NOT EXISTS conversation_summary   text,
  ADD COLUMN IF NOT EXISTS pitched_handles_log    text[];

ALTER TABLE sms_turns
  ADD COLUMN IF NOT EXISTS tool_budget_exhausted  boolean NOT NULL DEFAULT false;
