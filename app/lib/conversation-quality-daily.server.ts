/**
 * Nightly per-channel conversation quality rollup (ticket #625).
 *
 * conversation_quality_daily is the conversation-surfaces twin of
 * seo_coverage_daily (db/schema.ts): one row per (day, channel), filled by
 * /cron/conversation-quality-daily so the support team's retro has a week of
 * real baseline data to read instead of re-deriving it from raw logs by hand.
 *
 * Everything here is sourced from `sms_turns`, the one table all three
 * channels (web, sms, voice) already write every turn to — see
 * app/lib/sms-v2/turn-logger.server.ts, web-turn-logger.server.ts, and
 * adapters/voice.server.ts. No new instrumentation was added to land this;
 * the columns this module reads (fabrication_caught, tool_budget_exhausted,
 * errors, pipeline_version, latency_ms) were already being written at every
 * call site checked.
 *
 * What this rollup does NOT cover, stated rather than silently assumed away:
 * the ticket's original field list also named "refusal rate", "agent_failed
 * 500s" (the catch-all in api.ask-emma.tsx that returns before any turn is
 * ever logged), and "cost per session" (api_token_log's `feature` column
 * logs 'sms' for the shared sms-v2 conversation engine regardless of actual
 * channel, so cost cannot be split by channel from that column alone). None
 * of the three has a reliable persisted source today; inventing one here
 * would make this table look more authoritative than the data underneath it
 * is. A follow-up ticket should add that instrumentation before those
 * columns are added.
 */
import { sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'

export interface ConversationQualityChannelRow {
  channel: string
  sessions: number
  turns: number
  fabricationTrips: number
  toolBudgetExhausted: number
  errorTurns: number
  v2FallbackCount: number
  p50LatencyMs: number | null
  p95LatencyMs: number | null
}

export interface ConversationQualityDailyResult {
  day: string
  channels: ConversationQualityChannelRow[]
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Latency percentiles stay null on an empty group rather than coercing to 0, which would read as "instant". */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : null
}

/** Pure shape of one raw aggregate row (driver-returned strings/numbers/null) into the typed row this module persists. */
export function shapeChannelRow(raw: Record<string, unknown>): ConversationQualityChannelRow {
  return {
    channel:             String(raw['channel']),
    sessions:            num(raw['sessions']),
    turns:               num(raw['turns']),
    fabricationTrips:    num(raw['fabrication_trips']),
    toolBudgetExhausted: num(raw['tool_budget_exhausted']),
    errorTurns:          num(raw['error_turns']),
    v2FallbackCount:     num(raw['v2_fallback_count']),
    p50LatencyMs:        numOrNull(raw['p50_latency_ms']),
    p95LatencyMs:        numOrNull(raw['p95_latency_ms']),
  }
}

/**
 * Aggregate one UTC day of `sms_turns` into the per-channel rollup and upsert
 * it. Defaults to yesterday (UTC), the shape every other nightly cron in this
 * file uses, so a 00:xx-05:xx UTC run always aggregates a fully-closed day.
 *
 * `sms_turns` carries two different row shapes per completed exchange
 * depending on channel — read the actual insert call sites, not just the
 * schema, before touching this query:
 *  - web/sms (turn-logger.server.ts, web-turn-logger.server.ts): an inbound
 *    "sentinel" row is inserted first and later UPDATEd in place with the
 *    turn's observability fields (latency, fabricationCaught, ...), and a
 *    SEPARATE outbound row is inserted carrying the same fields again.
 *    Counting both would double every turn-level metric for these channels.
 *  - voice (adapters/voice.server.ts): exactly ONE row per turn, always
 *    direction='inbound' — there is no paired outbound row. Restricting to
 *    direction='outbound' the way web/sms need would silently zero out the
 *    entire voice channel.
 * `is_turn` below encodes that split so turn-level metrics are counted once
 * per real turn, not zero or double times. `sessions` (distinct
 * conversation_id) has no such hazard and is computed over every row in the
 * day regardless of direction.
 */
export async function runConversationQualityDaily(day?: string): Promise<ConversationQualityDailyResult> {
  const targetDay = day ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const result = await db.execute(sql`
    WITH scoped AS (
      SELECT *,
        (channel = 'voice' AND direction = 'inbound')
        OR (channel <> 'voice' AND direction = 'outbound') AS is_turn
      FROM sms_turns
      WHERE created_at >= ${targetDay}::date AND created_at < ${targetDay}::date + interval '1 day'
    )
    SELECT
      channel,
      count(*) FILTER (WHERE is_turn)::int AS turns,
      count(DISTINCT conversation_id)::int AS sessions,
      count(*) FILTER (WHERE is_turn AND fabrication_caught IS NOT NULL)::int AS fabrication_trips,
      count(*) FILTER (WHERE is_turn AND tool_budget_exhausted)::int AS tool_budget_exhausted,
      count(*) FILTER (WHERE is_turn AND errors IS NOT NULL)::int AS error_turns,
      count(*) FILTER (WHERE is_turn AND pipeline_version = 'v1-web-fallback')::int AS v2_fallback_count,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE is_turn))::int AS p50_latency_ms,
      round(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE is_turn))::int AS p95_latency_ms
    FROM scoped
    GROUP BY channel
  `)

  const channels = ((result.rows ?? []) as Record<string, unknown>[]).map(shapeChannelRow)

  for (const row of channels) {
    await db.execute(sql`
      INSERT INTO conversation_quality_daily (
        day, channel, sessions, turns, fabrication_trips, tool_budget_exhausted,
        error_turns, v2_fallback_count, p50_latency_ms, p95_latency_ms, updated_at
      ) VALUES (
        ${targetDay}::date, ${row.channel}, ${row.sessions}, ${row.turns}, ${row.fabricationTrips},
        ${row.toolBudgetExhausted}, ${row.errorTurns}, ${row.v2FallbackCount},
        ${row.p50LatencyMs}, ${row.p95LatencyMs}, now()
      )
      ON CONFLICT (day, channel) DO UPDATE SET
        sessions              = EXCLUDED.sessions,
        turns                 = EXCLUDED.turns,
        fabrication_trips     = EXCLUDED.fabrication_trips,
        tool_budget_exhausted = EXCLUDED.tool_budget_exhausted,
        error_turns           = EXCLUDED.error_turns,
        v2_fallback_count     = EXCLUDED.v2_fallback_count,
        p50_latency_ms        = EXCLUDED.p50_latency_ms,
        p95_latency_ms        = EXCLUDED.p95_latency_ms,
        updated_at            = now()
    `)
  }

  return { day: targetDay, channels }
}
