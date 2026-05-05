/**
 * app/lib/sms-v2/conversation-agent.server.ts
 *
 * Phase 6 — unified Sonnet-driven conversation agent.
 *
 * Replaces the deterministic PRESENTATION + OBJECTION stage handlers AND
 * subsumes the existing DISCOVERY agent. Stage is treated as a HINT — the
 * customer can pivot mid-pitch (variants, alternatives, new categories) and
 * the agent uses its tool surface to roam without re-pitching the same product.
 *
 * Flow per turn:
 *   1. Build a stage+channel-aware system prompt
 *      (BRAND_VOICE + CONVERSATION_RULES_CORE + stage addendum + channel addendum).
 *   2. Load up to 12 history pairs from sms_turns so the agent sees context
 *      and can acknowledge pivots / variants / earlier mentions.
 *   3. Run a Sonnet messages.create loop — up to 3 tool hops.
 *   4. Strip any URL the agent invented (PDP not in this turn's tool results,
 *      or any cart/checkout URL — these stages NEVER build checkouts).
 *   5. Detect whether the agent pitched a specific product. If yes, attach a
 *      productCard segment and advance/stay-on PRESENTATION. Otherwise stay
 *      on the input stage.
 *   6. On any error, return a safe fallback so the call doesn't crash.
 *
 * Tool surface: searchProducts, lookupReturningCustomer, getCategoryExplainer,
 * getProductDetails (variant info for "what colors?" / "what sizes?" etc.).
 *
 * Stage transition logic:
 *   - DISCOVERY input + new pitch          → PRESENTATION (currentPitchHandle = new)
 *   - DISCOVERY input + no pitch           → DISCOVERY
 *   - PRESENTATION input + new pitch       → PRESENTATION (currentPitchHandle = new)
 *   - PRESENTATION input + same pitch / no → PRESENTATION
 *   - OBJECTION input + new pitch          → PRESENTATION (pivot worked)
 *   - OBJECTION input + no pitch           → OBJECTION
 *
 * Commit signals (COMMIT_PICK intent) are routed by the dispatcher's
 * pickEffectiveStage table, not by this agent — by the time this code runs,
 * commits have already been routed away to UPSELL/CHECKOUT.
 */
import Anthropic from '@anthropic-ai/sdk'
import { loadConversationHistory, type HistoryTurn } from './conversation-history.server'
import {
  DISCOVERY_AGENT_TOOLS,
  runDiscoveryTool,
  type DiscoveryAgentToolContext,
} from './discovery-agent-tools.server'
import { extractSlots, type DiscoverySlots } from './slot-extractor.server'
import { resolveTransition } from './transitions.server'
import { BRAND_VOICE } from '~/lib/ai-agent/prompt'
// generateConversationSummary and applyStateWrites are no longer called from
// this file — ADR-003 Sub-decision B moved the summarizer to the processor layer
// so it fires on ALL dispatch paths, not just executeConversationAgent.
import type { IvrProductCard } from '~/lib/ivr-search.server'
import type {
  ConversationStateWrites,
  EmmaContext,
  IntentResult,
  ProductRef,
  StageResponse,
} from './types.server'

// ─── Public types ────────────────────────────────────────────────────────────

export type ConversationStage = 'DISCOVERY' | 'PRESENTATION' | 'OBJECTION' | 'POST_CHECKOUT'

export interface ConversationAgentInput {
  ctx: EmmaContext
  intent: IntentResult
  customerText: string
  stage: ConversationStage
}

// ─── Module-scope client ─────────────────────────────────────────────────────

let _client = new Anthropic({ apiKey: (process.env['ANTHROPIC_API_KEY'] ?? '').trim() })

/**
 * Swap out the Anthropic client in tests to prevent real API calls.
 * Task 0.4 (gotcha #7 from feasibility doc): mirrors slot-extractor.server.ts:56-58.
 * Required for the eval harness so fixtures can exercise the agent without
 * burning real tokens.
 */
export function _setConversationAgentClient(c: Anthropic): void {
  _client = c
}

// Sonnet 4.6 — same model SMS Sonnet uses elsewhere. Keep in sync.
const SONNET_MODEL = 'claude-sonnet-4-6'

const MAX_TOOL_HOPS = 3
const HISTORY_LIMIT = 12

// max_tokens tuned per channel:
//   - sms/voice: 480 — about 1900 chars of generation room before clamp.
//   - web:      700 — chat widget can render a few short paragraphs.
const MAX_TOKENS_SMS_VOICE = 480
const MAX_TOKENS_WEB = 700

// ─── Core conversational rules ───────────────────────────────────────────────

/**
 * Hard rules that apply across DISCOVERY / PRESENTATION / OBJECTION. The
 * stage addendum below adds the stage-specific shape on top of these.
 */
const CONVERSATION_RULES_CORE = `EMMA — xdipx editorial concierge. You're talking with one customer at a time, in stride, like a friend who knows the catalog cold.

HARD RULES (these override anything that conflicts):
- Acknowledge what the customer JUST said before asking the next question or pivoting. Skipping the acknowledgement makes you sound like a form.
- Ask exactly ONE question per turn. Never stack questions. Never offer a checklist of options as a question.
- Never use "sex" as an adjective. Use "intimate", "pleasure", "wellness", or "satisfaction". "Sex" as a noun is fine when it makes the answer cleaner.
- No em-dashes anywhere. Use commas, periods, or hyphens in compound words.
- Never surface a countdown, "until midnight," or any timing pressure. Editorial pacing is part of the brand.
- Mood/feeling questions MUST include 2-3 concrete examples in parentheses ("something gentle and warming, something powerful and intense, or somewhere in between?"). Otherwise customers freeze and answer "I don't know."
- Never use "buy now," "checkout now," or any pushy CTA. Use "Take a peek," "Want to see it?", "I'll take it" — Emma voice.
- Never claim you've sent / created / texted / saved anything you haven't actually called a tool for. If you have no tool result for it, you didn't do it.
- Never paste cart URLs or checkout URLs. The only links you may share are PDP URLs that came back from a searchProducts or getProductDetails result THIS turn.

PITCHING (when you actually have a fit):
- One product per turn. Name it once with the title from the tool result (don't paraphrase the product name).
- Lead with insight, not specs — what makes THIS product the right call for THEIR situation, from someone who tests these.
- Include the PDP URL exactly as the tool returned it (https://xdipx.com/products/<handle>). Don't invent handles. Don't shorten URLs.
- Close on a fit-confirming question, never on a number. Price goes mid-reply.

PIVOTS (the customer may shift mid-conversation):
- If the customer pivots to a different category ("how about a wand?", "what about lube?"), call searchProducts with the new direction. DO NOT re-pitch the same product.
- If the customer asks for alternatives ("what else?", "any other options?"), call searchProducts and pitch a DIFFERENT product, not the same one again.
- If the customer asks about variants of the current pitch ("what colors?", "do you have a smaller size?"), call getProductDetails on the current handle and answer specifically from variantOptions.
- Re-read their message every turn. Locking onto a previous pitch when they've moved on is the failure mode we're fixing.
- NEVER narrate a pivot. When the customer changes direction, just engage with what they asked for as if it were the natural next thing to discuss. Do not acknowledge the pivot itself. Forbidden openers (apply in ALL stages, not just PRESENTATION): "great pivot," "love that energy," "switching gears," "got it, switching things up," "sure, going in a new direction," "love that you're exploring," "happy to switch," "totally switching," "changing gears," "good call," "smart move," "great choice," "great call." The customer is in their own conversation — they don't need narration of their own choice.

TOOL USE:
- searchProducts is the workhorse — call it the moment you have a category, brand, or vibe signal worth committing to.
- getProductDetails fetches variant info (colors, sizes, in-stock) for a SPECIFIC handle. Use when the customer asks "what colors?" / "any other variants?" about a product you've already mentioned.
- lookupReturningCustomer is voice/sms-only. Call it on the first inbound turn of voice/sms to personalize. On web it returns an error — ignore the error and proceed.
- getCategoryExplainer renders the canonical explainer for a category the customer is unfamiliar with. Use it once and bridge to a narrowing question.
- Max 3 tool hops per turn. If a search returned no results, acknowledge plainly and offer a different angle.
- When you need to call a tool, do NOT narrate that you're going to do it. Never say "Let me search for you," "Let me look that up," "Let me check the catalog," or any variant. Just call the tool and reply with what you found. The customer sees only your final prose — not your tool calls.

OUTPUT:
- Return ONLY Emma's prose. No JSON, no preamble like "Here's my reply:", no quotes around the message, no meta commentary about your process or pills or tools.
- The reply IS the message the customer reads.
- When a customer lists multiple constraints and no single product can satisfy all of them, acknowledge that openly ("that combo is tough to find in one box") and ask them which ONE constraint matters most to prioritize. Do not pretend the constraints weren't stated. Do not invent a product that fits all of them.`

// ─── Stage-specific addenda ──────────────────────────────────────────────────

const DISCOVERY_ADDENDUM = `STAGE: DISCOVERY.
- You're helping the customer find a fit. No specific product is on the table yet.
- After 4 inbound customer turns without calling searchProducts, you MUST call searchProducts with whatever signal you have. Don't loop on the same question — a guessed pitch beats an interrogation.
- First-time-contact rule: warmth + safe-space framing in 2 sentences max, then ONE narrowing question. No menus, no checklists, no "pick from these five things."
- Returning-customer rule: if lookupReturningCustomer returned a firstName, acknowledge by first name once at the top of your reply. Don't re-introduce yourself, don't say "welcome back" twice.
- If the customer asks "is this discreet?" / "how is it billed?" / shipping basics, answer briefly and steer back to fit ("billing reads as XDIPX, packaging is plain. Now, is it more for solo or with a partner?").
- The discovery stage NEVER builds a checkout. The only links are PDP URLs from a searchProducts result THIS turn.`

const PRESENTATION_ADDENDUM = (currentPitchHandle: string | null) =>
  currentPitchHandle
    ? `STAGE: PRESENTATION.
- You've already pitched a specific product (handle = ${currentPitchHandle}). Their message may be: a question about that product, a request for alternatives, a pivot to a different product, or a commit signal.
- For variant / color / size questions: call getProductDetails with the current handle. Read the variantOptions and answer specifically. Don't guess. If the tool result shows no color options, say so plainly ("looks like just the one colorway on this one").
- For "any other options?" or "what else?": call searchProducts to surface alternatives. Pitch a DIFFERENT product, not the same one again.
- For category pivots ("how about a harness?", "what about a wand instead?", "actually let's see a dildo"): call searchProducts with the new category and pitch the new direction. The no-pivot-narration rule from HARD RULES applies here — do not acknowledge the pivot, just engage with what they asked for.
- If they're committing ("I'll take it", "yes", "sounds good", "👍"): keep your reply short, warm, and confirming. "Got it, queuing it up." or similar. Don't manually send a checkout link — the system handles that on the next turn through the upsell stage. Do NOT say "sending the link" since the upsell stage runs first.
- Re-read their message every turn. They may shift mid-conversation. Don't lock onto the previous pitch.`
    : `STAGE: PRESENTATION (no current pitch on file).
- You've been routed here without a prior pitch. Treat this like DISCOVERY: narrow what they want with one acknowledging line and ONE question, or call searchProducts if you already have a category/brand/vibe signal.
- If you do pitch, follow the PRESENTATION pattern: one product, lead with insight, URL on its own line, close on a fit-confirming question.`

const OBJECTION_ADDENDUM = (currentPitchHandle: string | null) =>
  currentPitchHandle
    ? `STAGE: OBJECTION.
- The customer pushed back on the current pitch (handle = ${currentPitchHandle}). Validate before pivoting. "Yeah, that price is steep, let me show you something else" beats "but it's worth it because..."
- Use searchProducts to surface alternatives in the same category at a different price/feature point. If the objection is "too expensive," filter priceMax. If it's "too intense" or "too much," search for "beginner" or "gentle". If it's "too quiet/weak," search for "powerful".
- Never argue. Never minimize. Validate the concern in HALF a sentence ("yeah, that price stings"), then pivot and pitch. The no-pivot-narration rule from HARD RULES applies here too — just go.
- If they want a variant of the same product instead of a different product (different color/size at the same price), call getProductDetails on the current handle.
- If they're now committing despite the earlier pushback, keep the reply short and confirming. The upsell stage runs next; do not paste a checkout link yourself.`
    : `STAGE: OBJECTION (no current pitch on file).
- Routed here without a prior pitch. Acknowledge the concern, ask one narrowing question, and then call searchProducts if you have signal. Treat the rest like DISCOVERY.`

const POST_CHECKOUT_ADDENDUM = `STAGE: POST_CHECKOUT — the customer just completed a checkout. The pitch is over (for now). Be warm, not pushy.

- If they confirm receipt ("got it", "thanks", "👍"), acknowledge briefly and offer to help with anything else.
- If they want to keep shopping ("show me a vibrator", "what else do you have"), pivot to discovery mode — call searchProducts and pitch a fitting product the same way you would in DISCOVERY.
- If they ask about delivery / shipping / order status: answer with what you actually know from tool results. If you don't have a tool for it, say plainly "I don't have visibility into that from here. Email hello@xdipx.com or call (623) 900-1188 and the team will sort it." Don't promise a callback.
- DO NOT re-pitch what they already bought. Their currentPitchHandle is on the receipt — they don't need it pitched again.
- DO NOT push them to buy more aggressively. Soft suggestion is fine ("if you ever want to add a [pairing], just text 'add a [thing]'") but the priority is making them feel taken care of, not closing another sale.`

// ─── Channel addenda (verbatim from discovery-agent.server.ts) ───────────────

const CHANNEL_VOICE = `CHANNEL: VOICE (the message will be spoken aloud by TTS).
- Sentences must read cleanly aloud. No URLs, no asterisks, no markdown, no bullets, no parenthetical asides longer than 4 words.
- Aim 35-60 words. Two sentences max.
- Currencies: say "twenty-nine dollars" or "around thirty dollars," not "$29." (The TTS layer will speak punctuation otherwise.)
- Never say a URL aloud. If you'd normally include a PDP link, say "I can text you a link if you want" instead.
- Pace yourself. One question. Wait.`

const CHANNEL_SMS = `CHANNEL: SMS (plain text — Twilio).
- No markdown, no **bold**, no [text](url) syntax, no bullet lists, no emoji spam (one emoji max if it lands).
- Aim 40-80 words. Two sentences max.
- PDP URL formatting (REQUIRED for iMessage preview to render the product image): when sharing a PDP URL, put it on its OWN LINE with the https:// prefix, ideally as the LAST line before any closing question. The URL must read https://xdipx.com/products/<handle> verbatim from the tool result. Don't bury it mid-sentence — iMessage only auto-previews URLs that aren't sandwiched between other text.
- Don't gate behind "want me to text the link?" — if you have a fit, share it now.
- Pitch shape: one beat that flexes Emma's expertise (why THIS product for THEIR situation — what makes it the right call from someone who tests these), then the URL on its own line, then a fit-confirming question. Lead with insight, not specs.
- This stage NEVER includes a checkout URL. Pitch and ask.
- Contractions. Friendly. Short.`

const CHANNEL_WEB = `CHANNEL: WEB CHAT (rendered in the xdipx.com chat widget).
- Light markdown is okay. **Bold** for the closing question is fine. Line breaks for rhythm are fine. No code blocks, no headings.
- Aim 50-120 words. Three sentences max in the main pitch.
- Product cards render below your reply automatically when you pitch — name the product naturally in your prose so the card has context above it.
- No checkout URLs in chat. PDP URLs are okay as bare text or inline links of the form /products/<handle>.`

interface ChannelTuning {
  rules: string
  maxTokens: number
}

function tuningFor(channel: 'sms' | 'voice' | 'web'): ChannelTuning {
  if (channel === 'voice') return { rules: CHANNEL_VOICE, maxTokens: MAX_TOKENS_SMS_VOICE }
  if (channel === 'web') return { rules: CHANNEL_WEB, maxTokens: MAX_TOKENS_WEB }
  return { rules: CHANNEL_SMS, maxTokens: MAX_TOKENS_SMS_VOICE }
}

function stageAddendum(stage: ConversationStage, currentPitchHandle: string | null): string {
  if (stage === 'DISCOVERY') return DISCOVERY_ADDENDUM
  if (stage === 'PRESENTATION') return PRESENTATION_ADDENDUM(currentPitchHandle)
  if (stage === 'POST_CHECKOUT') return POST_CHECKOUT_ADDENDUM
  return OBJECTION_ADDENDUM(currentPitchHandle)
}

// ─── Known-about-customer block (Task 0.5 + 0.6) ────────────────────────────

/**
 * Slot keys that carry identity or experience-level framing and must NOT be
 * emitted verbatim into Emma's <known_about_customer> block.
 *
 * Rationale (empathy review binding conditions #2, principles 9 + 15):
 *   - `audience` — demographic/gender label ("for-her", "for-him"). If Emma
 *     sees this she may narrate it back, violating principle 9 (use-case
 *     before identity). The rolling summary, written from the customer's own
 *     phrasing, is the correct channel for this context.
 *   - `experience` — experience-level flag ("first-time"). If Emma sees this
 *     she may narrate it back, violating principle 15 (never assume the
 *     reader's experience level). The summary carries this in the customer's
 *     own words if they stated it.
 *
 * These keys are still extracted and merged into discoveredSlots for internal
 * analytics and slot-accumulation — they are only excluded from the text
 * block that Emma reads.
 */
const IDENTITY_ADJACENT_SLOT_KEYS: ReadonlySet<string> = new Set(['audience', 'experience'])

/**
 * Serialize discovered slots to a compact key=value string for the
 * <known_about_customer> block. Skips falsy values so the block never
 * contains "audience=undefined" or "priceMax=null" noise.
 *
 * Identity-adjacent keys (see IDENTITY_ADJACENT_SLOT_KEYS) are excluded so
 * Emma never sees demographic or experience-level labels verbatim in her
 * context block. The rolling summary carries that context in customer-stated
 * language instead.
 *
 * Cap at 8 slots to keep the block tight — the rolling summary carries
 * additional context from older turns.
 */
function serializeSlots(slots: Partial<DiscoverySlots>): string {
  const MAX_SLOTS = 8
  const pairs: string[] = []
  for (const [key, val] of Object.entries(slots)) {
    if (IDENTITY_ADJACENT_SLOT_KEYS.has(key)) continue
    if (!val && val !== 0) continue
    if (Array.isArray(val)) {
      if (val.length === 0) continue
      pairs.push(`${key}=${val.join(',')}`)
    } else {
      pairs.push(`${key}=${String(val)}`)
    }
    if (pairs.length >= MAX_SLOTS) break
  }
  return pairs.join(' | ')
}

/**
 * Build the dynamic <known_about_customer> XML block.
 *
 * This block is injected as the SECOND system-prompt block (no cache_control)
 * so it is fresh every turn without invalidating the stable rules block.
 *
 * Returns empty string when all inputs are empty — the block is then omitted
 * entirely from the system prompt to avoid injecting noise on turn 1.
 *
 * Architect condition #2 (binding): this block is subject to emma-empathy-
 * reviewer gate before the branch merges. It must not:
 *   - Disclose internal slot key names to the customer.
 *   - Make assumptions beyond what the customer explicitly stated.
 *   - Contain clinical language or em-dashes.
 *   - Reference the full pitched-handles log verbatim — only show the oldest
 *     2 handles as "prior options shown" for the "first one you showed me" case.
 *
 * @param slots - The merged discovered slots for this turn.
 * @param summary - The rolling conversation summary (may be null on first turn).
 * @param pitchedHandlesLog - Ordered log of previously pitched handles (most-recent last).
 */
export function buildKnownAboutCustomer(
  slots: Partial<DiscoverySlots>,
  summary: string | null,
  pitchedHandlesLog: string[] | null,
): string {
  const summaryLine = summary?.trim() || null
  const slotLine = serializeSlots(slots)

  // Build the "prior options shown" line — capped to the 2 oldest so
  // "the first one you showed me" resolves without bloating context.
  let priorOptionsLine: string | null = null
  if (pitchedHandlesLog && pitchedHandlesLog.length > 1) {
    // log is most-recent last, so oldest = [0], second-oldest = [1]
    const oldest = pitchedHandlesLog.slice(0, 2)
    priorOptionsLine = `Prior options shown (if customer refers back): ${oldest.join(', ')}`
  }

  // If nothing to inject, return empty — block will be omitted.
  if (!summaryLine && !slotLine && !priorOptionsLine) return ''

  const lines: string[] = ['<known_about_customer>']
  if (summaryLine) lines.push(`Summary: ${summaryLine}`)
  if (slotLine) lines.push(`Known: ${slotLine}`)
  if (priorOptionsLine) lines.push(priorOptionsLine)
  lines.push('</known_about_customer>')
  lines.push(
    'Note: Emma sees the full conversation history. Use this block for context that may have scrolled',
    'out of the history window. If history and this block conflict, history takes precedence.',
  )

  return lines.join('\n')
}

/**
 * Build the stable (cacheable) part of the system prompt.
 *
 * Task 0.5: split into two TextBlockParams:
 *   Block 1 — stable rules (BRAND_VOICE + CONVERSATION_RULES_CORE + stage addendum
 *              + channel rules). Gets cache_control so Anthropic caches it across
 *              turns within the same stage+channel+pitch-handle combination.
 *   Block 2 — dynamic <known_about_customer> block (no cache_control). Changes
 *              every turn as slots and summary update.
 *
 * This preserves prompt-cache hits on the expensive rules block while still
 * injecting fresh per-turn memory context.
 */
function buildSystemBlocks(
  stage: ConversationStage,
  channel: 'sms' | 'voice' | 'web',
  currentPitchHandle: string | null,
  discoveredSlots: Partial<DiscoverySlots>,
  conversationSummary: string | null,
  pitchedHandlesLog: string[] | null,
): Anthropic.TextBlockParam[] {
  const tuning = tuningFor(channel)
  const stableText = `${BRAND_VOICE}\n\n${CONVERSATION_RULES_CORE}\n\n${stageAddendum(stage, currentPitchHandle)}\n\n${tuning.rules}`

  const stableBlock: Anthropic.TextBlockParam = {
    type: 'text',
    text: stableText,
    // Cached per stage+channel+currentPitchHandle. Invalidates when any of
    // those change — exactly when we want a fresh cache write.
    cache_control: { type: 'ephemeral' },
  }

  const knownBlock = buildKnownAboutCustomer(discoveredSlots, conversationSummary, pitchedHandlesLog)
  if (!knownBlock) {
    // First turn or no context yet — single-block system prompt.
    return [stableBlock]
  }

  return [
    stableBlock,
    // Dynamic block: no cache_control — changes every turn.
    { type: 'text', text: knownBlock },
  ]
}


// ─── Fabrication guard ───────────────────────────────────────────────────────

const PDP_URL_RE = /(https?:\/\/)?xdipx\.com\/products\/([a-z0-9][a-z0-9-]*)/gi
// Match any cart/checkout URL — these stages never build checkouts, so anything
// is fabricated by definition.
const CHECKOUT_URL_RE =
  /https?:\/\/[^\s)]*?(?:myshopify\.com\/cart|\/cart\/|\/checkouts?\/)\S*/gi

interface FabricationGuardResult {
  text: string
  caught: string | undefined
}

/**
 * Strip URLs the agent shouldn't have included:
 *   - PDP URLs whose handle wasn't in the real-handles set (= invented).
 *   - Any cart/checkout URL — DISCOVERY/PRESENTATION/OBJECTION don't issue checkouts.
 * After stripping, tidy double-spaces and orphan punctuation so the prose
 * still reads cleanly. Returns the cleaned text and a string code naming
 * what was caught (or undefined if nothing was).
 */
function applyFabricationGuard(text: string, realHandles: Set<string>): FabricationGuardResult {
  if (!text) return { text, caught: undefined }
  let pdpStripped = false
  let checkoutStripped = false

  let out = text.replace(PDP_URL_RE, (match, _proto: string | undefined, handle: string) => {
    if (realHandles.has(handle.toLowerCase())) return match
    pdpStripped = true
    return ''
  })

  out = out.replace(CHECKOUT_URL_RE, () => {
    checkoutStripped = true
    return ''
  })

  if (pdpStripped || checkoutStripped) {
    out = out
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\(\s*\)/g, '')
      .replace(/\s+([.,!?])/g, '$1')
      .replace(/\s+\n/g, '\n')
      .trim()
  }

  let caught: string | undefined
  if (pdpStripped && checkoutStripped) caught = 'pdp_url|checkout_url'
  else if (pdpStripped) caught = 'pdp_url'
  else if (checkoutStripped) caught = 'checkout_url'

  return { text: out, caught }
}

// ─── productCard detection ───────────────────────────────────────────────────

/**
 * Pick at most ONE pitched product from this turn's accumulated cards.
 *
 * Task 0.7: when `preferredHandle` is set (captured from tool results during
 * the Sonnet loop), use it as ground truth — no prose scanning needed. This
 * fixes re-pitch loops caused by paraphrased product names escaping the regex.
 *
 * The regex fallback runs only when preferredHandle is null, which means:
 *   - No getProductDetails call happened this turn, AND
 *   - No single-card searchProducts result was returned.
 * In that case the agent pitched a product that came through prose alone
 * (edge case — the old behavior is the right fallback here).
 */
function detectPitchedCard(
  text: string,
  cards: IvrProductCard[],
  preferredHandle: string | null = null,
): IvrProductCard | undefined {
  if (cards.length === 0) return undefined

  // Task 0.7: tool-result truth — prefer the handle captured during the loop.
  if (preferredHandle) {
    const preferred = cards.find(
      (c) => c.handle?.toLowerCase() === preferredHandle.toLowerCase(),
    )
    if (preferred) return preferred
  }

  if (!text) return undefined
  const lower = text.toLowerCase()

  // Regex fallback: PDP URL mention wins over title mention.
  for (const card of cards) {
    if (!card.handle) continue
    const needle = `/products/${card.handle.toLowerCase()}`
    if (lower.includes(needle)) return card
  }

  // Second pass: title mention.
  for (const card of cards) {
    if (!card.title) continue
    const titleLower = card.title.toLowerCase().trim()
    if (titleLower.length > 0 && lower.includes(titleLower)) return card
  }

  return undefined
}

// ─── Stage-out resolution ────────────────────────────────────────────────────

/**
 * Resolve the stage transition based on the input stage and what the agent
 * pitched. Same table from the spec:
 *
 *   | Input stage   | New pitch     | No new pitch  |
 *   | DISCOVERY     | PRESENTATION  | DISCOVERY     |
 *   | PRESENTATION  | PRESENTATION  | PRESENTATION  |
 *   | OBJECTION     | PRESENTATION  | OBJECTION     |
 *   | POST_CHECKOUT | POST_CHECKOUT | POST_CHECKOUT |
 *
 * "New pitch" means the agent pitched a product whose handle differs from
 * the conversation's currentPitchHandle.
 *
 * POST_CHECKOUT is sticky: even when the agent pitches a NEW product
 * (customer wants to keep shopping), we stay in POST_CHECKOUT this turn.
 * The next "I'll take it" routes through pickEffectiveStage's standard
 * COMMIT_PICK path → UPSELL → CHECKOUT, queueing a fresh purchase
 * without reopening pitches against the just-completed order.
 */
function resolveStageOut(
  stageIn: ConversationStage,
  pitched: IvrProductCard | undefined,
  currentPitchHandle: string | null,
): ConversationStage {
  if (!pitched) {
    // No new pitch — stay where we are.
    return stageIn
  }
  const isNew =
    !currentPitchHandle ||
    pitched.handle.toLowerCase() !== currentPitchHandle.toLowerCase()

  if (stageIn === 'DISCOVERY') {
    return isNew ? 'PRESENTATION' : 'DISCOVERY'
  }
  if (stageIn === 'OBJECTION') {
    return isNew ? 'PRESENTATION' : 'OBJECTION'
  }
  if (stageIn === 'POST_CHECKOUT') {
    // Stay in POST_CHECKOUT. A new pitch here is the customer queuing
    // up a follow-on purchase; the next COMMIT_PICK will route them to
    // UPSELL/CHECKOUT through pickEffectiveStage.
    return 'POST_CHECKOUT'
  }
  // PRESENTATION input: stay PRESENTATION whether the pitch is new or repeated.
  return 'PRESENTATION'
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export async function executeConversationAgent(
  input: ConversationAgentInput,
): Promise<StageResponse> {
  const { ctx, intent, customerText, stage } = input
  const channel: 'sms' | 'voice' | 'web' = ctx.channel ?? 'sms'

  const baseTelemetry: StageResponse['telemetry'] = {
    intent: intent.intent,
    intentConfidence: intent.confidence,
  }

  // ── Slot extraction in parallel (analytics only) ──────────────────────────
  const priorSlots: Partial<DiscoverySlots> =
    (ctx.conversation.discoveredSlots as Partial<DiscoverySlots> | undefined) ?? {}
  const slotsPromise = extractSlots({ text: customerText, priorSlots }).catch((err) => {
    console.warn('[conversation-agent] extractSlots failed (non-fatal)', err)
    return null
  })

  // ── History ────────────────────────────────────────────────────────────────
  let history: HistoryTurn[] = []
  try {
    history = await loadConversationHistory(ctx.conversation.conversationId, HISTORY_LIMIT)
  } catch (err) {
    console.warn('[conversation-agent] failed to load history, continuing with empty', err)
  }

  const messages: Anthropic.MessageParam[] = [
    ...history.map((t) => ({ role: t.role, content: t.text })),
    { role: 'user' as const, content: customerText },
  ]

  // ── System + tools (Task 0.5: two-block system prompt) ───────────────────
  const tuning = tuningFor(channel)
  const currentPitchHandle = ctx.conversation.currentPitchHandle ?? null
  const conversationSummary = ctx.conversation.conversationSummary ?? null
  const pitchedHandlesLog = ctx.conversation.pitchedHandlesLog ?? null

  // Two-block system: stable rules block (cached) + dynamic <known_about_customer>
  // block (uncached). See buildSystemBlocks for the full architecture rationale.
  const systemParam: Anthropic.TextBlockParam[] = buildSystemBlocks(
    stage,
    channel,
    currentPitchHandle,
    priorSlots,
    conversationSummary,
    pitchedHandlesLog,
  )

  // ── Card accumulator + telemetry ──────────────────────────────────────────
  const cardsByToolUseId = new Map<string, IvrProductCard[]>()
  const realHandles = new Set<string>()
  // Seed real-handles with currentPitchHandle so the agent can re-mention the
  // pitched product's PDP URL without it being stripped as fabrication. Common
  // case: PRESENTATION turn where the customer asks a follow-up and the agent
  // re-includes the URL it already shared earlier.
  if (currentPitchHandle) realHandles.add(currentPitchHandle.toLowerCase())

  const toolCalls: NonNullable<StageResponse['telemetry']['toolCalls']> = []
  let totalInputTokens = 0
  let totalOutputTokens = 0

  const tally = (u: { input_tokens?: number; output_tokens?: number } | undefined) => {
    if (!u) return
    totalInputTokens += u.input_tokens ?? 0
    totalOutputTokens += u.output_tokens ?? 0
  }

  const toolCtxBase: Omit<DiscoveryAgentToolContext, 'toolUseId'> = {
    phone: ctx.conversation.phone,
    channel,
    cardSink: cardsByToolUseId,
  }

  // ── Sonnet loop (Task 0.7: tool-result pitch detection; Task 0.9: budget flag) ──
  let finalText = ''
  // Task 0.7: capture the pitched handle from tool results rather than prose regex.
  // Set when getProductDetails is called on a specific handle, or when searchProducts
  // returns exactly one card (unambiguous pitch from tool truth).
  let toolResultPitchedHandle: string | null = null
  // Task 0.9: set true when the loop exhausts MAX_TOOL_HOPS with a pending
  // tool_use stop_reason, causing safeFallback to run. Written to telemetry.
  let toolBudgetExhausted = false

  try {
    for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
      const res = await _client.messages.create({
        model: SONNET_MODEL,
        max_tokens: tuning.maxTokens,
        system: systemParam,
        tools: DISCOVERY_AGENT_TOOLS,
        messages,
      })
      tally(res.usage)

      if (res.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: res.content })
        const toolResultBlocks: Anthropic.ToolResultBlockParam[] = []

        for (const block of res.content) {
          if (block.type !== 'tool_use') continue
          const toolInput = (block.input ?? {}) as Record<string, unknown>

          // Task 0.7: capture handle directly from getProductDetails tool input.
          // This is ground truth — the tool was called on this specific handle.
          if (
            block.name === 'getProductDetails' &&
            typeof toolInput['handle'] === 'string' &&
            toolInput['handle']
          ) {
            toolResultPitchedHandle = toolInput['handle']
          }

          const result = await runDiscoveryTool(block.name, toolInput, {
            ...toolCtxBase,
            toolUseId: block.id,
          })

          // Stash real handles from any cards this hop produced.
          const cards = cardsByToolUseId.get(block.id) ?? []
          for (const c of cards) {
            if (c.handle) realHandles.add(c.handle.toLowerCase())
          }

          // Task 0.7: if searchProducts returned exactly one card, that IS the
          // pitched product — no ambiguity. Only applicable when getProductDetails
          // wasn't called this turn (getProductDetails takes precedence).
          if (
            block.name === 'searchProducts' &&
            cards.length === 1 &&
            cards[0]?.handle &&
            !toolResultPitchedHandle
          ) {
            toolResultPitchedHandle = cards[0].handle
          }

          toolCalls.push({
            name: block.name,
            input: toolInput,
            ok: result.ok,
            ...(result.error ? { error: result.error } : {}),
          })

          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
            is_error: !result.ok,
          })
        }

        // Task 0.9: detect budget exhaustion on the last hop.
        // When hop === MAX_TOOL_HOPS - 1 and stop_reason is still 'tool_use',
        // the loop will exit after this iteration without setting finalText.
        if (hop === MAX_TOOL_HOPS - 1) {
          toolBudgetExhausted = true
          console.warn(
            `[conversation-agent] tool budget exhausted at hop=${hop + 1} — safeFallback will run`,
          )
        }

        messages.push({ role: 'user', content: toolResultBlocks })
        continue
      }

      // Terminal stop_reason ('end_turn' / 'max_tokens' / etc.) — pull the text.
      const textBlock = res.content.find(
        (b): b is Anthropic.TextBlock => b.type === 'text',
      )
      finalText = (textBlock?.text ?? '').trim()
      break
    }
  } catch (err) {
    console.error('[conversation-agent] Sonnet call failed', err)
    return safeFallback(stage, baseTelemetry, toolBudgetExhausted)
  }

  if (!finalText) {
    // Task 0.9: when finalText is empty the loop exited via budget exhaustion.
    toolBudgetExhausted = true
    return safeFallback(stage, baseTelemetry, toolBudgetExhausted)
  }

  // ── Fabrication guard ─────────────────────────────────────────────────────
  const guarded = applyFabricationGuard(finalText, realHandles)
  const finalProse = guarded.text || finalText // never ship empty

  // ── Detect pitched product (Task 0.7: tool-result truth first) ──────────
  const allCards: IvrProductCard[] = []
  for (const list of cardsByToolUseId.values()) {
    allCards.push(...list)
  }
  const pitched = detectPitchedCard(finalProse, allCards, toolResultPitchedHandle)

  // ── Resolve parallel slot extraction ──────────────────────────────────────
  const slotsResult = await slotsPromise
  const mergedSlots: Partial<DiscoverySlots> = slotsResult
    ? { ...priorSlots, ...slotsResult.slots }
    : priorSlots

  if (slotsResult && Object.keys(slotsResult.slots).length > 0) {
    console.info(
      '[conversation-agent] slots',
      JSON.stringify({
        stage,
        channel,
        source: slotsResult.source,
        slots: slotsResult.slots,
        pitched: pitched?.handle ?? null,
      }),
    )
  }

  // ── Build StageResponse ───────────────────────────────────────────────────
  const stageOutLogical = resolveStageOut(stage, pitched, currentPitchHandle)
  // Validate the transition against the legal-transitions table — this also
  // catches the case where the input stage is PRESENTATION and we want to stay
  // PRESENTATION (resolveTransition allows from===to as a no-op).
  const stageOut = resolveTransition(ctx.conversation.stage, stageOutLogical)

  // currentPitchHandle write: set to the pitched handle when the agent pitched
  // a (new) product. When the agent didn't pitch anything, we don't touch the
  // existing handle — let it carry forward.
  const newPitchHandle: string | null | undefined = pitched
    ? pitched.handle
    : undefined

  // Task 0.6: build the updated pitched_handles_log.
  // Append the new handle (most-recent last), cap at 10 entries.
  // The log is how "the first one you showed me" resolves: log[0] is the oldest.
  const updatedPitchedHandlesLog: string[] | undefined = newPitchHandle
    ? (() => {
        const prev = ctx.conversation.pitchedHandlesLog ?? []
        const next = [...prev, newPitchHandle]
        // Keep the most-recent 10 (slice from the end).
        return next.length > 10 ? next.slice(next.length - 10) : next
      })()
    : undefined

  const stateWrites: ConversationStateWrites = {
    stage: stageOut,
    discoveredSlots: mergedSlots as Record<string, unknown>,
    ...(newPitchHandle !== undefined && { currentPitchHandle: newPitchHandle }),
    // Task 0.6: write updated pitched handles log when a new pitch occurred.
    ...(updatedPitchedHandlesLog !== undefined && { pitchedHandlesLog: updatedPitchedHandlesLog }),
  }

  const productCard: ProductRef | undefined = pitched
    ? {
        handle: pitched.handle,
        title: pitched.title,
        price: `$${pitched.price.toFixed(2)}`,
        pdpUrl: `https://xdipx.com/products/${pitched.handle}`,
      }
    : undefined

  const segment: StageResponse['segments'][number] = {
    prose: finalProse,
    ...(productCard !== undefined && { productCard }),
  }

  const telemetry: StageResponse['telemetry'] = {
    ...baseTelemetry,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    ...(toolCalls.length > 0 && { toolCalls }),
    ...(guarded.caught && { fabricationCaught: guarded.caught }),
    // Task 0.9: only set when budget was truly exhausted (false would be noise
    // in the telemetry column — omit it for normal turns).
    ...(toolBudgetExhausted && { toolBudgetExhausted: true }),
  }

  // ADR-003 Sub-decision B: summarizer is now fired from the PROCESSOR layer
  // (processSmsMessageV2 / processWebMessageV2) so ALL stage handlers trigger it,
  // not just the executeConversationAgent path. The processor fires it after
  // applyStateWrites returns — per architect condition #3.
  // Do not re-fire here; the processor is the single authoritative location.

  return {
    stageOut,
    goalAchieved: false,
    segments: [segment],
    stateWrites,
    telemetry,
  }
}

// ─── Safe fallback ───────────────────────────────────────────────────────────

/**
 * Returned when the Anthropic call throws or yields no text. Stays on the
 * input stage so the next turn can re-attempt without loss of state.
 *
 * Task 0.9: accepts toolBudgetExhausted flag so it appears in telemetry even
 * when the loop exits via budget exhaustion (not just via exception).
 */
function safeFallback(
  stage: ConversationStage,
  baseTelemetry: StageResponse['telemetry'],
  toolBudgetExhaustedFlag = false,
): StageResponse {
  return {
    stageOut: stage,
    goalAchieved: false,
    segments: [
      {
        prose:
          "I lost the thread for a sec. What were you hoping to find?",
      },
    ],
    stateWrites: {
      stage,
    },
    telemetry: {
      ...baseTelemetry,
      inputTokens: 0,
      outputTokens: 0,
      // Task 0.9: record budget exhaustion in telemetry so the dashboard can
      // aggregate "turns where tool budget ran out" by week/channel.
      ...(toolBudgetExhaustedFlag && { toolBudgetExhausted: true }),
    },
  }
}
