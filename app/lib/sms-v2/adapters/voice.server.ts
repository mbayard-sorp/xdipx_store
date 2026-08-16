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
import { normalizeForTTS } from '~/lib/tts-normalize'
import { db } from '~/lib/db.server'
import { and, desc, eq, like, not } from 'drizzle-orm'
import { smsConversations, smsTurns } from '../../../../db/schema'
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
export function stripUrlsForVoice(prose: string): string {
  return prose
    // conv-audit C7: drop whole Markdown links that point at a product page,
    // label and target together. A spoken link is useless, and the multi-result
    // list (stages/discovery.server.ts buildMultiResultProse) puts a
    // "[Take a peek →](…/products/<handle>)" line under every item — without
    // this the label repeats once per result on a call. Covers absolute
    // https://xdipx.com/products/… and relative /products/… targets. Scoped to
    // /products so a non-product link's label text still gets spoken.
    .replace(/\[[^\]]*\]\((?:https?:\/\/[^)\s]*)?\/products\/[^)\s]*\)/gi, '')
    // Drop "<word>: <url>" patterns where the URL follows a colon.
    .replace(/[:\-—]\s*https?:\/\/\S+/gi, ',')
    // Drop bare URLs.
    .replace(/https?:\/\/\S+/gi, '')
    // conv-audit C7: bare relative product paths (no scheme) that the http
    // rules above miss, e.g. a stage emitting "/products/<handle>" as text.
    // These were being read aloud character-by-character before.
    .replace(/\/products\/[a-z0-9][a-z0-9-]*/gi, '')
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
    .map((para) => {
      const flattened = para.replace(/\n/g, ' ').trim()
      // Order matters: strip URLs first (they can contain digits and dots that
      // the price rewriter would otherwise mangle), spell prices next, then run
      // the shared TTS normalizer, which the v2 voice path was skipping
      // entirely — markdown, em-dashes, smart quotes and emoji from the model
      // were reaching ElevenLabs verbatim.
      return ssmlEscape(normalizeForTTS(spellPricesForVoice(stripUrlsForVoice(flattened))))
    })
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

// Words that mean the caller is asking for a commerce ACTION (add to the
// order, build the cart, take both), not merely permitting a link. "Yes. Add
// it." used to be swallowed by the pending-link gate below and answered with
// "Just texted it" — a PDP link instead of the cart the caller agreed to, and
// the upsell revenue silently dropped. These utterances belong to the stage
// machine, which knows how to mint the cart.
const COMMERCE_ACTION_RE = /\b(add|cart|bag|buy|both|order|check\s?out)\b/i

/**
 * What to do with the caller's utterance while a PDP link is pending their
 * permission. 'send' = a bare yes, text the link. 'decline' = clear it and let
 * the stage handler hear the no. 'pass' = the utterance carries its own
 * meaning (an add-to-cart, a new request); the stage machine owns it.
 */
export function pendingLinkDecision(text: string): 'send' | 'decline' | 'pass' {
  const t = text.trim()
  if (COMMERCE_ACTION_RE.test(t)) return 'pass'
  if (isAffirmative(t)) return 'send'
  if (isNegative(t)) return 'decline'
  return 'pass'
}

/**
 * True when the prose already ends by asking the caller something. Appending
 * "Want me to text you the link?" after "Want me to add it?" gave the caller
 * two different questions in one breath — the owner-reported "do you want me
 * to add to your cart. Just texted it to you" confusion. One turn, one
 * question.
 */
export function proseEndsWithQuestion(prose: string): boolean {
  return /\?\s*$/.test(prose.trim())
}

// ---------------------------------------------------------------------------
// Per-call session freshness
// ---------------------------------------------------------------------------
//
// sms_conversations rotates session-scoped shopping state on a 24h gap. That
// boundary is right for SMS, where a thread genuinely is one long conversation,
// and wrong for voice, where each call is a discrete session that ends when the
// caller hangs up.
//
// Call CAc0f0860abd080f9dd0ec3b39a3cd7585 opened 21.5h after the previous call
// — inside the 24h window, so nothing rotated. The caller said "I'm looking for
// a vibrator for my wife and I" and Emma answered from the PREVIOUS call's
// abandoned PRESENTATION stage: she pitched the We-Vibe Chorus Pro instantly,
// with no search and no discovery, because currentPitchHandle was still set
// from a call that had ended in a hangup a day earlier.
//
// A new callSid with no recent activity starts a fresh shopping slate. The
// window stays generous enough to preserve a real cross-channel handoff (text
// Emma, then call her a few minutes later to keep going).
const SESSION_FRESH_MS = Number(process.env['IVR_SESSION_FRESH_MS'] ?? 2 * 60 * 60 * 1000)

/**
 * Milliseconds since the conversation was last active, from a timestamp
 * captured BEFORE getOrCreateConversation ran. Null (no prior row, or an
 * unreadable one) means "infinitely stale" so a brand-new caller takes the
 * clean-slate path rather than inheriting whatever happens to be in the row.
 *
 * Pure so the staleness rule is testable without a database.
 */
export function voiceSessionStaleMs(
  priorLastActiveAt: Date | null,
  now: number,
): number {
  if (!priorLastActiveAt) return Infinity
  const then = new Date(priorLastActiveAt).getTime()
  if (!Number.isFinite(then)) return Infinity
  // Clamp negatives: clock skew between the DB and the runtime must never make
  // a stale session look fresh.
  return Math.max(0, now - then)
}

/**
 * Reads lastActiveAt without mutating it. Must be called before
 * getOrCreateConversation, which overwrites the column on every turn.
 */
async function readLastActiveAt(phone: string): Promise<Date | null> {
  try {
    const rows = await db
      .select({ lastActiveAt: smsConversations.lastActiveAt })
      .from(smsConversations)
      .where(eq(smsConversations.phone, phone))
      .limit(1)
    return rows[0]?.lastActiveAt ?? null
  } catch (err) {
    console.warn('[voice-adapter] readLastActiveAt failed — treating session as stale', err)
    return null
  }
}

/**
 * True when this is the first turn we've logged for `callSid`. logVoiceTurn
 * writes twilioMessageSid as `call:{callSid}:{timestamp}`, so the prefix scopes
 * a lookup to one call without a schema change.
 */
async function isFirstTurnOfCall(callSid: string): Promise<boolean> {
  if (!callSid) return false
  const rows = await db
    .select({ id: smsTurns.id })
    .from(smsTurns)
    .where(like(smsTurns.twilioMessageSid, `call:${callSid}:%`))
    .limit(1)
  return rows.length === 0
}

/**
 * Channel of this phone's most recent turn that did NOT belong to `callSid`.
 * Null when there is no prior turn at all.
 *
 * Ticket #3221. SESSION_FRESH_MS exists to protect a real cross-channel
 * handoff: text Emma, then call a few minutes later and keep going. It does
 * that by keeping state for anything inside the window. The cost is that it
 * also keeps state across two *voice* calls, and a hangup-then-redial is
 * always inside the window.
 *
 * On 2026-08-14 a caller hung up mid-upsell and called back 12 seconds later.
 * The second call opened at stage UPSELL with the dead call's pitch handles
 * intact and re-pitched the identical lube. He hung up again after 37s.
 *
 * A phone call is a discrete session that ends when the caller hangs up; an
 * SMS thread is one long conversation. So the reset decision keys off what the
 * prior activity actually WAS, not how long ago it was.
 */
export function shouldResetVoiceSession(input: {
  isNewCall: boolean
  priorChannel: string | null
  staleMs: number
  freshMs: number
}): boolean {
  if (!input.isNewCall) return false
  // A prior VOICE turn means the last session was a call, and calls end when
  // the caller hangs up. Reset regardless of how recent it was.
  if (input.priorChannel === 'voice') return true
  // Anything else (SMS, web, or no history) keeps the elapsed-time window so a
  // text-then-call handoff still carries context.
  return input.staleMs > input.freshMs
}

async function priorActivityChannel(phone: string, callSid: string): Promise<string | null> {
  if (!phone) return null
  const rows = await db
    .select({ channel: smsTurns.channel })
    .from(smsTurns)
    .where(
      callSid
        ? and(
            eq(smsTurns.phone, phone),
            not(like(smsTurns.twilioMessageSid, `call:${callSid}:%`)),
          )
        : eq(smsTurns.phone, phone),
    )
    .orderBy(desc(smsTurns.createdAt))
    .limit(1)
  return rows[0]?.channel ?? null
}

// ---------------------------------------------------------------------------
// Redundant-readback suppression
// ---------------------------------------------------------------------------
//
// The stage handlers hand us prose AND a structured productCard. On SMS both
// are useful: the prose sells, the card renders as a link preview. On a phone
// call they collapse into one stream of speech, and the adapter used to append
// the card readback and the permission question unconditionally. When the
// model's prose had already named the product, said the price and asked about
// the link — which is the normal case — the caller heard all three twice:
//
//   "...I'd start with the Luster Anal Plug Set 3 Piece Beginner Kit at thirty
//    nine ninety nine. Three graduated sizes... Want me to text you that link
//    too?  <break/>  Luster Anal Plug Set 3 Piece Beginner Kit, thirty-nine
//    ninety-nine  <break/>  Want me to text you the link?"
//
// That is call CAc0f0860abd080f9dd0ec3b39a3cd7585, the last turn the caller
// heard before hanging up. The readback is a fallback for when the prose did
// NOT name the product, not a guaranteed suffix.

/** Words that carry no identifying signal when matching a title against prose. */
const TITLE_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'of', 'in', 'on', 'set', 'kit',
  'piece', 'pack', 'pc', 'inch', 'size', 'black', 'pink', 'purple', 'blue', 'red',
  'satin', 'silicone', 'couples', 'couple', 'vibrator', 'plug', 'toy', 'beginner',
])

function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !TITLE_STOPWORDS.has(w))
}

/**
 * True when the prose already identifies this product well enough that reading
 * the full catalog title again is noise. Matches on the title's distinctive
 * tokens (brand + model), not an exact string compare — the model paraphrases
 * ("the We Vibe Chorus Pro" for "Satin Black We Vibe Chorus Pro Couples
 * Vibrator") and an exact compare would never fire.
 */
export function proseNamesProduct(prose: string, title: string): boolean {
  const tokens = titleTokens(title)
  if (!tokens.length) return false
  const haystack = prose.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
  const hits = tokens.filter((t) => new RegExp(`\\b${t}\\b`).test(haystack)).length
  // 0.5, not 0.6: catalog titles carry trailing feature qualifiers ("with
  // Touch Control", "Rechargeable") that a well-written pitch correctly omits,
  // and those qualifiers survive the stopword filter and inflate the
  // denominator. "We Vibe Chorus Adjustable Couples Vibrator" vs the title
  // "Chorus Adjustable Couples Vibrator with Touch Control" scored 2/4 and
  // the caller heard the full title read back at them, twice, with two
  // different prices.
  return hits / tokens.length >= 0.5
}

/** True when the prose already asked permission to text the link. */
export function proseAsksToText(prose: string): boolean {
  return /\b(text|send)\b[^.?!]{0,40}\b(link|it|that|you)\b[^.?!]{0,40}\?|\bwant me to (text|send)\b/i.test(
    prose,
  )
}

// ---------------------------------------------------------------------------
// Cross-channel hint — Emma reminds the caller they can keep going via SMS.
// ---------------------------------------------------------------------------

const CONTINUE_VIA_TEXT = "Or text me back at this number anytime to keep going."

// ---------------------------------------------------------------------------
// Latency warning threshold
// ---------------------------------------------------------------------------

/**
 * Above this, the turn is at risk of exceeding the Fly bridge's hard timeout
 * (IVR_V2_TIMEOUT_MS, default 12s) and being discarded on the caller's end.
 * Kept slightly under the bridge timeout so the warning fires before the cliff.
 */
const VOICE_LATENCY_WARN_MS = Number(process.env['VOICE_LATENCY_WARN_MS'] ?? 9_000)

// ---------------------------------------------------------------------------
// Price → spoken words
// ---------------------------------------------------------------------------

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** Spell an integer 0-999 as words. */
function intToWords(n: number): string {
  if (n < 20) return ONES[n]!
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)]!
    const r = n % 10
    return r === 0 ? t : `${t}-${ONES[r]!}`
  }
  const h = `${ONES[Math.floor(n / 100)]!} hundred`
  const r = n % 100
  return r === 0 ? h : `${h} ${intToWords(r)}`
}

/**
 * Speak a dollar amount the way a person would.
 *
 *   $155.99 → "one hundred fifty-five ninety-nine"
 *   $24.00  → "twenty-four dollars"
 *
 * ElevenLabs reads "$155.99" as digits and a literal decimal point, which is
 * how a caller ended up hearing a product pitch that sounded like a catalog
 * being read at them. The IVR system prompt has always required prices as
 * words; the v2 voice path just never enforced it on the product-card line or
 * on prices the model wrote into its prose.
 */
export function priceToSpokenWords(raw: string | number): string {
  const amount = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(amount) || amount < 0 || amount >= 1000) return String(raw)
  const dollars = Math.floor(amount)
  const cents = Math.round((amount - dollars) * 100)
  if (cents === 0) return `${intToWords(dollars)} dollars`
  const centWords = cents < 10 ? `oh ${ONES[cents]!}` : intToWords(cents)
  return `${intToWords(dollars)} ${centWords}`
}

/** Rewrite every "$NN.NN" / "$NN" occurrence in prose as spoken words. */
function spellPricesForVoice(text: string): string {
  return text.replace(/\$\s?(\d{1,3}(?:\.\d{1,2})?)\b/g, (_m, num: string) =>
    priceToSpokenWords(num),
  )
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
    const prose = seg.prose.trim()

    // 1. Prose — convert to SSML (URLs stripped inside proseToSsmlContent)
    if (prose) {
      ssmlParts.push(proseToSsmlContent(prose))
    }

    // 2. Product card — IVR can't show images, so the title + price are spoken
    //    as a FALLBACK for prose that didn't already name them, and we ASK
    //    permission before texting the pdpUrl. Save pdpUrl as pending; the
    //    next turn picks it up if the caller affirms.
    if (seg.productCard) {
      const card = seg.productCard
      // card.price arrives formatted as "$155.99". Spoken as digits it sounds
      // like a price tag being read out; spelled as words it sounds like Emma.
      if (!prose || !proseNamesProduct(prose, card.title)) {
        const spoken = card.price
          ? `${ssmlEscape(normalizeForTTS(card.title))}, ${ssmlEscape(priceToSpokenWords(card.price))}`
          : ssmlEscape(normalizeForTTS(card.title))
        ssmlParts.push(spoken)
      }
      if (card.pdpUrl) {
        const askedInProse = prose ? proseAsksToText(prose) : false
        // One turn, one question: only append the link ask when the prose
        // didn't already ask it AND didn't end on a different question (the
        // upsell closers all end "Want me to add it?" — stacking the link ask
        // after that gave the caller two questions in one breath).
        const appendAsk = !prose || (!askedInProse && !proseEndsWithQuestion(prose))
        if (appendAsk) {
          ssmlParts.push("Want me to text you the link?")
        }
        // Pending is set only when the link question was actually the thing
        // asked this turn. When the turn ended on a DIFFERENT question, a
        // later bare "yes" is answering that question, not this URL — so
        // clear any stale pending instead of arming a hijack.
        pendingPdpUrlWrite = askedInProse || appendAsk ? card.pdpUrl : null
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
  /**
   * Stage telemetry. Voice used to drop all of this on the floor — 177 logged
   * voice turns carried zero tool_calls, zero errors and zero metadata, while
   * SMS logged tool calls on half its turns. When a caller reported a search
   * that went nowhere there was no record of what was searched, so make voice
   * log the same columns SMS does.
   */
  telemetry?: StageResponse['telemetry'] | undefined
  /**
   * Turn-level failures that happen outside a stage handler, so they have no
   * StageResponse telemetry to ride along on (e.g. the pending-PDP link SMS
   * failing to send). Written to sms_turns.errors.
   */
  errors?: unknown[] | undefined
}): Promise<void> {
  const t = opts.telemetry
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
      ...(t?.toolCalls !== undefined && { toolCalls: t.toolCalls }),
      ...(t?.fabricationCaught !== undefined && { fabricationCaught: t.fabricationCaught }),
      ...(t?.softBeat !== undefined && { softBeat: t.softBeat }),
      ...(t?.toolBudgetExhausted !== undefined && { toolBudgetExhausted: t.toolBudgetExhausted }),
      ...(t?.searchRepeatedPitch !== undefined && { searchRepeatedPitch: t.searchRepeatedPitch }),
      ...(t?.gateAdvance !== undefined && { metadata: { gateAdvance: t.gateAdvance } }),
      ...(opts.errors?.length ? { errors: opts.errors } : {}),
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

  // --- Step 0: Capture prior activity BEFORE anything touches the row ---
  // getOrCreateConversation unconditionally writes lastActiveAt = now and then
  // re-reads, so the row it returns ALWAYS reports ~0ms since last activity.
  // Reading staleness off that return value made the Step 1.5 gate below dead
  // code: it shipped, deployed, and never once fired. Call
  // CA419b2272eadb822ccd2785445c31b8ee opened 23h after the previous call and
  // still entered at stage=PRESENTATION, answering "oh" with "Want me to send
  // that link over?" — the previous call's pending link. Capture first, ask later.
  const priorLastActiveAt = await readLastActiveAt(callerPhone)

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

  // --- Step 1.5: New call → fresh shopping slate ---
  // Identity (customerGid, name, zip) and conversationSummary are deliberately
  // left alone: those describe the person, not this shopping trip.
  try {
    const staleMs = voiceSessionStaleMs(priorLastActiveAt, Date.now())
    // Ticket #3221: a NEW call always starts a fresh shopping slate when the
    // last thing this number did was another call, however recently. The
    // elapsed-time window still governs a genuine SMS-then-call handoff.
    const isNewCall = await isFirstTurnOfCall(callSid)
    const priorChannel = isNewCall ? await priorActivityChannel(callerPhone, callSid) : null
    const priorWasVoice = priorChannel === 'voice'
    if (
      shouldResetVoiceSession({
        isNewCall,
        priorChannel,
        staleMs,
        freshMs: SESSION_FRESH_MS,
      })
    ) {
      await applyStateWrites(callerPhone, {
        stage: 'RECONNECT',
        discoveredSlots: {},
        discoveryState: null,
        pitchedHandlesLog: null,
        currentPitchHandle: null,
        currentUpsellHandle: null,
        pendingPdpUrl: null,
      })
      conversation = await getOrCreateConversation(callerPhone)
      console.info(
        `[voice-adapter] new call → session state cleared callSid=${callSid} staleMs=${staleMs} priorWasVoice=${priorWasVoice}`,
      )
    }
  } catch (err) {
    // Non-fatal — a stale slate is worse than this failing, but not fatal.
    console.warn('[voice-adapter] new-call session reset failed', err)
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
    const decision = pendingLinkDecision(customerText)
    if (decision === 'send') {
      // "Just texted it" used to be spoken unconditionally: sendSms threw into
      // a catch that only console.warn'd, and Emma told the caller the link was
      // on its way regardless. A failed send left them staring at a phone that
      // never buzzed, with nothing on the call to say so. Only claim the send
      // that actually happened.
      let sent = true
      try {
        await sendSms(callerPhone, `Here's the link: ${pendingUrl}`)
      } catch (err) {
        sent = false
        console.warn(`[voice-adapter] outbound SMS for pending pdpUrl failed callerPhone=${callerPhone}`, err)
      }
      if (sent) {
        try {
          await applyStateWrites(callerPhone, { pendingPdpUrl: null })
        } catch {
          // Non-fatal — pending URL clears next turn at worst.
        }
      }
      // On failure the pending URL is deliberately LEFT set, so another "yes"
      // retries the send instead of resolving to nothing.
      const ssml = wrapSsml(
        sent
          ? `Just texted it. Want me to find anything else? ${CONTINUE_VIA_TEXT}`
          : `That text didn't want to go through just now. Say the word and I'll try again, or I can keep looking with you.`,
      )
      const latencyMs = Date.now() - started
      await logVoiceTurn({
        callerPhone,
        conversationId: conversation.conversationId,
        callSid,
        customerText,
        ssml,
        stageIn: conversation.stage as string,
        stageOut: conversation.stage as string,
        intent: intentResult.intent,
        intentConfidence: intentResult.confidence,
        latencyMs,
        ...(sent ? {} : { errors: ['pending_pdp_sms_send_failed'] }),
      })
      return {
        ssml,
        prompts: { kind: 'say-and-listen' },
      }
    }
    // 'decline': the caller said no to the link; clear it and let the stage
    // handler hear the no (it may be a product decline too).
    // 'pass': the utterance carries its own meaning — "Yes. Add it.", "text me
    // the link to both", or a brand-new request. The stage machine owns it
    // (UPSELL_ACCEPT mints the real cart and texts a checkout link), and the
    // pending URL is cleared because the link-permission moment has passed; a
    // stale pending was hijacking the NEXT turn's unrelated "yes" as well.
    try {
      await applyStateWrites(callerPhone, { pendingPdpUrl: null })
    } catch {
      // Non-fatal.
    }
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

      // Persist state writes from the stage handler. Without this, the
      // discovery gate machine resets to MOOD on every turn because
      // discoveryState and discoveredSlots never make it back to the row —
      // Emma rotates through opener questions with no memory of prior
      // answers (caught during Stage D testing).
      const writes = stageResp.stateWrites
      await applyStateWrites(callerPhone, {
        stage: writes.stage ?? stageResp.stageOut,
        ...(writes.currentPitchHandle  !== undefined && { currentPitchHandle:  writes.currentPitchHandle }),
        ...(writes.currentUpsellHandle !== undefined && { currentUpsellHandle: writes.currentUpsellHandle }),
        ...(writes.lastQuoteUrl        !== undefined && { lastQuoteUrl:        writes.lastQuoteUrl }),
        ...(writes.lastQuoteItems      !== undefined && { lastQuoteItems:      writes.lastQuoteItems }),
        ...(writes.lastQuoteCreatedAt  !== undefined && { lastQuoteCreatedAt:  writes.lastQuoteCreatedAt }),
        ...(writes.customerGid         !== undefined && { customerGid:         writes.customerGid }),
        ...(writes.discoveryState      !== undefined && { discoveryState:      writes.discoveryState }),
        ...(writes.discoveredSlots     !== undefined && { discoveredSlots:     writes.discoveredSlots }),
        // These two were silently dropped on the voice path. pitchedHandlesLog
        // is what the search tool's dedup reads, so without persisting it Emma
        // could re-pitch the same product every turn of a call; the summary is
        // the agent's memory bridge across the history window.
        ...(writes.pitchedHandlesLog   !== undefined && { pitchedHandlesLog:   writes.pitchedHandlesLog }),
        ...(writes.conversationSummary !== undefined && { conversationSummary: writes.conversationSummary }),
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
    ...(stageResp?.telemetry !== undefined && { telemetry: stageResp.telemetry }),
  })

  // The Fly bridge gives up on a turn after IVR_V2_TIMEOUT_MS. When we blow
  // past that the caller never hears this reply, yet the state writes above
  // have already landed — so the conversation advances a stage the caller
  // doesn't know about. Log it loudly; it is the single most useful signal for
  // "the call went sideways and nobody knows why".
  if (latencyMs > VOICE_LATENCY_WARN_MS) {
    console.warn(
      `[voice-adapter] slow turn callSid=${callSid} latencyMs=${latencyMs} stage=${stageLabel}->${stageResp?.stageOut ?? stageLabel} — may have exceeded the Fly bridge timeout; caller may not have heard this reply`,
    )
  }

  return voiceReply
}
