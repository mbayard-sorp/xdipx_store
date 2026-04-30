/**
 * app/lib/sms-v2/adapters/voice.server.ts
 *
 * Phase 9 — IVR voice adapter for the v2 engine.
 *
 * processVoiceMessageV2() is the Vercel-side entry point for a single IVR
 * conversation turn. The Fly.io bridge calls this via HTTP POST to
 * /api/emma-engine/turn. The adapter:
 *
 *   1. Looks up or creates the sms_conversations row (phone is the key).
 *   2. Classifies intent (same as SMS).
 *   3. Dispatches to the registered v2 stage handler.
 *   4. Converts StageResponse → VoiceReply (SSML + outbound SMS if needed).
 *   5. Writes the turn to sms_turns with channel='voice'.
 *
 * The sms_conversations table is shared with SMS (phone is PK). Cross-channel
 * state merge is a Phase 10 concern; from day 1, the same caller can text and
 * call and both channels share the conversation row.
 *
 * Voice-specific translation rules for StageResponse → VoiceReply:
 *   - segments[].prose → escaped SSML text, paragraph breaks → <break>
 *   - segments[].productCard → speak "{title} — {price}" + outbound SMS with pdpUrl
 *   - segments[].cta.kind === 'checkout' → outboundSms with checkout URL
 *   - segments[].cta.kind === 'pdp' → no outbound SMS (IVR can't click links)
 *   - segments[].pillOptions → spoken "press 1 for X, press 2 for Y" hints
 *     (the Fly bridge owns the actual <Gather> TwiML — we just signal intent)
 *   - stageOut === 'CHECKOUT' → hangup: false after SMS link sent
 */
import { getOrCreateConversation, applyStateWrites } from '../conversation.server'
import { classifyIntent } from '../intent-classifier.server'
import { pickEffectiveStage, dispatchStage } from '../stage-dispatch.server'
import { buildEmmaContext } from '../context-builder.server'
import { sendSms } from '~/lib/twilio.server'
import { db } from '~/lib/db.server'
import { smsTurns } from '../../../../db/schema'
import type { Stage, StageResponse } from '../types.server'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessVoiceInput {
  callerPhone: string         // E.164 from Twilio
  customerText: string        // ASR transcript or DTMF-normalized text
  callSid: string             // Twilio Call SID for idempotency + tracing
  conversationId?: string | undefined  // Fly bridge tracks this across turns
  intentHint?: 'dtmf' | 'speech' | undefined  // ASR vs button press
}

export interface VoiceReply {
  ssml: string                // <speak>...</speak> for Twilio ConversationRelay
  prompts?: { kind: 'say-and-listen' | 'gather-digits' | 'hangup' } | undefined
  outboundSms?: { body: string } | undefined  // when Emma needs to send a checkout/PDP link
  hangup?: boolean | undefined
}

// ---------------------------------------------------------------------------
// SSML helpers
// ---------------------------------------------------------------------------

/**
 * Escape a plain-text string for safe embedding in SSML.
 * SSML is a subset of XML, so we need to escape the five XML special chars.
 */
function ssmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Convert a prose string to SSML inner content.
 * Paragraph breaks (double newline) become <break time="500ms"/>.
 * Single newlines become a space (sentence continuation).
 */
function proseToSsmlContent(prose: string): string {
  return prose
    .split(/\n\n+/)
    .map((para) => ssmlEscape(para.replace(/\n/g, ' ').trim()))
    .filter(Boolean)
    .join(' <break time="500ms"/> ')
}

/**
 * Wrap SSML inner content in a <speak> root element.
 */
function wrapSsml(inner: string): string {
  return `<speak>${inner}</speak>`
}

/**
 * Build spoken pill options — "press 1 for X, press 2 for Y".
 * The Fly bridge owns the actual DTMF <Gather>, but including these hints in
 * the SSML means the caller hears them and knows what to press.
 */
function pillOptionsToSsml(pills: string[]): string {
  if (!pills.length) return ''
  const options = pills
    .slice(0, 9) // DTMF digits 1-9 only
    .map((p, i) => `press ${i + 1} for ${ssmlEscape(p)}`)
    .join(', ')
  return ` ${options}.`
}

// ---------------------------------------------------------------------------
// Core: StageResponse → VoiceReply
// ---------------------------------------------------------------------------

async function stageResponseToVoiceReply(
  stageResp: StageResponse,
  callerPhone: string,
): Promise<VoiceReply> {
  const ssmlParts: string[] = []
  let outboundSms: VoiceReply['outboundSms'] = undefined
  let hangup = false

  for (const seg of stageResp.segments) {
    // 1. Prose — convert to SSML
    if (seg.prose.trim()) {
      ssmlParts.push(proseToSsmlContent(seg.prose))
    }

    // 2. Product card — IVR can't show images; speak title + price, send SMS with pdpUrl
    if (seg.productCard) {
      const card = seg.productCard
      const spoken = card.price
        ? `${ssmlEscape(card.title)}, ${ssmlEscape(card.price)}`
        : ssmlEscape(card.title)
      ssmlParts.push(spoken)
      // Send PDP URL via SMS so caller can tap the link later.
      // If there's already a checkout outbound SMS queued, prefer that (caller
      // already committed). pdpUrl is browser-only — send it via SMS.
      if (!outboundSms && card.pdpUrl) {
        try {
          await sendSms(
            callerPhone,
            `Here's the link I mentioned: ${card.pdpUrl}`,
          )
        } catch (err) {
          // Non-fatal — the IVR call continues even if the SMS fails.
          console.warn(`[voice-adapter] outbound SMS for pdpUrl failed callerPhone=${callerPhone}`, err)
        }
      }
    }

    // 3. CTA
    if (seg.cta) {
      if (seg.cta.kind === 'checkout') {
        // Checkout URL — send via SMS and let caller know.
        outboundSms = { body: seg.cta.url }
        hangup = false // stay on call after sending link (caller confirms receipt)
        ssmlParts.push("I just texted you a secure checkout link. Check your messages.")
      }
      // pdp / collection CTAs are browser-only — skip for voice
    }

    // 4. Pill options — spoken DTMF hints
    if (seg.pillOptions?.length) {
      const pillSsml = pillOptionsToSsml(seg.pillOptions)
      if (pillSsml) ssmlParts.push(pillSsml)
    }
  }

  // Stage-level hangup signal
  if (stageResp.stageOut === 'POST_CHECKOUT' && !outboundSms) {
    hangup = true
  }

  const innerSsml = ssmlParts.join(' <break time="300ms"/> ')
  const ssml = wrapSsml(innerSsml || "I'm here. What can I help you with?")

  // Determine prompt kind based on stage and segment content
  const hasGather = stageResp.segments.some((s) => (s.pillOptions?.length ?? 0) > 0)
  const promptKind: VoiceReply['prompts'] = hangup
    ? { kind: 'hangup' }
    : hasGather
    ? { kind: 'gather-digits' }
    : { kind: 'say-and-listen' }

  return {
    ssml,
    prompts: promptKind,
    ...(outboundSms !== undefined && { outboundSms }),
    ...(hangup && { hangup }),
  }
}

// ---------------------------------------------------------------------------
// Turn logging for voice
// ---------------------------------------------------------------------------

async function logVoiceTurn(opts: {
  callerPhone: string
  conversationId: string
  callSid: string
  customerText: string
  ssml: string
  stageIn: string
  stageOut: string
  intent: string
  intentConfidence: number
  inputTokens?: number | undefined
  outputTokens?: number | undefined
  latencyMs: number
}): Promise<void> {
  try {
    await db.insert(smsTurns).values({
      phone: opts.callerPhone,
      conversationId: opts.conversationId as `${string}-${string}-${string}-${string}-${string}`,
      // Voice turns don't have a Twilio Message SID — use callSid as a scoped
      // identifier. We prefix with "call:" so it doesn't collide with SMS SIDs.
      twilioMessageSid: `call:${opts.callSid}:${Date.now()}`,
      direction: 'inbound',
      channel: 'voice',
      stageIn: opts.stageIn,
      stageOut: opts.stageOut,
      intent: opts.intent,
      intentConfidence: opts.intentConfidence,
      customerMsg: opts.customerText,
      emmaMsg: opts.ssml,
      ...(opts.inputTokens !== undefined && { inputTokens: opts.inputTokens }),
      ...(opts.outputTokens !== undefined && { outputTokens: opts.outputTokens }),
      latencyMs: opts.latencyMs,
      pipelineVersion: 'v2-voice',
    })
  } catch (err) {
    // Non-fatal — don't fail the turn over logging.
    console.error('[voice-adapter] logVoiceTurn failed', err)
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Process a single IVR conversation turn through the v2 engine.
 *
 * This is the Vercel-side handler called by the Fly bridge via HTTP POST to
 * /api/emma-engine/turn.
 *
 * Falls back to a safe default SSML reply on hard errors — the call must
 * continue even if the engine crashes.
 */
export async function processVoiceMessageV2(
  input: ProcessVoiceInput,
): Promise<VoiceReply> {
  const { callerPhone, customerText, callSid } = input
  const started = Date.now()

  // --- Step 1: Get or create conversation (phone is the key) ---
  let conversation: Awaited<ReturnType<typeof getOrCreateConversation>>
  try {
    conversation = await getOrCreateConversation(callerPhone)
  } catch (err) {
    console.error('[voice-adapter] getOrCreateConversation failed', err)
    return {
      ssml: wrapSsml("Sorry, I ran into a little hiccup. Can you say that again?"),
      prompts: { kind: 'say-and-listen' },
    }
  }

  // --- Step 2: Classify intent ---
  let intentResult: Awaited<ReturnType<typeof classifyIntent>>
  try {
    intentResult = await classifyIntent(
      { stage: conversation.stage as Stage },
      customerText,
    )
  } catch (err) {
    console.error('[voice-adapter] classifyIntent failed', err)
    intentResult = { intent: 'OFF_TOPIC', confidence: 0.0, source: 'fallback' }
  }

  // Re-run getOrCreateConversation with intent for the 6h stage TTL check.
  try {
    conversation = await getOrCreateConversation(callerPhone, intentResult.intent)
  } catch {
    // Non-fatal — use the conversation from step 1.
  }

  // --- Step 3: v2 stage dispatch ---
  const effectiveStage = pickEffectiveStage(conversation.stage as Stage, intentResult)
  const stageLabel = conversation.stage as string

  let stageResp: StageResponse | null = null
  let voiceReply: VoiceReply

  try {
    const ctx = await buildEmmaContext(conversation)
    const stageRespPromise = dispatchStage(effectiveStage, ctx, intentResult, customerText)

    if (stageRespPromise !== null) {
      stageResp = await stageRespPromise

      // Persist state writes.
      const writes = stageResp.stateWrites
      await applyStateWrites(callerPhone, {
        stage: writes.stage ?? stageResp.stageOut,
        ...(writes.currentPitchHandle  !== undefined && { currentPitchHandle:  writes.currentPitchHandle }),
        ...(writes.currentUpsellHandle !== undefined && { currentUpsellHandle: writes.currentUpsellHandle }),
        ...(writes.lastQuoteUrl        !== undefined && { lastQuoteUrl:        writes.lastQuoteUrl }),
        ...(writes.lastQuoteItems      !== undefined && { lastQuoteItems:      writes.lastQuoteItems }),
        ...(writes.lastQuoteCreatedAt  !== undefined && { lastQuoteCreatedAt:  writes.lastQuoteCreatedAt }),
        ...(writes.customerGid         !== undefined && { customerGid:         writes.customerGid }),
      })

      voiceReply = await stageResponseToVoiceReply(stageResp, callerPhone)
    } else {
      // No v2 handler for this stage — return a safe holding reply.
      // In a full-v2 deployment this shouldn't happen, but guard for
      // GREETING / CONSENT_GATE / RECONNECT which have no handler yet.
      voiceReply = {
        ssml: wrapSsml("I'm here. What can I help you find today?"),
        prompts: { kind: 'say-and-listen' },
      }
    }
  } catch (err) {
    console.error('[voice-adapter] stage dispatch or reply build failed', err)
    voiceReply = {
      ssml: wrapSsml("Sorry, I lost my train of thought. Can you say that again?"),
      prompts: { kind: 'say-and-listen' },
    }
  }

  // --- Step 4: Log the turn ---
  const latencyMs = Date.now() - started
  await logVoiceTurn({
    callerPhone,
    conversationId: conversation.conversationId,
    callSid,
    customerText,
    ssml: voiceReply.ssml,
    stageIn: stageLabel,
    stageOut: stageResp?.stageOut ?? stageLabel,
    intent: intentResult.intent,
    intentConfidence: intentResult.confidence,
    ...(stageResp?.telemetry.inputTokens !== undefined && { inputTokens: stageResp.telemetry.inputTokens }),
    ...(stageResp?.telemetry.outputTokens !== undefined && { outputTokens: stageResp.telemetry.outputTokens }),
    latencyMs,
  })

  return voiceReply
}
