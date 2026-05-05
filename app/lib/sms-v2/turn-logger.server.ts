/**
 * app/lib/sms-v2/turn-logger.server.ts
 *
 * Phase 0 SMS observability wrapper.
 *
 * withTurnLogging() wraps a processSmsMessage() call and writes two rows to
 * sms_turns: one inbound sentinel (written before the call so an idempotency
 * check can short-circuit duplicate Twilio retries) and one outbound row
 * (written after the call completes with the actual reply + latency).
 *
 * getOrCreateConversation() lazily upserts a row in sms_conversations and
 * returns the stable conversation_id UUID that links all turns for a phone.
 *
 * NOTE: Token counts and tool-call details are not surfaced from v1's internals
 * in Phase 0 — those columns are left null. Phase 1 will plumb them through
 * when the v2 pipeline takes over.
 */
import { eq } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { smsTurns } from '../../../db/schema'
import type { ProcessSmsInput, ProcessSmsResult } from '~/lib/sms-processor.server'
import type { StageResponse } from './types.server'
import { getOrCreateConversation as _getOrCreateConversation } from './conversation.server'
import { stageResponseToProcessResult } from './stage-dispatch.server'

// ---------------------------------------------------------------------------
// Conversation management
// ---------------------------------------------------------------------------

/**
 * Look up the sms_conversations row for `phone`, inserting it if it doesn't
 * exist. Returns the stable conversation_id UUID.
 *
 * Phase 1: delegates to conversation.server.ts which handles 24h rotation,
 * 6h stage TTL, and customer enrichment on first contact. Signature unchanged
 * from Phase 0 so existing callers (smoke tests, pipeline-flag smoke) continue
 * to work without modification.
 */
export async function getOrCreateConversation(phone: string): Promise<string> {
  const row = await _getOrCreateConversation(phone)
  return row.conversationId
}

// ---------------------------------------------------------------------------
// Idempotency helpers
// ---------------------------------------------------------------------------

/**
 * Insert a sentinel inbound row into sms_turns for the given twilioSid.
 * Uses INSERT ... ON CONFLICT DO NOTHING and returns whether the row was new.
 * If affected = 0, the SID was already processed — the caller should return
 * cached TwiML immediately without calling the LLM.
 *
 * Returns `{ inserted: boolean, sentinelId: number | null }`.
 * sentinelId is set when inserted=true so the caller can update the row later.
 */
export async function insertSentinelInbound(
  phone: string,
  conversationId: string,
  twilioSid: string,
  pipelineVersion: string,
  customerMsg: string,
): Promise<{ inserted: boolean; sentinelId: number | null }> {
  // Drizzle neon-http returns a result with `rowCount` on execute.
  const result = await db
    .insert(smsTurns)
    .values({
      phone,
      conversationId,
      twilioMessageSid: twilioSid,
      direction: 'inbound',
      stageIn: 'V1',
      stageOut: 'V1',
      customerMsg,
      pipelineVersion,
    })
    .onConflictDoNothing()
    .returning({ id: smsTurns.id })

  if (result.length === 0) {
    return { inserted: false, sentinelId: null }
  }
  return { inserted: true, sentinelId: result[0]?.id ?? null }
}

/**
 * Optional Phase 1 observability fields that can be written to sms_turns rows
 * after the processor call resolves. All fields are optional — Phase 0 callers
 * pass nothing and the columns stay null.
 *
 * Phase 5.5 adds token/tool fields for v2 stage handlers.
 */
export interface TurnObservabilityUpdate {
  intent?: string
  intentConfidence?: number
  stageIn?: string
  stageOut?: string
  // Phase 5.5: populated by v2 stage handlers
  inputTokens?: number | undefined
  outputTokens?: number | undefined
  toolCalls?: Array<{ name: string; input: unknown; ok: boolean; error?: string | undefined }> | undefined
  fabricationCaught?: string | undefined
  /** True when this turn was a vulnerability soft-beat (gate not advanced,
   *  no product surfaced). Written to sms_turns.soft_beat column. */
  softBeat?: boolean | undefined
  /**
   * Migration 032: true when the Sonnet loop exhausted MAX_TOOL_HOPS with a
   * pending tool_use stop_reason. Written to sms_turns.tool_budget_exhausted.
   */
  toolBudgetExhausted?: boolean | undefined
  /**
   * ADR-003a Fix 3: true when the dedup filter returned all_results_previously_pitched.
   * Surfaces the repeat-pitch failure mode in turn logs without parsing tool result codes.
   */
  searchRepeatedPitch?: boolean | undefined
}

/**
 * Update the sentinel inbound row with real fields after processSmsMessage
 * completes. Also writes a paired outbound row.
 */
export async function finaliseTurnRows(opts: {
  sentinelId: number
  phone: string
  conversationId: string
  customerMsg: string
  emmaMsg: string | null
  latencyMs: number
  pipelineVersion: string
  simulated: boolean
  observability?: TurnObservabilityUpdate | undefined
}): Promise<void> {
  const { sentinelId, phone, conversationId, emmaMsg, latencyMs, pipelineVersion, simulated, observability } = opts

  // Update the sentinel inbound row with latency + optional Phase 1/5.5 fields.
  await db
    .update(smsTurns)
    .set({
      latencyMs,
      ...(observability?.intent !== undefined            && { intent: observability.intent }),
      ...(observability?.intentConfidence !== undefined  && { intentConfidence: observability.intentConfidence }),
      ...(observability?.stageIn !== undefined           && { stageIn: observability.stageIn }),
      ...(observability?.stageOut !== undefined          && { stageOut: observability.stageOut }),
      // Phase 5.5: token counts + tool calls from v2 stage handlers
      ...(observability?.inputTokens !== undefined       && { inputTokens: observability.inputTokens }),
      ...(observability?.outputTokens !== undefined      && { outputTokens: observability.outputTokens }),
      ...(observability?.toolCalls !== undefined         && { toolCalls: observability.toolCalls }),
      ...(observability?.fabricationCaught !== undefined && { fabricationCaught: observability.fabricationCaught }),
      // Gate-state: soft-beat flag for vulnerability turns
      ...(observability?.softBeat !== undefined          && { softBeat: observability.softBeat }),
      // Migration 032: tool-budget exhaustion telemetry
      ...(observability?.toolBudgetExhausted !== undefined && { toolBudgetExhausted: observability.toolBudgetExhausted }),
    })
    .where(eq(smsTurns.id, sentinelId))

  // Write the paired outbound row if there was a reply.
  if (emmaMsg !== null) {
    await db.insert(smsTurns).values({
      phone,
      conversationId,
      direction: 'outbound',
      stageIn: observability?.stageIn ?? 'V1',
      stageOut: observability?.stageOut ?? 'V1',
      intent: observability?.intent,
      intentConfidence: observability?.intentConfidence,
      inputTokens: observability?.inputTokens,
      outputTokens: observability?.outputTokens,
      toolCalls: observability?.toolCalls,
      fabricationCaught: observability?.fabricationCaught,
      softBeat: observability?.softBeat,
      toolBudgetExhausted: observability?.toolBudgetExhausted ?? false,
      emmaMsg,
      latencyMs,
      pipelineVersion,
    })
  }

  // simulated flag is threaded through for Phase 1 filtering; unused in Phase 0
  void simulated
}

// ---------------------------------------------------------------------------
// Main wrapper
// ---------------------------------------------------------------------------

/**
 * Wraps a processSmsMessage() call with turn logging.
 *
 * For live Twilio messages (twilioSid present):
 *   1. getOrCreateConversation() to get a stable UUID.
 *   2. insertSentinelInbound() — if SID already exists, return early (dedup).
 *   3. Call processSmsMessage().
 *   4. finaliseTurnRows() with latency + reply.
 *
 * For simulator calls (no twilioSid):
 *   - Idempotency check is skipped (no SID to deduplicate on).
 *   - Still writes inbound + outbound rows so simulator turns are visible in
 *     the metrics view (filterable by pipeline_version='v1' + simulated flag
 *     on the paired sms_messages row).
 *
 * Returns the ProcessSmsResult unchanged — behavior is unmodified.
 */
export async function withTurnLogging(
  input: ProcessSmsInput,
  processFn: (input: ProcessSmsInput) => Promise<ProcessSmsResult>,
  pipelineVersion: string,
  observability?: TurnObservabilityUpdate,
): Promise<ProcessSmsResult> {
  const phone = input.from.trim()
  const twilioSid = (input.twilioSid ?? '').trim()
  const simulated = input.simulated ?? false

  // Lazy-create conversation row and get the stable UUID.
  let conversationId: string
  try {
    conversationId = await getOrCreateConversation(phone)
  } catch (err) {
    console.error('[turn-logger] getOrCreateConversation failed — bypassing logging', err)
    return processFn(input)
  }

  // Idempotency: only applies to real Twilio messages that carry a SID.
  let sentinelId: number | null = null
  if (twilioSid) {
    let insertResult: { inserted: boolean; sentinelId: number | null }
    try {
      insertResult = await insertSentinelInbound(
        phone,
        conversationId,
        twilioSid,
        pipelineVersion,
        input.body,
      )
    } catch (err) {
      console.error('[turn-logger] sentinel insert failed — bypassing dedup', err)
      insertResult = { inserted: true, sentinelId: null }
    }

    if (!insertResult.inserted) {
      // SID was already processed — return empty TwiML by returning a no-reply result.
      console.warn(`[turn-logger] duplicate SID ${twilioSid} — returning empty result`)
      return { replies: [], reply: null, outcome: 'empty' }
    }
    sentinelId = insertResult.sentinelId
  }

  // Call the real processor and measure latency.
  const start = Date.now()
  let result: ProcessSmsResult
  try {
    result = await processFn(input)
  } catch (err) {
    // Log the error but re-throw so the route-level catch can handle TwiML.
    if (sentinelId !== null) {
      try {
        await db
          .update(smsTurns)
          .set({
            errors: [{ message: err instanceof Error ? err.message : String(err) }],
            latencyMs: Date.now() - start,
          })
          .where(eq(smsTurns.id, sentinelId))
      } catch (logErr) {
        console.error('[turn-logger] failed to write error to sentinel row', logErr)
      }
    }
    throw err
  }

  const latencyMs = Date.now() - start
  const emmaMsg = result.reply

  // For simulator calls without a sentinel row, write a fresh inbound row.
  if (!sentinelId) {
    try {
      const inserted = await db
        .insert(smsTurns)
        .values({
          phone,
          conversationId,
          direction: 'inbound',
          stageIn: 'V1',
          stageOut: 'V1',
          customerMsg: input.body,
          latencyMs,
          pipelineVersion,
        })
        .returning({ id: smsTurns.id })
      sentinelId = inserted[0]?.id ?? null
    } catch (err) {
      console.error('[turn-logger] simulator inbound row insert failed', err)
    }
  }

  // Finalise: update inbound row + write outbound row.
  if (sentinelId !== null) {
    try {
      await finaliseTurnRows({
        sentinelId,
        phone,
        conversationId,
        customerMsg: input.body,
        emmaMsg,
        latencyMs,
        pipelineVersion,
        simulated,
        ...(observability !== undefined && { observability }),
      })
    } catch (err) {
      console.error('[turn-logger] finaliseTurnRows failed — reply already sent', err)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// withTurnLoggingForStageResponse — Phase 5.5
// ---------------------------------------------------------------------------

/**
 * Extended telemetry fields written by v2 stage handlers. Superset of
 * TurnObservabilityUpdate with required stageIn/stageOut for stage handlers.
 */
export interface StageTelemetryOverride {
  intent: string
  intentConfidence: number
  stageIn: string
  stageOut: string
  inputTokens?: number | undefined
  outputTokens?: number | undefined
  toolCalls?: Array<{ name: string; input: unknown; ok: boolean; error?: string | undefined }> | undefined
  fabricationCaught?: string | undefined
  /** True when this turn was a vulnerability soft-beat. Written to soft_beat column. */
  softBeat?: boolean | undefined
  /**
   * Migration 032: true when the Sonnet loop exhausted MAX_TOOL_HOPS with a
   * pending tool_use stop_reason. Written to sms_turns.tool_budget_exhausted.
   */
  toolBudgetExhausted?: boolean | undefined
  /**
   * ADR-003a Fix 3: true when the dedup filter returned all_results_previously_pitched.
   */
  searchRepeatedPitch?: boolean | undefined
}

/**
 * Wraps an already-computed StageResponse with the same idempotency + logging
 * dance as withTurnLogging(), but without calling a processFn again.
 *
 * Steps:
 *   1. getOrCreateConversation() → stable conversationId UUID.
 *   2. insertSentinelInbound() for real Twilio messages (dedup).
 *   3. finaliseTurnRows() with the stage handler's telemetry.
 *   4. Return the adapted ProcessSmsResult.
 *
 * The existing withTurnLogging() API is unchanged — this is a sibling export.
 */
export async function withTurnLoggingForStageResponse(
  input: ProcessSmsInput,
  stageResp: StageResponse,
  pipelineVersion: string,
  telemetry: StageTelemetryOverride,
): Promise<ProcessSmsResult> {
  const phone = input.from.trim()
  const twilioSid = (input.twilioSid ?? '').trim()
  const simulated = input.simulated ?? false

  // Adapt to ProcessSmsResult now so we have it regardless of logging outcome.
  const result = stageResponseToProcessResult(stageResp, simulated)

  // Lazy-create conversation row and get the stable UUID.
  let conversationId: string
  try {
    conversationId = await getOrCreateConversation(phone)
  } catch (err) {
    console.error('[turn-logger] withTurnLoggingForStageResponse: getOrCreateConversation failed', err)
    return result
  }

  // Idempotency: only for real Twilio messages carrying a SID.
  let sentinelId: number | null = null
  if (twilioSid) {
    let insertResult: { inserted: boolean; sentinelId: number | null }
    try {
      insertResult = await insertSentinelInbound(
        phone,
        conversationId,
        twilioSid,
        pipelineVersion,
        input.body,
      )
    } catch (err) {
      console.error('[turn-logger] withTurnLoggingForStageResponse: sentinel insert failed', err)
      insertResult = { inserted: true, sentinelId: null }
    }

    if (!insertResult.inserted) {
      // Duplicate SID — already processed.
      console.warn(`[turn-logger] withTurnLoggingForStageResponse: duplicate SID ${twilioSid} — returning empty`)
      return { replies: [], reply: null, outcome: 'empty' }
    }
    sentinelId = insertResult.sentinelId
  }

  const start = Date.now()

  // For simulator calls without a sentinel row, write a fresh inbound row.
  if (!sentinelId) {
    try {
      const inserted = await db
        .insert(smsTurns)
        .values({
          phone,
          conversationId,
          direction: 'inbound',
          stageIn: telemetry.stageIn,
          stageOut: telemetry.stageOut,
          customerMsg: input.body,
          pipelineVersion,
        })
        .returning({ id: smsTurns.id })
      sentinelId = inserted[0]?.id ?? null
    } catch (err) {
      console.error('[turn-logger] withTurnLoggingForStageResponse: simulator inbound row insert failed', err)
    }
  }

  const latencyMs = Date.now() - start
  const emmaMsg = result.reply

  const observability: TurnObservabilityUpdate = {
    intent: telemetry.intent,
    intentConfidence: telemetry.intentConfidence,
    stageIn: telemetry.stageIn,
    stageOut: telemetry.stageOut,
    ...(telemetry.inputTokens !== undefined       && { inputTokens: telemetry.inputTokens }),
    ...(telemetry.outputTokens !== undefined      && { outputTokens: telemetry.outputTokens }),
    ...(telemetry.toolCalls !== undefined         && { toolCalls: telemetry.toolCalls }),
    ...(telemetry.fabricationCaught !== undefined && { fabricationCaught: telemetry.fabricationCaught }),
    // Gate-state: soft-beat flag for vulnerability turns
    ...(telemetry.softBeat !== undefined          && { softBeat: telemetry.softBeat }),
    // Migration 032: tool-budget exhaustion telemetry
    ...(telemetry.toolBudgetExhausted !== undefined && { toolBudgetExhausted: telemetry.toolBudgetExhausted }),
  }

  if (sentinelId !== null) {
    try {
      await finaliseTurnRows({
        sentinelId,
        phone,
        conversationId,
        customerMsg: input.body,
        emmaMsg,
        latencyMs,
        pipelineVersion,
        simulated,
        observability,
      })
    } catch (err) {
      console.error('[turn-logger] withTurnLoggingForStageResponse: finaliseTurnRows failed', err)
    }
  }

  return result
}
