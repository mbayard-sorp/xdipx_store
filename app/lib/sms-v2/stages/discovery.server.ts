/**
 * app/lib/sms-v2/stages/discovery.server.ts
 *
 * DISCOVERY stage handler — gate-state machine rewrite.
 *
 * Branch dispatch order (highest priority first):
 *   Branch 0 — Vulnerability soft-beat: acknowledge, normalize, invite. No gate advance.
 *   Branch 4 — Advice side-trip: suspend gate, serve category explainer.
 *   Branch 2 — Ready to search: gate says searchNow OR question===null.
 *   Branch 1 — Gate progression: serve the next gate question (MOOD / WHO / MATTERS).
 *
 * Branch 3 note: high-stakes category + audience unknown is handled implicitly by
 * advanceGate() returning gate=WHO, which Branch 1 routes to a who-question.
 * There is no explicit Branch 3 code block here.
 *
 * NAME_ITEM intent: no longer a special code path. The slot extractor extracts
 * category/subtype from the named noun; advanceGate decides whether that is enough
 * to search (Branch 2) or whether a gate question is needed first (Branch 1).
 * This is identical behavior to the old Path B, plus audience/subtype filtering.
 */

import {
  advanceGate,
  mergeSlots,
  initDiscoveryState,
  suspendForExplain,
  SKIP_SENTINEL,
  type DiscoveryState,
  type DiscoverySlots,
} from '../discovery-gate.server'
import { extractSlots } from '../slot-extractor.server'
import { pickMoodOpener, type MoodOpenerTrigger } from '../templates/mood-opener-bank'
import { pickWho, WHO_BANK, type WhoTrigger } from '../templates/who-bank'
import { pickMatters, type MattersTrigger } from '../templates/matters-bank'
import { pickVulnerability, type VulnerabilityTrigger } from '../templates/vulnerability-bank'
import { getExplainer, type ExplainerCategory } from '../templates/category-explainers'
import { searchForIvrWithDiagnostics, STRICT_CATEGORY_TERMS } from '~/lib/ivr-search.server'
import { resolveTransition } from '../transitions.server'
import { executePresentationStage } from './presentation.server'
import { generateDiscoveryWelcome } from '../discovery-welcome.server'
import { pickDiscoveryAgentVersion } from '../discovery-agent-flag.server'
import { executeDiscoveryAgent } from '../discovery-agent.server'
import type { EmmaContext, IntentResult, StageResponse } from '../types.server'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Infer vulnerability trigger from customer text.
 * Called only when slots.vulnerabilitySignaled === true.
 */
function inferVulnerabilityTrigger(customerText: string): VulnerabilityTrigger {
  const norm = customerText.toLowerCase()

  if (/embarrass(ed|ing)/.test(norm)) return 'embarrassed'
  if (/never\s+(done|bought)|haven'?t\s+done\s+this/.test(norm)) return 'never-done-this'
  if (/after\s+(surgery|my\s+surgery)|post[- ]?partum|post[- ]?surgery|having\s+a\s+baby/.test(norm))
    return 'after-health-thing'
  if (/haven'?t\s+been\s+with\s+anyone\s+in|haven'?t\s+had\s+sex\s+in|long[- ]?(?:pause|time\s+since)/.test(norm))
    return 'long-pause'
  if (/don'?t\s+know\s+what\s+i'?m\s+doing/.test(norm)) return 'dont-know-what-im-doing'
  if (/body|fit\s+my\s+body/.test(norm)) return 'body-image'
  if (/performance|doesn'?t\s+happen/.test(norm)) return 'performance-worry'
  if (/partner\s+had|specific\s+need|mobility|disability/.test(norm)) return 'partner-specific-need'

  return 'never-done-this'
}

/**
 * Infer mood-opener trigger from customer text and prior slots.
 */
function inferMoodTrigger(customerText: string, _slots: Partial<DiscoverySlots>): MoodOpenerTrigger {
  const norm = customerText.toLowerCase()

  if (/first\s+time|new\s+to/.test(norm)) return 'first-time'
  if (/\bgift\b|\bpresent\b/.test(norm)) return 'gift'
  if (/for\s+us\b|for\s+both\b/.test(norm)) return 'romantic'
  if (/what'?s?\s+good|just\s+(looking|browsing)/.test(norm)) return 'browse'
  if (/embarrass(ed|ing)|scared/.test(norm)) return 'tender'
  if (/help\s+me\s+pick/.test(norm)) return 'help'
  if (/something\s+special/.test(norm)) return 'special'
  if (/\bcurious\b/.test(norm)) return 'curious'

  return 'vague'
}

/**
 * Infer who-question trigger from slots and customer text.
 */
function inferWhoTrigger(customerText: string, slots: Partial<DiscoverySlots>): WhoTrigger {
  const norm = customerText.toLowerCase()

  if (slots.audience === 'gift' && slots.giftWithNoRecipientHint) return 'gift-no-recipient'
  if (slots.audience === 'couples' || /\b(us|both|we|together)\b/.test(norm)) return 'couples'
  // gendered noun already captured AND audience already extracted — bridge to MATTERS
  if (
    slots.audience &&
    /\b(his|her|husband|wife|boyfriend|girlfriend)\b/.test(norm)
  ) {
    return 'gendered-acknowledged'
  }
  if (/\bpartner\b/.test(norm)) return 'partner-hinted'
  // Self-shopping ("for me" / "myself") — prefer the solo bank, which is
  // where the body-type-asking variant lives.
  if (
    /\b(?:for\s+me|for\s+myself|myself|just\s+me|on\s+my\s+own|personal\s+use|solo)\b/.test(norm) ||
    slots.audience === 'for-her' ||
    slots.audience === 'for-him'
  ) {
    return 'solo'
  }

  // Default — when no info points to partner / gift / couples / solo, the
  // safest WHO bank is solo. partner-hinted presupposes a partner the caller
  // may not have. Discovered during voice Stage D testing where the prior
  // partner-hinted default asked "is your partner in on this?" of a caller
  // who never mentioned a partner.
  return 'solo'
}

/**
 * Infer matters-question trigger from slots.
 */
function inferMattersTrigger(slots: Partial<DiscoverySlots>): MattersTrigger {
  if (slots.experience === 'first-time') return 'first-timer'
  if (slots.experience === 'experienced' || slots.experience === 'advanced') return 'experienced'
  if (slots.audience === 'gift') return 'gift-shopper'
  if (slots.audience === 'couples') return 'couples'
  if (slots.priceMax !== undefined) return 'budget-mentioned'

  return 'general'
}

/**
 * Map a ProductTypeDial value to an ExplainerCategory where one exists.
 * Returns undefined when no explainer is available for that category.
 */
function toExplainerCategory(
  category: DiscoverySlots['category'] | undefined,
): ExplainerCategory | undefined {
  if (!category) return undefined
  // Direct matches
  if (
    category === 'lube' ||
    category === 'vibrator' ||
    category === 'dildo' ||
    category === 'wear'
  ) {
    return category
  }
  // anal ProductTypeDial maps to 'plug' explainer
  if (category === 'anal') return 'plug'
  // vibrator subtypes — wand has its own explainer
  // (subtype check would require access to the subtype slot; handled by caller)
  return undefined
}

// ─── Branch 2 helpers ─────────────────────────────────────────────────────────

/**
 * Map audience slot value to the 'category' search filter.
 * 'gift' has no meaningful audience filter — pass undefined so we don't restrict.
 */
function audienceToSearchCategory(
  audience: DiscoverySlots['audience'] | undefined,
): string | undefined {
  if (!audience) return undefined
  if (audience === 'gift') return undefined
  // 'for-her' | 'for-him' | 'couples' pass through directly
  return audience
}

/**
 * Build a numbered-list prose string from search result cards.
 * Capped at 3. Stays in DISCOVERY so the customer's next reply is a fresh signal.
 */
export function buildMultiResultProse(
  cards: Awaited<ReturnType<typeof searchForIvrWithDiagnostics>>['cards'],
  channel: 'sms' | 'voice' | 'web' = 'sms',
): string {
  const capped = cards.slice(0, 3)
  // #3218: voice reads a numbered "1. … 2. … 3. …" list aloud as chat formatting
  // spoken on a call (the addendum wants short spoken turns, not enumerations —
  // turn 1551 read "1. Prowler 2. Prowler Plus 3. Revo Extreme"). On voice, speak
  // the options as one natural sentence with no numbers and no per-item link line.
  // SMS/web keep the tappable numbered list with PDP links.
  if (channel === 'voice') {
    // Match formatPrice (upsell.server.ts): whole dollars read cleaner aloud as
    // "$42" than "$42.00", and this keeps the voice price format consistent with
    // the VOICE_TEMPLATES bank rather than emitting raw two-decimal literals.
    const spokenPrice = (p: number) => (p === Math.floor(p) ? `$${p}` : `$${p.toFixed(2)}`)
    const spoken = capped.map((c) => `${c.title} at ${spokenPrice(c.price)}`)
    const joined =
      spoken.length <= 1
        ? (spoken[0] ?? '')
        : `${spoken.slice(0, -1).join(', ')}, or ${spoken[spoken.length - 1]}`
    return (
      `A few options that fit what you described. ${joined}. ` +
      `Which one sounds good, or tell me what would land better?`
    )
  }
  // conv-audit C7: emit ABSOLUTE https://xdipx.com/products/{handle} URLs (the
  // convention every other v2 stage follows; the web adapter relativizes them,
  // see adapters/web.server.ts) inside a Markdown link on its OWN line. On SMS,
  // stripMarkdownForSms collapses [label](url) to the bare url, so the link
  // lands alone on a line and splitProseAtUrl can pull the top result into its
  // own bubble for an iMessage preview. A relative path was neither tappable nor
  // preview-able on SMS and got read aloud on voice. Whitelisted CTA label; the
  // em-dash before the price is gone (brand rule). IvrProductCard.handle is a
  // non-optional string (ivr-search.server.ts:32).
  const lines = capped.map((c, i) =>
    `${i + 1}. ${c.title}, $${c.price.toFixed(2)}\n[Take a peek →](https://xdipx.com/products/${c.handle})`
  )
  return (
    `A few options that fit what you described:\n\n` +
    lines.join('\n') +
    `\n\nReply with the name (or describe what would land better).`
  )
}

// ─── Search query selection (conv-audit B2) ───────────────────────────────────

// Browse-scaffolding tokens: articles, pronouns, framing verbs, audience words,
// and price cues. Together with the category vocabulary (STRICT_CATEGORY_TERMS
// from ivr-search) these are the words a bare category browse is built from.
// Anything left after removing them is a specific signal — a brand, a model, a
// descriptor — that must survive into the keyword query.
const BROWSE_STOPWORDS = new Set([
  'a', 'an', 'the', 'some', 'any', 'this', 'that', 'these', 'those',
  'i', 'im', 'id', 'ive', 'you', 'we', 'me', 'my', 'us', 'our',
  'want', 'wanna', 'need', 'looking', 'look', 'for', 'got', 'have', 'has', 'had',
  'do', 'does', 'did', 'can', 'could', 'would', 'should', 'get', 'getting',
  'show', 'find', 'see', 'check', 'out', 'something', 'anything', 'stuff',
  'item', 'items', 'product', 'products', 'toy', 'toys',
  'please', 'pls', 'plz', 'hey', 'hi', 'hello', 'thanks', 'thx', 'ok', 'okay',
  'to', 'and', 'or', 'of', 'with', 'without', 'in', 'on', 'is', 'are', 'be',
  'good', 'best', 'nice', 'great', 'cool', 'fun', 'cheap', 'affordable',
  'buy', 'buying', 'shop', 'browse',
  // audience framing
  'her', 'him', 'she', 'he', 'girlfriend', 'boyfriend', 'wife', 'husband',
  'partner', 'partners', 'couple', 'couples', 'gift', 'present', 'someone',
  'myself', 'herself', 'himself', 'ourselves',
  // price cues
  'under', 'below', 'less', 'than', 'over', 'around', 'about', 'budget',
  'max', 'maximum', 'up', 'dollars', 'bucks',
])

function normalizeQueryTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Decide the keyword query for a discovery search (conv-audit B2).
 *
 * The old rule was `category ?? customerText`, which discarded any brand or
 * model the customer named: "Do you have the Lelo Sona 2?" became the literal
 * query "vibrator" (the extracted category), so the search never matched the
 * product's title or vendor and returned random margin-weighted vibrators.
 *
 * Rule: when the customer text carries tokens beyond the category vocabulary —
 * a brand, a model, a descriptor — search the full text so those tokens survive
 * into the title/vendor keyword match, and keep the category as a filter (it is
 * still passed separately as productTypeDial). When the text is a bare category
 * browse ("a vibrator", "got any lube"), the canonical category term is the
 * cleaner query and preserves ivr-search's strict-category precision path.
 * Returning the category term here is byte-identical to the old behavior for
 * that case, so bare browses are unchanged. With no extracted category, the
 * customer text is all we have.
 */
export function pickSearchQuery(
  customerText: string,
  category: DiscoverySlots['category'] | undefined,
): string {
  if (!category) return customerText
  const residual = normalizeQueryTokens(customerText).filter(
    (t) => !BROWSE_STOPWORDS.has(t) && !STRICT_CATEGORY_TERMS.has(t) && !/^\d+$/.test(t),
  )
  return residual.length > 0 ? customerText : category
}

// ─── Branch 2: search and respond ─────────────────────────────────────────────

export async function runSearchBranch(
  ctx: EmmaContext,
  intent: IntentResult,
  customerText: string,
  mergedSlots: Partial<DiscoverySlots>,
  currentDiscoveryState: DiscoveryState,
): Promise<StageResponse> {
  const searchCategory = audienceToSearchCategory(mergedSlots.audience)
  const searchQuery = pickSearchQuery(customerText, mergedSlots.category)

  // conv-audit B2: pass the customer's MATTERS answers through as mattersTags so
  // the gate question actually shapes results. mattersTags is a soft OR filter;
  // the filtered-to-zero retry variants below deliberately omit it, so a
  // preference that starves the pool is loosened on retry rather than blocking.
  const mattersTags = mergedSlots.matters

  let diag = await searchForIvrWithDiagnostics({
    query: searchQuery,
    productTypeDial: mergedSlots.category,
    productSubtypeDial: mergedSlots.subtype,
    category: searchCategory,
    priceMax: mergedSlots.priceMax,
    mattersTags,
    limit: 3,
  })

  // Handle filtered-to-zero: drop one filter and retry once.
  // Drop order: matters (priceMax here) > subtype > audience.
  if (diag.reason === 'filtered-to-zero') {
    let retryOpts: Parameters<typeof searchForIvrWithDiagnostics>[0] | null = null

    if (mergedSlots.priceMax !== undefined) {
      retryOpts = {
        query: searchQuery,
        productTypeDial: mergedSlots.category,
        productSubtypeDial: mergedSlots.subtype,
        category: searchCategory,
        limit: 3,
      }
    } else if (mergedSlots.subtype !== undefined) {
      retryOpts = {
        query: searchQuery,
        productTypeDial: mergedSlots.category,
        category: searchCategory,
        limit: 3,
      }
    } else if (searchCategory !== undefined) {
      retryOpts = {
        query: searchQuery,
        productTypeDial: mergedSlots.category,
        limit: 3,
      }
    }

    if (retryOpts) {
      diag = await searchForIvrWithDiagnostics(retryOpts)
    }

    // Last resort: drop the productTypeDial itself. The retries above never
    // remove the dial, so a single wrong dial classification (e.g. a wand
    // request tagged 'lube') keeps every matching product permanently
    // unreachable in SMS discovery. If we are still filtered to zero, retry
    // once more on the free-text query alone — dial, subtype, audience, and
    // priceMax all dropped — and log it so a misclassifying dial is visible.
    if (diag.reason === 'filtered-to-zero') {
      console.warn(
        `[discovery] filtered-to-zero after filter-drop retry; dropping productTypeDial=${mergedSlots.category ?? 'none'} and retrying on query text alone`,
      )
      diag = await searchForIvrWithDiagnostics({ query: searchQuery, limit: 3 })
    }
  }

  const baseWrites = {
    stage: 'DISCOVERY' as const,
    discoveryState: currentDiscoveryState,
    discoveredSlots: mergedSlots,
  }
  const baseTelemetry = {
    intent: intent.intent,
    intentConfidence: intent.confidence,
  }

  // Sanity unavailable — fall back to a plain "I'll look for something" bridge
  if (diag.reason === 'sanity-unavailable') {
    return {
      stageOut: resolveTransition('DISCOVERY', 'DISCOVERY'),
      goalAchieved: false,
      segments: [
        {
          prose: `I'm having a bit of trouble pulling results right now. Can you tell me a little more about what you're looking for and I'll find something that fits?`,
        },
      ],
      stateWrites: baseWrites,
      telemetry: { ...baseTelemetry, inputTokens: 0, outputTokens: 0 },
    }
  }

  // No base results at all
  if (diag.reason === 'no-base-results') {
    return {
      stageOut: resolveTransition('DISCOVERY', 'DISCOVERY'),
      goalAchieved: false,
      segments: [
        {
          prose: `I'm not finding anything matching that right now. Want me to try a different category or describe it differently?`,
        },
      ],
      stateWrites: baseWrites,
      telemetry: { ...baseTelemetry, inputTokens: 0, outputTokens: 0 },
    }
  }

  // Still zero after retry on filtered-to-zero
  if (diag.cards.length === 0) {
    return {
      stageOut: resolveTransition('DISCOVERY', 'DISCOVERY'),
      goalAchieved: false,
      segments: [
        {
          prose: `I'm coming up empty for that combo. Want me to widen the search, or try a different angle?`,
        },
      ],
      stateWrites: baseWrites,
      telemetry: { ...baseTelemetry, inputTokens: 0, outputTokens: 0 },
    }
  }

  // Multiple results: surface as a list, stay in DISCOVERY. Voice gets a natural
  // spoken sentence; SMS/web get the tappable numbered list (#3218).
  if (diag.cards.length > 1) {
    return {
      stageOut: resolveTransition('DISCOVERY', 'DISCOVERY'),
      goalAchieved: false,
      segments: [{ prose: buildMultiResultProse(diag.cards, ctx.channel ?? 'sms') }],
      stateWrites: baseWrites,
      telemetry: { ...baseTelemetry, inputTokens: 0, outputTokens: 0 },
    }
  }

  // Single match: inline-pitch via PRESENTATION
  const candidate = diag.cards[0]!

  const patchedCtx: EmmaContext = {
    ...ctx,
    conversation: {
      ...ctx.conversation,
      currentPitchHandle: candidate.handle,
    },
  }

  try {
    const presentationResp = await executePresentationStage(patchedCtx, intent, customerText)
    return {
      ...presentationResp,
      stateWrites: {
        ...presentationResp.stateWrites,
        currentPitchHandle: candidate.handle,
        discoveryState: currentDiscoveryState,
        discoveredSlots: mergedSlots,
      },
    }
  } catch (err) {
    console.error('[discovery] inline PRESENTATION failed, bridging to PRESENTATION stage', err)
    return {
      stageOut: resolveTransition('DISCOVERY', 'PRESENTATION'),
      goalAchieved: false,
      segments: [{ prose: `Oh, I've got something for you. Give me just a sec.` }],
      stateWrites: {
        stage: 'PRESENTATION',
        currentPitchHandle: candidate.handle,
        discoveryState: currentDiscoveryState,
        discoveredSlots: mergedSlots,
      },
      telemetry: { ...baseTelemetry, inputTokens: 0, outputTokens: 0 },
    }
  }
}

/**
 * Product-question escape hatch for non-discovery stages (SUPPORT, RECONNECT).
 *
 * Those stages are deterministic and have no catalog access, so a "do you sell
 * X?" that arrives mid-support used to get an order-status template or a generic
 * greeting instead of an answer. This runs the same shared search the discovery
 * stage uses (runSearchBranch → searchForIvrWithDiagnostics), so the reply is
 * built only from real, MAP-priced catalog hits — never model memory — which is
 * the discovery agent's fabrication guard by construction.
 *
 * Slots come from the customer's text (plus any prior discovered slots); the
 * discovery state defaults to a fresh gate when the customer has never shopped.
 * runSearchBranch writes stage: 'DISCOVERY', so the customer continues shopping
 * from here — the same place the next-turn intent reclassification would have
 * routed them anyway, one turn sooner.
 */
export async function runCatalogLookup(
  ctx: EmmaContext,
  intent: IntentResult,
  customerText: string,
): Promise<StageResponse> {
  const priorSlots: Partial<DiscoverySlots> =
    (ctx.conversation.discoveredSlots as Partial<DiscoverySlots>) ?? {}
  const { slots: extracted } = await extractSlots({ text: customerText, priorSlots })
  const mergedSlots = mergeSlots(priorSlots, extracted)
  const discoveryState =
    (ctx.conversation.discoveryState as DiscoveryState | null) ?? initDiscoveryState()
  return runSearchBranch(ctx, intent, customerText, mergedSlots, discoveryState)
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * DISCOVERY entry point. Picks between the legacy gate-state-machine handler
 * (executeDiscoveryGate) and the Sonnet-driven agent (executeDiscoveryAgent)
 * based on the env-flag allowlist (`DISCOVERY_AGENT_VERSION`,
 * `DISCOVERY_AGENT_V2_PHONES`, `DISCOVERY_AGENT_V2_SESSIONS`).
 *
 * Default: 'v2-gate' → no behavior change in production. The Sonnet agent
 * only runs when the env flag is flipped or the caller is on the allowlist.
 */
export async function executeDiscoveryStage(
  ctx: EmmaContext,
  intent: IntentResult,
  customerText: string,
): Promise<StageResponse> {
  const version = pickDiscoveryAgentVersion(ctx.conversation.phone)
  if (version === 'v2-agent') {
    return executeDiscoveryAgent(ctx, intent, customerText)
  }
  return executeDiscoveryGate(ctx, intent, customerText)
}

/**
 * Legacy gate-state-machine DISCOVERY handler (Branches -1, 0, 1, 2, 4).
 * Renamed from `executeDiscoveryStage` so the new dispatcher above can sit on
 * top without a callers churn. Phase 6 cleanup deletes this body entirely
 * once the Sonnet agent has soaked.
 */
async function executeDiscoveryGate(
  ctx: EmmaContext,
  intent: IntentResult,
  customerText: string,
): Promise<StageResponse> {
  // ── Load current gate state from conversation ────────────────────────────────
  // discoveryState is stored as JSONB (unknown at the type level). Cast to the
  // discriminated union — advanceGate validates via its own rule 0 guard
  // (null current → initDiscoveryState) so a stale or empty value is safe.
  const currentDiscoveryState =
    (ctx.conversation.discoveryState as DiscoveryState | null) ?? null
  const priorSlots: Partial<DiscoverySlots> = ctx.conversation.discoveredSlots as Partial<DiscoverySlots> ?? {}

  // ── Extract slots from this message ─────────────────────────────────────────
  const extractResult = await extractSlots({ text: customerText, priorSlots })
  const extractedSlots = extractResult.slots

  // ── Advance the gate machine with extracted slots ────────────────────────────
  const adv = advanceGate(currentDiscoveryState, extractedSlots)
  const mergedSlots = mergeSlots(priorSlots, extractedSlots)

  // ── Migration 036: gate-advance telemetry for SMS skip-rate analytics ───────
  // Computed once here, then attached to every telemetry object returned from
  // this function. Written to sms_turns.metadata.gateAdvance via the processor.
  const gateAdvance = {
    from: (currentDiscoveryState?.gate ?? null) as
      'MOOD' | 'WHO' | 'MATTERS' | 'READY' | 'EXPLAIN' | null,
    to: adv.nextState.gate,
    // The skip sentinel only ever rides on `mood` per discovery-gate.server.ts.
    skipped: (extractedSlots.mood?.includes(SKIP_SENTINEL) ?? false) ||
             (mergedSlots.mood?.includes(SKIP_SENTINEL) ?? false),
    // Which slot was newly filled this turn (priorSlots → extractedSlots diff).
    slotFilled: (
      extractedSlots.mood     !== undefined && extractedSlots.mood     !== priorSlots.mood     ? 'mood'    :
      extractedSlots.audience !== undefined && extractedSlots.audience !== priorSlots.audience ? 'who'     :
      extractedSlots.matters  !== undefined && extractedSlots.matters  !== priorSlots.matters  ? 'matters' :
      null
    ) as 'mood' | 'who' | 'matters' | null,
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Branch -1 — WARM WELCOME (FIRST TURN)
  // When the discovery state is null (this is the customer's first turn in
  // a fresh discovery conversation), use a Haiku-generated personal welcome
  // instead of the static MOOD opener bank. The welcome:
  //   1. Sets a safe, non-judgmental tone for sexual-wellness shopping
  //   2. Branches on returning vs first-time customer
  //   3. Invites vulnerability without forcing it
  //   4. Asks ONE open mood/feeling/sensation question with concrete examples
  //
  // Skipped when:
  //   - vulnerability is signaled in this first message → Branch 0 handles
  //   - advice request in this first message → Branch 4 (explainer) handles
  // Both of those flows are more important than a generic warm welcome and
  // should run their own response.
  //
  // After this turn, discoveryState is non-null (initialized to MOOD with
  // whatever slots got extracted from the first message), so subsequent
  // turns route through the gate machine normally.
  // ─────────────────────────────────────────────────────────────────────────────
  // "First contact" includes BOTH:
  //   - Truly null discoveryState (brand-new conversation row).
  //   - Stale-but-empty state: gate=MOOD with no slots (an earlier session
  //     that initialized the row but never produced a welcome — e.g. a
  //     deploy-and-clear sequence where a row was created pre-welcome
  //     and then the welcome code shipped). Without this, returning users
  //     with abandoned empty sessions never see the welcome.
  const isStaleEmptyInit =
    currentDiscoveryState !== null &&
    currentDiscoveryState.gate === 'MOOD' &&
    Object.keys(currentDiscoveryState.slots ?? {}).length === 0 &&
    Object.keys(priorSlots ?? {}).length === 0
  if (
    (currentDiscoveryState === null || isStaleEmptyInit) &&
    mergedSlots.vulnerabilitySignaled !== true &&
    mergedSlots.isAdviceRequest !== true
  ) {
    const welcome = await generateDiscoveryWelcome({
      channel: ctx.channel ?? 'sms',
      customerFirstName: ctx.customer?.firstName ?? null,
      customerGid: ctx.customer?.gid ?? null,
      customerText,
    })
    const initialState: DiscoveryState = { gate: 'MOOD', slots: mergedSlots }
    return {
      stageOut: resolveTransition('DISCOVERY', 'DISCOVERY'),
      goalAchieved: false,
      segments: [{ prose: welcome.prose }],
      stateWrites: {
        stage: 'DISCOVERY',
        discoveryState: initialState,
        discoveredSlots: mergedSlots,
      },
      telemetry: {
        intent: intent.intent,
        intentConfidence: intent.confidence,
        inputTokens: welcome.inputTokens,
        outputTokens: welcome.outputTokens,
        gateAdvance,
      },
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Branch 0 — VULNERABILITY SOFT-BEAT
  // Takes precedence over everything, including Branch 4 (advice side-trip).
  // Does NOT advance the gate. Does NOT call search.
  // ─────────────────────────────────────────────────────────────────────────────
  if (mergedSlots.vulnerabilitySignaled === true) {
    const trigger = inferVulnerabilityTrigger(customerText)
    const entry = pickVulnerability(trigger, 'sms')

    return {
      stageOut: resolveTransition('DISCOVERY', 'DISCOVERY'),
      goalAchieved: false,
      segments: [{ prose: entry.prose }],
      stateWrites: {
        stage: 'DISCOVERY',
        // Gate state intentionally unchanged — vulnerability does not advance.
        discoveryState: currentDiscoveryState,
        discoveredSlots: mergedSlots,
      },
      telemetry: {
        intent: intent.intent,
        intentConfidence: intent.confidence,
        inputTokens: 0,
        outputTokens: 0,
        softBeat: true,
        gateAdvance,
      },
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Branch 4 — ADVICE SIDE-TRIP
  // Customer asked a "tell me about" question. Suspend the gate and serve the
  // category explainer. On the next turn resumeFromExplain() is called by the
  // caller (processor) and the gate picks up where it left off.
  // ─────────────────────────────────────────────────────────────────────────────
  if (mergedSlots.isAdviceRequest === true) {
    // Resolve explainer category from the extracted category slot.
    // Also handle 'wand' as a subtype of vibrator.
    let explainerCategory = toExplainerCategory(mergedSlots.category)
    if (!explainerCategory && mergedSlots.subtype === 'wand') {
      explainerCategory = 'wand'
    }

    if (explainerCategory) {
      const explainer = getExplainer(explainerCategory)
      if (explainer) {
        // Reconstruct the pre-explain state to suspend from
        const stateToSuspend = adv.nextState
        const suspendedState = suspendForExplain(stateToSuspend)

        return {
          stageOut: resolveTransition('DISCOVERY', 'DISCOVERY'),
          goalAchieved: false,
          segments: [{ prose: explainer.sms }],
          stateWrites: {
            stage: 'DISCOVERY',
            discoveryState: suspendedState,
            discoveredSlots: mergedSlots,
          },
          telemetry: {
            intent: intent.intent,
            intentConfidence: intent.confidence,
            inputTokens: 0,
            outputTokens: 0,
            gateAdvance,
          },
        }
      }
    }

    // Advice request but no category extracted (or no explainer available)
    return {
      stageOut: resolveTransition('DISCOVERY', 'DISCOVERY'),
      goalAchieved: false,
      segments: [
        {
          prose: `I can definitely help with that. Tell me a bit more, like which kind you're thinking about (lube, vibrators, plugs, etc.) and I'll walk through the options.`,
        },
      ],
      stateWrites: {
        stage: 'DISCOVERY',
        discoveryState: adv.nextState,
        discoveredSlots: mergedSlots,
      },
      telemetry: {
        intent: intent.intent,
        intentConfidence: intent.confidence,
        inputTokens: 0,
        outputTokens: 0,
        gateAdvance,
      },
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Branch 2 — READY TO SEARCH
  // Gate machine has enough signal (searchNow===true or question===null).
  // ─────────────────────────────────────────────────────────────────────────────
  if (adv.searchNow || adv.question === null) {
    return runSearchBranch(ctx, intent, customerText, mergedSlots, adv.nextState)
  }

  // Branch 2b — STUCK GATE ESCAPE VALVE
  // If we asked the same gate last turn and the gate machine wants to ask it
  // AGAIN, the customer's answer didn't parse into a slot the gate cares
  // about. The most common cause: free-form natural-language answers
  // ("vibrating", "feel good", "comfortable") that the matters regex doesn't
  // match. Looping on the same question is worse than searching with what
  // we have — as long as audience and category are known, the catalog
  // search has enough signal to surface candidates. Caught during voice
  // Stage D testing where a caller looped 3 turns on the MATTERS opener
  // before hanging up.
  if (
    currentDiscoveryState !== null &&
    currentDiscoveryState.gate === adv.nextState.gate &&
    currentDiscoveryState.gate !== 'EXPLAIN' &&
    !!mergedSlots.audience &&
    !!mergedSlots.category
  ) {
    return runSearchBranch(ctx, intent, customerText, mergedSlots, adv.nextState)
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Branch 1 — GATE PROGRESSION (default)
  // Serve the next gate question: MOOD, WHO, or MATTERS.
  // ─────────────────────────────────────────────────────────────────────────────

  const question = adv.question // non-null here per the Branch 2 guard above

  let questionProse: string

  if (question.prose === '<<MOOD>>') {
    const trigger = inferMoodTrigger(customerText, mergedSlots)
    const entry = pickMoodOpener(trigger, 'sms')
    questionProse = entry.prose + `\n\nOr just say 'show me' and I'll guess.`
  } else if (question.prose === '<<WHO>>') {
    const trigger = inferWhoTrigger(customerText, mergedSlots)
    // When audience is unknown, prefer the body-type-asking solo variant
    // (B-2f) over a random pick — it's the question that most directly
    // resolves the audience slot so the gate can advance. Random pickWho
    // gave us 1-in-6 odds of asking for the actual answer we needed,
    // which on voice translated to multiple turns of question loops.
    let entry
    if (trigger === 'solo' && !mergedSlots.audience) {
      const bodyAsker = WHO_BANK.find((e) => e.id === 'B-2f')
      entry = bodyAsker ?? pickWho(trigger, 'sms')
    } else {
      entry = pickWho(trigger, 'sms')
    }
    questionProse = entry.prose
  } else if (question.prose === '<<MATTERS>>') {
    const trigger = inferMattersTrigger(mergedSlots)
    const entry = pickMatters(trigger, 'sms')
    questionProse = entry.prose
  } else {
    // Unknown sentinel — fallback prose so we never send a raw placeholder
    questionProse = question.prose
  }

  return {
    stageOut: resolveTransition('DISCOVERY', 'DISCOVERY'),
    goalAchieved: false,
    segments: [{ prose: questionProse }],
    stateWrites: {
      stage: 'DISCOVERY',
      discoveryState: adv.nextState,
      discoveredSlots: mergedSlots,
    },
    telemetry: {
      intent: intent.intent,
      intentConfidence: intent.confidence,
      inputTokens: extractResult.haikuCalled ? undefined : 0,
      outputTokens: 0,
      gateAdvance,
    },
  }
}
