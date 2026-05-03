/**
 * app/lib/sms-v2/discovery-agent.server.ts
 *
 * Sonnet-driven DISCOVERY stage handler — Phase 2 implementation.
 *
 * Replaces the gate-state-machine when DISCOVERY_AGENT_VERSION='v2-agent' or
 * the conversation is on the agent allowlist. The dispatch lives in
 * stages/discovery.server.ts and is unchanged; this file is the runtime.
 *
 * Flow per turn:
 *   1. Build a channel-aware system prompt (BRAND_VOICE + DISCOVERY_RULES).
 *   2. Load up to 12 history pairs from sms_turns.
 *   3. Run a Sonnet messages.create loop — up to 3 tool hops.
 *   4. Strip any URL the agent invented (PDP not in this turn's tool results,
 *      or any cart/checkout URL — discovery never builds checkouts).
 *   5. Detect whether the agent pitched a specific product. If yes, attach a
 *      productCard segment and advance to PRESENTATION. Otherwise stay in
 *      DISCOVERY.
 *   6. On any error, return a safe fallback so the call doesn't crash.
 *
 * Tool-call usage tally and fabrication telemetry are forwarded through to
 * the StageResponse so processor logs can show where the model spent budget.
 */
import Anthropic from '@anthropic-ai/sdk'
import { loadConversationHistory, type HistoryTurn } from './conversation-history.server'
import {
  DISCOVERY_AGENT_TOOLS,
  runDiscoveryTool,
  type DiscoveryAgentToolContext,
} from './discovery-agent-tools.server'
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

// ─── Module-scope client ─────────────────────────────────────────────────────

const client = new Anthropic({ apiKey: (process.env['ANTHROPIC_API_KEY'] ?? '').trim() })

// Sonnet 4.6 — the live identifier in this codebase. SMS Sonnet model from
// chat.server.ts so behavior stays consistent across surfaces.
const SONNET_MODEL = 'claude-sonnet-4-6'

const MAX_TOOL_HOPS = 3
const HISTORY_LIMIT = 12

// max_tokens tuned per channel to mirror chat.server.ts shapes:
//   - sms/voice: 480 — about 1900 chars of generation room before the
//     downstream clamp trims to ~480 chars on a sentence boundary.
//   - web:      700 — chat widget can render a few short paragraphs.
const MAX_TOKENS_SMS_VOICE = 480
const MAX_TOKENS_WEB = 700

// ─── System prompt ───────────────────────────────────────────────────────────

/**
 * Hard discovery rules. Composed below with a channel-specific addendum so the
 * agent only sees the channel it's actually replying on. Channel-aware rules
 * change per turn (a single conversation can hop sms→voice→web), so this
 * builder runs at request time rather than module load.
 */
const DISCOVERY_RULES_CORE = `DISCOVERY MODE — Emma talks customers through an unfamiliar topic, narrows what they actually want, and pitches when she has a fit.

HARD RULES (these override anything that conflicts):
- Acknowledge what the customer JUST said before asking the next question. Skipping the acknowledgement makes you sound like a form.
- Ask exactly ONE question per turn. Never stack questions. Never offer a checklist of options as a question.
- After 4 inbound customer turns in this conversation, you MUST call searchProducts with whatever signal you have. Do not loop on the same question. A guessed pitch beats an interrogation.
- Never claim you've sent / created / texted / saved anything you haven't actually called a tool for. If you have no tool result for it, you didn't do it.
- Never use "sex" as an adjective. Use "intimate", "pleasure", "wellness", or "satisfaction". "Sex" as a noun is fine when it makes the answer cleaner.
- No em-dashes anywhere. Use commas, periods, or hyphens in compound words.
- Never surface a countdown, "until midnight," or any timing pressure. Editorial pacing is part of the brand.
- First-time-contact rule: warmth + safe-space framing in 2 sentences max, then ONE narrowing question. No menus, no checklists, no "pick from these five things."
- Returning-customer rule: if lookupReturningCustomer returned a firstName, acknowledge by first name once at the top of your reply. Don't re-introduce yourself, don't say "welcome back" twice.
- Mood/feeling questions MUST include 2-3 concrete examples in parentheses ("something gentle and warming, something powerful and intense, or somewhere in between?"). Otherwise customers freeze and answer "I don't know."
- Never use "buy now," "checkout now," or any pushy CTA. Use "Take a peek," "Want to see it?", "I'll take it" — Emma voice.
- Don't pile on options. One pain → one product → one ask. If you pitch, pitch ONE thing and end with a fit-confirming question.
- Never paste cart URLs, checkout URLs, or invented PDP URLs. The discovery stage NEVER builds a checkout. The only links you may share are PDP URLs that came back from a searchProducts result this turn — and only when you're pitching that specific product.
- If the customer asks "is this discreet?" / "how is it billed?" / shipping basics, answer briefly and steer back to fit ("billing reads as XDIPX, packaging is plain. Now, was it more for solo or partner moments?").

TOOL USE:
- searchProducts is the workhorse. Call it the moment you have at least one of: a category noun, a brand, or enough vibe signal to commit. Do NOT loop more than 2 question turns without calling a tool.
- lookupReturningCustomer is voice/sms-only. Call it on the first inbound turn of voice/sms conversations to personalize. On web it returns an error — ignore the error and proceed.
- getCategoryExplainer renders the canonical explainer for a category the customer is unfamiliar with (lube types, what a wand vs a bullet does). Use it once and then bridge to a narrowing question.
- Max 3 tool hops per turn. If you've called searchProducts and it returned no results, don't keep searching — acknowledge plainly and offer a different angle.

PITCHING (for when you actually have a fit):
- One product per turn. Name it once with the title from the tool result (don't paraphrase the product name).
- Include the PDP URL exactly as the tool returned it (https://xdipx.com/products/<handle>). Don't invent handles. Don't shorten URLs.
- Lead with what it does and who it's for. Price goes mid-reply. Close on a fit-confirming question, never on a number.
- If the agent pitches a specific product, the next turn is PRESENTATION — keep your prose oriented to that one product.

OUTPUT:
- Return ONLY Emma's prose. No JSON, no preamble like "Here's my reply:", no quotes around the message, no meta commentary about your process or pills or tools.
- The reply IS the message the customer reads.`

const DISCOVERY_RULES_VOICE = `CHANNEL: VOICE (the message will be spoken aloud by TTS).
- Sentences must read cleanly aloud. No URLs, no asterisks, no markdown, no bullets, no parenthetical asides longer than 4 words.
- Aim 35-60 words. Two sentences max.
- Currencies: say "twenty-nine dollars" or "around thirty dollars," not "$29." (The TTS layer will speak punctuation otherwise.)
- Never say a URL aloud. If you'd normally include a PDP link, say "I can text you a link if you want" instead.
- Pace yourself. One question. Wait.`

const DISCOVERY_RULES_SMS = `CHANNEL: SMS (plain text — Twilio).
- No markdown, no **bold**, no [text](url) syntax, no bullet lists, no emoji spam (one emoji max if it lands).
- Aim 40-80 words. Two sentences max.
- If you want to share a PDP URL, just paste it inline as plain text (https://xdipx.com/products/<handle>). Don't gate behind "want me to text the link?" — if you have a fit, share it now.
- Discovery stage NEVER includes a checkout URL. The customer hasn't committed. Pitch and ask.
- Contractions. Friendly. Short.`

const DISCOVERY_RULES_WEB = `CHANNEL: WEB CHAT (rendered in the xdipx.com chat widget).
- Light markdown is okay. **Bold** for the closing question is fine. Line breaks for rhythm are fine. No code blocks, no headings.
- Aim 50-120 words. Three sentences max in the main pitch.
- Product cards render below your reply automatically when you pitch — name the product naturally in your prose so the card has context above it.
- No checkout URLs in chat. PDP URLs are okay as bare text or inline links of the form /products/<handle>.`

interface ChannelTuning {
  rules: string
  maxTokens: number
}

function tuningFor(channel: 'sms' | 'voice' | 'web'): ChannelTuning {
  if (channel === 'voice') return { rules: DISCOVERY_RULES_VOICE, maxTokens: MAX_TOKENS_SMS_VOICE }
  if (channel === 'web') return { rules: DISCOVERY_RULES_WEB, maxTokens: MAX_TOKENS_WEB }
  return { rules: DISCOVERY_RULES_SMS, maxTokens: MAX_TOKENS_SMS_VOICE }
}

function buildSystemPrompt(channel: 'sms' | 'voice' | 'web'): string {
  const tuning = tuningFor(channel)
  return `${BRAND_VOICE}\n\n${DISCOVERY_RULES_CORE}\n\n${tuning.rules}`
}

// ─── Fabrication guard ───────────────────────────────────────────────────────

const PDP_URL_RE = /(https?:\/\/)?xdipx\.com\/products\/([a-z0-9][a-z0-9-]*)/gi
// Match any cart/checkout URL — discovery never builds these, so anything is
// fabricated by definition.
const CHECKOUT_URL_RE =
  /https?:\/\/[^\s)]*?(?:myshopify\.com\/cart|\/cart\/|\/checkouts?\/)\S*/gi

interface FabricationGuardResult {
  text: string
  caught: string | undefined
}

/**
 * Strip URLs the agent shouldn't have included:
 *   - PDP URLs whose handle wasn't in the real-handles set (= invented).
 *   - Any cart/checkout URL — discovery doesn't issue checkouts.
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
    // Tidy any double-spaces / orphan punctuation left behind.
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
 * The agent has pitched a product when its reply text mentions either the
 * product's title or its handle. We scan for both — the title catches
 * natural-language mentions ("the Lovense Osci 3"), the handle catches PDP-URL
 * mentions ("xdipx.com/products/lovense-osci-3").
 *
 * If multiple cards match, prefer the one whose handle appears in a PDP URL
 * (most direct signal the agent pitched it). Otherwise fall back to the first
 * title match.
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

  // Second pass: title mention. Strip punctuation around the title so a
  // common-token title still matches when followed by punctuation.
  for (const card of cards) {
    if (!card.title) continue
    const titleLower = card.title.toLowerCase().trim()
    if (titleLower.length > 0 && lower.includes(titleLower)) return card
  }

  return undefined
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export async function executeDiscoveryAgent(
  ctx: EmmaContext,
  intent: IntentResult,
  customerText: string,
): Promise<StageResponse> {
  const channel: 'sms' | 'voice' | 'web' = ctx.channel ?? 'sms'

  const baseTelemetry: StageResponse['telemetry'] = {
    intent: intent.intent,
    intentConfidence: intent.confidence,
  }

  // ── Build messages ────────────────────────────────────────────────────────
  // History plus the current inbound. We never persist the agent's reply here;
  // the caller (processor) is responsible for that via sms_turns insert.
  let history: HistoryTurn[] = []
  try {
    history = await loadConversationHistory(ctx.conversation.conversationId, HISTORY_LIMIT)
  } catch (err) {
    console.warn('[discovery-agent] failed to load history, continuing with empty', err)
  }

  const messages: Anthropic.MessageParam[] = [
    ...history.map((t) => ({ role: t.role, content: t.text })),
    { role: 'user' as const, content: customerText },
  ]

  // ── Build system + tools ──────────────────────────────────────────────────
  const tuning = tuningFor(channel)
  const systemText = buildSystemPrompt(channel)
  // Cache the system block — it's stable across turns within a conversation
  // and changes only when the channel does. Anthropic's ephemeral cache keeps
  // it warm for ~5min, which covers any single user's interaction.
  const systemParam: Anthropic.TextBlockParam[] = [
    { type: 'text', text: systemText, cache_control: { type: 'ephemeral' } },
  ]

  // ── Card accumulator + telemetry ──────────────────────────────────────────
  // Cards from EVERY searchProducts hop in this turn — we use them later to
  // (a) build the real-handles set for the fabrication guard, and (b) detect
  // which product the agent pitched (if any).
  const cardsByToolUseId = new Map<string, IvrProductCard[]>()
  const realHandles = new Set<string>()
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
        // Re-add the assistant's tool_use turn to the message stream and run
        // each tool. Tool errors come back to the model as is_error: true so
        // it can adapt rather than crashing — same pattern as chat.server.ts.
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

      // stop_reason === 'end_turn' (or anything else terminal) — pull the text.
      const textBlock = res.content.find(
        (b): b is Anthropic.TextBlock => b.type === 'text',
      )
      finalText = (textBlock?.text ?? '').trim()
      break
    }
  } catch (err) {
    console.error('[discovery-agent] Sonnet call failed', err)
    return safeFallback(ctx, baseTelemetry)
  }

  if (!finalText) {
    // Out of hops or model produced no text — return a graceful fallback.
    return safeFallback(ctx, baseTelemetry)
  }

  // ── Fabrication guard ─────────────────────────────────────────────────────
  const guarded = applyFabricationGuard(finalText, realHandles)
  const finalProse = guarded.text || finalText // never ship empty

  // ── Detect pitched product ───────────────────────────────────────────────
  const allCards: IvrProductCard[] = []
  for (const list of cardsByToolUseId.values()) {
    allCards.push(...list)
  }
  const pitched = detectPitchedCard(finalProse, allCards)

  // ── Build StageResponse ───────────────────────────────────────────────────
  const stageOut = pitched
    ? resolveTransition('DISCOVERY', 'PRESENTATION')
    : resolveTransition('DISCOVERY', 'DISCOVERY')

  const stateWrites: ConversationStateWrites = {
    stage: stageOut,
    ...(pitched
      ? { currentPitchHandle: pitched.handle }
      : {}),
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
 * Returned when the Anthropic call throws or yields no text. Stays in
 * DISCOVERY so the next turn lets the customer re-state their need.
 */
function safeFallback(
  ctx: EmmaContext,
  baseTelemetry: StageResponse['telemetry'],
): StageResponse {
  void ctx
  return {
    stageOut: resolveTransition('DISCOVERY', 'DISCOVERY'),
    goalAchieved: false,
    segments: [
      {
        prose:
          "Tell me a little more about what you're looking for and I'll find something that fits.",
      },
    ],
    stateWrites: {
      stage: 'DISCOVERY',
    },
    telemetry: {
      ...baseTelemetry,
      inputTokens: 0,
      outputTokens: 0,
    },
  }
}
