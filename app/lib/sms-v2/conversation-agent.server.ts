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

const client = new Anthropic({ apiKey: (process.env['ANTHROPIC_API_KEY'] ?? '').trim() })

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

TOOL USE:
- searchProducts is the workhorse — call it the moment you have a category, brand, or vibe signal worth committing to.
- getProductDetails fetches variant info (colors, sizes, in-stock) for a SPECIFIC handle. Use when the customer asks "what colors?" / "any other variants?" about a product you've already mentioned.
- lookupReturningCustomer is voice/sms-only. Call it on the first inbound turn of voice/sms to personalize. On web it returns an error — ignore the error and proceed.
- getCategoryExplainer renders the canonical explainer for a category the customer is unfamiliar with. Use it once and bridge to a narrowing question.
- Max 3 tool hops per turn. If a search returned no results, acknowledge plainly and offer a different angle.

OUTPUT:
- Return ONLY Emma's prose. No JSON, no preamble like "Here's my reply:", no quotes around the message, no meta commentary about your process or pills or tools.
- The reply IS the message the customer reads.`

// ─── Stage-specific addenda ──────────────────────────────────────────────────

const DISCOVERY_ADDENDUM = `STAGE: DISCOVERY.
- You're helping the customer find a fit. No specific product is on the table yet.
- After 4 inbound customer turns without calling searchProducts, you MUST call searchProducts with whatever signal you have. Don't loop on the same question — a guessed pitch beats an interrogation.
- First-time-contact rule: warmth + safe-space framing in 2 sentences max, then ONE narrowing question. No menus, no checklists, no "pick from these five things."
- Returning-customer rule: if lookupReturningCustomer returned a firstName, acknowledge by first name once at the top of your reply. Don't re-introduce yourself, don't say "welcome back" twice.
- If the customer asks "is this discreet?" / "how is it billed?" / shipping basics, answer briefly and steer back to fit ("billing reads as XDIPX, packaging is plain. Now, was it more for solo or partner moments?").
- The discovery stage NEVER builds a checkout. The only links are PDP URLs from a searchProducts result THIS turn.`

const PRESENTATION_ADDENDUM = (currentPitchHandle: string | null) =>
  currentPitchHandle
    ? `STAGE: PRESENTATION.
- You've already pitched a specific product (handle = ${currentPitchHandle}). Their message may be: a question about that product, a request for alternatives, a pivot to a different product, or a commit signal.
- For variant / color / size questions: call getProductDetails with the current handle. Read the variantOptions and answer specifically. Don't guess. If the tool result shows no color options, say so plainly ("looks like just the one colorway on this one").
- For "any other options?" or "what else?": call searchProducts to surface alternatives. Pitch a DIFFERENT product, not the same one again.
- For category pivots ("how about a harness?", "what about a wand instead?", "actually let's see a dildo"): just pivot. Call searchProducts with the new category and pitch the new direction. DO NOT narrate the pivot. Forbidden openers: "great pivot," "love that energy," "switching gears," "got it, switching things up," "sure, going in a new direction," "love that you're exploring." The customer is in their own conversation; they don't need narration of their own choice. Just engage with what they asked for as if it were the natural next thing to discuss.
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
- Never argue. Never minimize. Validate the concern in HALF a sentence ("yeah, that price stings"), then pivot and pitch. Don't call out the pivot itself — no "let me switch gears for you," no "great pivot." Just go.
- If they want a variant of the same product instead of a different product (different color/size at the same price), call getProductDetails on the current handle.
- If they're now committing despite the earlier pushback, keep the reply short and confirming. The upsell stage runs next; do not paste a checkout link yourself.`
    : `STAGE: OBJECTION (no current pitch on file).
- Routed here without a prior pitch. Acknowledge the concern, ask one narrowing question, and then call searchProducts if you have signal. Treat the rest like DISCOVERY.`

const POST_CHECKOUT_ADDENDUM = `STAGE: POST_CHECKOUT — the customer just completed a checkout. The pitch is over (for now). Be warm, not pushy.

- If they confirm receipt ("got it", "thanks", "👍"), acknowledge briefly and offer to help with anything else.
- If they want to keep shopping ("show me a vibrator", "what else do you have"), pivot to discovery mode — call searchProducts and pitch a fitting product the same way you would in DISCOVERY.
- If they ask about delivery / shipping / order status: answer with what you actually know from tool results. If you don't have a tool for it, say plainly "I don't have visibility into that from here — email hello@xdipx.com or call (623) 900-1188 and the team will sort it." Don't promise a callback.
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

function buildSystemPrompt(
  stage: ConversationStage,
  channel: 'sms' | 'voice' | 'web',
  currentPitchHandle: string | null,
): string {
  const tuning = tuningFor(channel)
  return `${BRAND_VOICE}\n\n${CONVERSATION_RULES_CORE}\n\n${stageAddendum(stage, currentPitchHandle)}\n\n${tuning.rules}`
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
 * Same logic the discovery agent used: PDP URL mention wins, title mention is
 * the fallback. Used to decide whether the customer should advance to
 * PRESENTATION (or stay there) and what currentPitchHandle to write.
 */
function detectPitchedCard(
  text: string,
  cards: IvrProductCard[],
): IvrProductCard | undefined {
  if (!text || cards.length === 0) return undefined
  const lower = text.toLowerCase()

  // First pass: direct PDP URL mention.
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

  // ── System + tools ────────────────────────────────────────────────────────
  const tuning = tuningFor(channel)
  const currentPitchHandle = ctx.conversation.currentPitchHandle ?? null
  const systemText = buildSystemPrompt(stage, channel, currentPitchHandle)
  // Cache the system block — stable per stage+channel+currentPitchHandle within
  // a 5-min window. It will rebuild when stage flips or the pitched handle
  // changes (which is exactly when we'd want a fresh cache anyway).
  const systemParam: Anthropic.TextBlockParam[] = [
    { type: 'text', text: systemText, cache_control: { type: 'ephemeral' } },
  ]

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

  // ── Sonnet loop ───────────────────────────────────────────────────────────
  let finalText = ''

  try {
    for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
      const res = await client.messages.create({
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
          const result = await runDiscoveryTool(block.name, toolInput, {
            ...toolCtxBase,
            toolUseId: block.id,
          })

          // Stash real handles from any cards this hop produced.
          const cards = cardsByToolUseId.get(block.id) ?? []
          for (const c of cards) {
            if (c.handle) realHandles.add(c.handle.toLowerCase())
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
    return safeFallback(stage, baseTelemetry)
  }

  if (!finalText) {
    return safeFallback(stage, baseTelemetry)
  }

  // ── Fabrication guard ─────────────────────────────────────────────────────
  const guarded = applyFabricationGuard(finalText, realHandles)
  const finalProse = guarded.text || finalText // never ship empty

  // ── Detect pitched product ────────────────────────────────────────────────
  const allCards: IvrProductCard[] = []
  for (const list of cardsByToolUseId.values()) {
    allCards.push(...list)
  }
  const pitched = detectPitchedCard(finalProse, allCards)

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

  const stateWrites: ConversationStateWrites = {
    stage: stageOut,
    discoveredSlots: mergedSlots as Record<string, unknown>,
    ...(newPitchHandle !== undefined && { currentPitchHandle: newPitchHandle }),
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
  }

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
 */
function safeFallback(
  stage: ConversationStage,
  baseTelemetry: StageResponse['telemetry'],
): StageResponse {
  return {
    stageOut: stage,
    goalAchieved: false,
    segments: [
      {
        prose:
          "Tell me a little more about what you're looking for and I'll find something that fits.",
      },
    ],
    stateWrites: {
      stage,
    },
    telemetry: {
      ...baseTelemetry,
      inputTokens: 0,
      outputTokens: 0,
    },
  }
}
