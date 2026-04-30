/**
 * app/lib/sms-v2/web-turn-logger.server.ts
 *
 * Turn logging for the web chat v2 pipeline.
 *
 * Mirrors the SMS turn-logger (turn-logger.server.ts) but:
 *   - Identifies conversation by sessionId (lookup → conversation_id UUID).
 *   - Writes to sms_turns with channel='web', phone=sessionId (uses session_id
 *     as the phone column since phone is NOT NULL and VARCHAR(20) is too short;
 *     we use 'web:<sessionId>' as the sentinel — truncated to 20 chars max).
 *   - pipeline_version = 'v2-web'.
 *   - No idempotency check: web requests are user-initiated, not retried by
 *     Twilio, so we write a fresh row per request.
 *   - No inbound sentinel pattern (no SID to dedup on).
 *
 * NOTE: sms_turns.phone is VARCHAR(20). We truncate the sentinel to 20 chars
 * to fit. The full sessionId is in web_conversations keyed by session_id.
 */
import { eq } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { smsTurns, webConversations } from '../../../db/schema'
import type { StageResponse } from './types.server'
import type { StageTelemetryOverride } from './turn-logger.server'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sentinel phone value that fits within VARCHAR(20). */
function sentinelPhone(sessionId: string): string {
  // 'web:' prefix + first 16 chars of sessionId = 20 chars max.
  return `web:${sessionId.slice(0, 16)}`
}

/**
 * Look up the conversation_id UUID for a given sessionId from web_conversations.
 * Returns null if not found (row may not have been created yet — caller handles).
 */
async function getWebConversationId(sessionId: string): Promise<string | null> {
  const rows = await db
    .select({ conversationId: webConversations.conversationId })
    .from(webConversations)
    .where(eq(webConversations.sessionId, sessionId))
    .limit(1)
  return rows[0]?.conversationId ?? null
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Write inbound + outbound sms_turns rows for a web chat turn.
 *
 * - channel = 'web'
 * - phone = 'web:<first16charsOfSessionId>' (sentinel to satisfy NOT NULL)
 * - pipeline_version = 'v2-web'
 * - No idempotency check (fresh row per request).
 *
 * Returns the written inbound row id (or null on failure — non-fatal).
 */
export async function logWebTurn(opts: {
  sessionId: string
  customerMsg: string
  emmaMsg: string | null
  latencyMs: number
  stageIn: string
  stageOut: string
  intent: string
  intentConfidence: number
  inputTokens?: number
  outputTokens?: number
  toolCalls?: Array<{ name: string; input: unknown; ok: boolean; error?: string | undefined }>
  fabricationCaught?: string
}): Promise<number | null> {
  const {
    sessionId,
    customerMsg,
    emmaMsg,
    latencyMs,
    stageIn,
    stageOut,
    intent,
    intentConfidence,
    inputTokens,
    outputTokens,
    toolCalls,
    fabricationCaught,
  } = opts

  const phone = sentinelPhone(sessionId)
  let conversationId: string | null = null

  try {
    conversationId = await getWebConversationId(sessionId)
  } catch (err) {
    console.error('[web-turn-logger] getWebConversationId failed — skipping turn log', err)
    return null
  }

  if (!conversationId) {
    console.warn(`[web-turn-logger] no web_conversations row for sessionId=${sessionId} — skipping turn log`)
    return null
  }

  let inboundId: number | null = null

  try {
    const inserted = await db
      .insert(smsTurns)
      .values({
        phone,
        conversationId,
        direction: 'inbound',
        stageIn,
        stageOut,
        intent,
        intentConfidence,
        customerMsg,
        latencyMs,
        pipelineVersion: 'v2-web',
        channel: 'web',
        ...(inputTokens !== undefined && { inputTokens }),
        ...(outputTokens !== undefined && { outputTokens }),
        ...(toolCalls !== undefined && { toolCalls }),
        ...(fabricationCaught !== undefined && { fabricationCaught }),
      })
      .returning({ id: smsTurns.id })

    inboundId = inserted[0]?.id ?? null
  } catch (err) {
    console.error('[web-turn-logger] inbound row insert failed', err)
    return null
  }

  // Write outbound row if there is a reply.
  if (emmaMsg !== null) {
    try {
      await db.insert(smsTurns).values({
        phone,
        conversationId,
        direction: 'outbound',
        stageIn,
        stageOut,
        intent,
        intentConfidence,
        emmaMsg,
        latencyMs,
        pipelineVersion: 'v2-web',
        channel: 'web',
        ...(inputTokens !== undefined && { inputTokens }),
        ...(outputTokens !== undefined && { outputTokens }),
        ...(toolCalls !== undefined && { toolCalls }),
        ...(fabricationCaught !== undefined && { fabricationCaught }),
      })
    } catch (err) {
      console.error('[web-turn-logger] outbound row insert failed', err)
    }
  }

  return inboundId
}

/**
 * Convenience wrapper: log a completed StageResponse for a web turn.
 * Extracts prose from all segments as the emmaMsg.
 */
export async function logWebStageResponse(
  sessionId: string,
  customerMsg: string,
  stageResp: StageResponse,
  telemetry: StageTelemetryOverride,
  startedAt: number,
): Promise<void> {
  const emmaMsg = stageResp.segments
    .map((s) => s.prose)
    .filter(Boolean)
    .join('\n\n') || null

  const turnOpts: Parameters<typeof logWebTurn>[0] = {
    sessionId,
    customerMsg,
    emmaMsg,
    latencyMs: Date.now() - startedAt,
    stageIn: telemetry.stageIn,
    stageOut: telemetry.stageOut,
    intent: telemetry.intent,
    intentConfidence: telemetry.intentConfidence,
  }
  if (telemetry.inputTokens !== undefined)      turnOpts.inputTokens      = telemetry.inputTokens
  if (telemetry.outputTokens !== undefined)     turnOpts.outputTokens     = telemetry.outputTokens
  if (telemetry.toolCalls !== undefined)        turnOpts.toolCalls        = telemetry.toolCalls
  if (telemetry.fabricationCaught !== undefined) turnOpts.fabricationCaught = telemetry.fabricationCaught
  await logWebTurn(turnOpts)
}
