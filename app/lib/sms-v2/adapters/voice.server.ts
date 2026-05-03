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
import { buildEmmaContextWithCrossChannel } from '../cross-channel.server'
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
 * Strip URLs from prose before TTS.
 *
 * Stage prose is shared across SMS / web / voice. SMS and web include the URL
 * inline (the customer can tap it); voice cannot — the URL gets read aloud
 * character-by-character which is awful UX. We remove URLs and any
 * "URL: " prefix, plus collapse leftover whitespace.
 *
 * Example: "Take a peek: https://xdipx.com/products/x — it's $129"
 *   →     "Take a peek, it's $129"
 */
function stripUrlsForVoice(prose: string): string {
  return prose
    // Drop "<word>: <url>" patterns where the URL follows a colon.
    .replace(/[:\-—]\s*https?:\/\/\S+/gi, ',')
    // Drop bare URLs.
    .replace(/https?:\/\/\S+/gi, '')
    // Drop www-only links some templates produce.
    .replace(/\bwww\.\S+/gi, '')
    // Collapse runs of whitespace and clean up dangling punctuation.
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*$/g, '')
    .trim()
}

/**
 * Convert a prose string to SSML inner content.
 * Paragraph breaks (double newline) become <break time="500ms"/>.
 * Single newlines become a space (sentence continuation).
 * URLs are stripped — voice can't speak them usefully.
 */
function proseToSsmlContent(prose: string): string {
  return prose
    .split(/\n\n+/)
    .map((para) => ssmlEscape(stripUrlsForVoice(para.replace(/\n/g, ' ').trim())))
    .filter(Boolean)
    .join(' <break time="500ms"/> ')
}

// ---------------------------------------------------------------------------
// Permission-gate intent detection
// ---------------------------------------------------------------------------

const AFFIRMATIVE_RE =
  /\b(yes|yeah|yep|yup|sure|please|ok(?:ay)?|sounds good|do it|send (?:it|me|that)|text (?:it|me|that)|absolutely|of course)\b/i

const NEGATIVE_RE =
  /\b(no|nope|nah|don'?t|skip|never mind|not (?:now|right now|today)|maybe later)\b/i

function isAffirmative(text: string): boolean {
  const t = text.trim()
  return AFFIRMATIVE_RE.test(t) && !NEGATIVE_RE.test(t)
}

function isNegative(text: string): boolean {
  return NEGATIVE_RE.test(text.trim())
}

// ---------------------------------------------------------------------------
// Cross-channel hint — Emma reminds the caller they can keep going via SMS.
// ---------------------------------------------------------------------------

const CONTINUE_VIA_TEXT = "Or text me back at this number anytime to keep going."

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

interface VoiceReplyBuildResult {
  reply: VoiceReply
  /**
   * URL to write to conversation.pendingPdpUrl after this turn (caller agreed
   * to receive the link on the NEXT turn). null = clear any prior pending URL.
   * undefined = leave pendingPdpUrl unchanged.
   */
  pendingPdpUrlWrite?: string | null
}

async function stageResponseToVoiceReply(
  stageResp: StageResponse,
  _callerPhone: string,
): Promise<VoiceReplyBuildResult> {
  const ssmlParts: string[] = []
  let outboundSms: VoiceReply['outboundSms'] = undefined
  let hangup = false
  let pendingPdpUrlWrite: string | null | undefined = undefined

  for (const seg of stageResp.segments) {
    // 1. Prose — convert to SSML (URLs stripped inside proseToSsmlContent)
    if (seg.prose.trim()) {
      ssmlParts.push(proseToSsmlContent(seg.prose))
    }

    // 2. Product card — IVR can't show images; speak title + price, ASK
    //    permission before texting the pdpUrl. Save pdpUrl as pending; the
    //    next turn picks it up if the caller affirms.
    if (seg.productCard) {
      const card = seg.productCard
      const spoken = card.price
        ? `${ssmlEscape(card.title)}, ${ssmlEscape(card.price)}`
        : ssmlEscape(card.title)
      ssmlParts.push(spoken)
      if (card.pdpUrl) {
        pendingPdpUrlWrite = card.pdpUrl
        ssmlParts.push("Want me to text you the link?")
      }
    }

    // 3. CTA
    if (seg.cta) {
      if (seg.cta.kind === 'checkout') {
        // Checkout URL — caller already committed at this stage, so we send
        // immediately (no permission gate). Clear any pending pdp link since
        // we're past PDP-share territory.
        outboundSms = { body: seg.cta.url }
        pendingPdpUrlWrite = null
        hangup = false // stay on call after sending link (caller confirms receipt)
        ssmlParts.push(
          `I just texted you a secure checkout link. Check your messages. ${CONTINUE_VIA_TEXT}`,
        )
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

  // On any wrap-up that hangs up, remind the caller they can keep going via SMS.
  if (hangup) {
    ssmlParts.push(CONTINUE_VIA_TEXT)
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

  const reply: VoiceReply = {
    ssml,
    prompts: promptKind,
    ...(outboundSms !== undefined && { outboundSms }),
    ...(hangup && { hangup }),
  }
  return pendingPdpUrlWrite !== undefined
    ? { reply, pendingPdpUrlWrite }
    : { reply }
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

  // --- Step 2.5: Pending PDP link permission gate ---
  // If a previous turn left a pdpUrl pending the caller's permission, this
  // turn is the answer. We handle the link delivery here and short-circuit
  // before the stage handler runs — the caller's "yes" / "no" was about the
  // link, not the stage transition.
  if (conversation.pendingPdpUrl) {
    const pendingUrl = conversation.pendingPdpUrl
    if (isAffirmative(customerText)) {
      try {
        await sendSms(callerPhone, `Here's the link: ${pendingUrl}`)
      } catch (err) {
        console.warn(`[voice-adapter] outbound SMS for pending pdpUrl failed callerPhone=${callerPhone}`, err)
      }
      try {
        await applyStateWrites(callerPhone, { pendingPdpUrl: null })
      } catch {
        // Non-fatal — pending URL clears next turn at worst.
      }
      const latencyMs = Date.now() - started
      await logVoiceTurn({
        callerPhone,
        conversationId: conversation.conversationId,
        callSid,
        customerText,
        ssml: wrapSsml(`Just texted it. Want me to find anything else? ${CONTINUE_VIA_TEXT}`),
        stageIn: conversation.stage as string,
        stageOut: conversation.stage as string,
        intent: intentResult.intent,
        intentConfidence: intentResult.confidence,
        latencyMs,
      })
      return {
        ssml: wrapSsml(`Just texted it. Want me to find anything else? ${CONTINUE_VIA_TEXT}`),
        prompts: { kind: 'say-and-listen' },
      }
    }
    if (isNegative(customerText)) {
      try {
        await applyStateWrites(callerPhone, { pendingPdpUrl: null })
      } catch {
        // Non-fatal.
      }
      // Fall through to normal dispatch — caller said "no" to the link but
      // may want to keep talking about the product or pivot.
    }
    // Ambiguous response (neither yes nor no): leave pending URL set, fall
    // through to normal dispatch. Stage handler reply will likely re-engage
    // the caller; if they answer the link question on the next turn we'll
    // catch it.
  }

  // --- Step 3: v2 stage dispatch ---
  const effectiveStage = pickEffectiveStage(conversation.stage as Stage, intentResult)
  const stageLabel = conversation.stage as string

  let stageResp: StageResponse | null = null
  let voiceReply: VoiceReply

  try {
    const ctx = await buildEmmaContextWithCrossChannel(conversation, 'voice')
    const stageRespPromise = dispatchStage(effectiveStage, ctx, intentResult, customerText)

    if (stageRespPromise !== null) {
      stageResp = await stageRespPromise

      // Persist state writes from the stage handler.
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

      const built = await stageResponseToVoiceReply(stageResp, callerPhone)
      voiceReply = built.reply

      // Voice-adapter-only state: pending pdp link awaiting permission.
      // The stage handler doesn't know about this; the adapter sets it when
      // the segment carries a productCard with a pdpUrl.
      if (built.pendingPdpUrlWrite !== undefined) {
        try {
          await applyStateWrites(callerPhone, { pendingPdpUrl: built.pendingPdpUrlWrite })
        } catch (err) {
          console.warn('[voice-adapter] applyStateWrites pendingPdpUrl failed', err)
        }
      }
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
