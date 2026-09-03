-- 093_conversation_quality_daily.sql
-- Nightly per-channel conversation quality rollup (ticket #625), the
-- conversation-surfaces twin of seo_coverage_daily (db/schema.ts:1482).
--
-- One row per (day, channel), channel one of 'web' | 'sms' | 'voice'. Filled by
-- /cron/conversation-quality-daily, which aggregates sms_turns -- the unified
-- per-turn log all three channels already write to (turn-logger.server.ts,
-- web-turn-logger.server.ts, adapters/voice.server.ts) -- so the run start
-- baseline the support team's retro can read this table from day one, with no
-- backfill needed.
--
-- FULLY ADDITIVE: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS
-- only. No DROP, no RENAME, no ALTER TYPE, no DML.
--
-- Apply: DATABASE_URL=<prod> npx tsx scripts/apply-migrations.ts --from 093
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS conversation_quality_daily (
  id                     serial PRIMARY KEY,
  day                    date         NOT NULL,
  channel                varchar(8)   NOT NULL,
  sessions               integer      NOT NULL DEFAULT 0,
  turns                  integer      NOT NULL DEFAULT 0,
  fabrication_trips      integer      NOT NULL DEFAULT 0,
  tool_budget_exhausted  integer      NOT NULL DEFAULT 0,
  error_turns            integer      NOT NULL DEFAULT 0,
  v2_fallback_count      integer      NOT NULL DEFAULT 0,
  p50_latency_ms         integer,
  p95_latency_ms         integer,
  created_at             timestamptz  NOT NULL DEFAULT now(),
  updated_at             timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_quality_daily_day_channel_uniq
  ON conversation_quality_daily (day, channel);

CREATE INDEX IF NOT EXISTS idx_conversation_quality_daily_day
  ON conversation_quality_daily (day);
