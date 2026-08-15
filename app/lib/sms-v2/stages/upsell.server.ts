/**
 * app/lib/sms-v2/stages/upsell.server.ts
 *
 * Phase 3 — UPSELL stage handler.
 *
 * No free-form LLM. Server picks the accessory deterministically and fills
 * pre-written templates. The customer response (UPSELL_ACCEPT / UPSELL_DECLINE)
 * is handled by the orchestrator dispatcher on the NEXT turn, not here.
 *
 * This turn's job:
 *   1. Pick an accessory query from the current pitch product's type/tags.
 *   2. Call searchForIvr({ query, limit: 5 }) — margin-weighted variety built in.
 *   3. Take the first result. If empty, short-circuit to CHECKOUT with a
 *      "anything else?" fallback.
 *   4. Fill a templated prose variant — no invented product names or prices.
 *   5. Return a StageResponse with stageOut: 'UPSELL' so we wait for
 *      the customer's accept/decline on the next turn.
 */
import { searchForIvr as _searchForIvr } from '~/lib/ivr-search.server'
import type { IvrProductCard, IvrSearchOpts } from '~/lib/ivr-search.server'
import { getProductByHandle } from '~/lib/shopify.server'
import { resolveTransition } from '../transitions.server'
import { pickUpsellTemplate } from '../templates/upsell-templates'
import type { EmmaContext, IntentResult, StageResponse, ProductRef } from '../types.server'

// ─── Injectable search function (for testing) ────────────────────────────────

/**
 * Override in tests via executeUpsellStage(ctx, intent, text, { searchFn }).
 * Accepts the full IvrSearchOpts so the upsell handler can pass productTypeDial
 * (and any future filter) to constrain results to a specific catalog category.
 */
export type SearchForIvrFn = (opts: IvrSearchOpts) => Promise<IvrProductCard[]>

export interface UpsellStageOverrides {
  searchFn?: SearchForIvrFn
}

// ─── Accessory query mapping ──────────────────────────────────────────────────

/**
 * Map a pitched product handle to the best accessory search query.
 *
 * Resolution order:
 *   1. Fetch the product from Shopify to read tags.
 *   2. Match tags against known type buckets.
 *   3. Fallback to a safe lube query if nothing matches.
 *
 * Tag buckets (lowercase Shopify tags checked with .includes()):
 *   - anal / butt / prostate / plug → 'anal lube'
 *   - silicone                      → 'water-based lube'
 *   - default                       → 'water-based lube'
 */
export async function pickAccessoryQuery(mainHandle: string): Promise<string> {
  try {
    const product = await getProductByHandle(mainHandle)
    if (!product) return 'water-based lube'

    const tagsLower = product.tags.map((t) => t.toLowerCase())

    const isAnal = tagsLower.some(
      (t) => t.includes('anal') || t.includes('butt') || t.includes('prostate') || t.includes('plug'),
    )
    if (isAnal) return 'anal lube'

    const isSilicone = tagsLower.some((t) => t.includes('silicone'))
    if (isSilicone) return 'water-based lube'

    // Lube, wand, wear, or unknown — default safe recommendation
    return 'water-based lube'
  } catch {
    return 'water-based lube'
  }
}

// ─── Price formatter ──────────────────────────────────────────────────────────

function formatPrice(price: number): string {
  if (price === Math.floor(price)) return `$${price}`
  return `$${price.toFixed(2)}`
}

// ─── Pitched-handles log ──────────────────────────────────────────────────────

/**
 * Append a handle to the rolling pitched-handles log, most-recent last, capped
 * at 10 — the same shape and cap the conversation agent writes for PRESENTATION
 * pitches (migration 032). The UPSELL stage is a deterministic template path
 * that never ran the agent, so it never recorded its pitch here (#3217); this is
 * that record.
 */
export function appendPitchedHandle(log: readonly string[], handle: string): string[] {
  const next = [...log, handle]
  return next.length > 10 ? next.slice(next.length - 10) : next
}

// ─── Stage handler ────────────────────────────────────────────────────────────

export async function executeUpsellStage(
  ctx: EmmaContext,
  intent: IntentResult,
  _customerText: string, // unused for UPSELL pitch turn — kept for signature consistency
  overrides?: UpsellStageOverrides,
): Promise<StageResponse> {
  const searchFn: SearchForIvrFn = overrides?.searchFn ?? _searchForIvr
  const mainHandle = ctx.conversation.currentPitchHandle

  // Guard: no pitched product — skip ahead to CHECKOUT
  if (!mainHandle) {
    return {
      stageOut: resolveTransition('UPSELL', 'CHECKOUT'),
      goalAchieved: false,
      segments: [
        {
          prose: 'Anything else, or want me to grab the link?',
        },
      ],
      stateWrites: {},
      telemetry: {
        intent: intent.intent,
        intentConfidence: intent.confidence,
        toolCalls: [],
      },
    }
  }

  // Step 1: pick accessory search query based on main product's type
  const query = await pickAccessoryQuery(mainHandle)

  // Step 2: call searchForIvr (margin-weighted random selection is built in).
  //
  // productTypeDial='lube' is REQUIRED here. Without it a query like
  // "anal lube" matches any product with "anal" or "lube" in title/tagline,
  // and the margin-weighted ranker happily surfaces a higher-margin butt
  // plug above the actual lubes. We always upsell a lube in this stage
  // (pickAccessoryQuery returns 'anal lube' / 'water-based lube' on every
  // path), so constraining to productTypeDial='lube' is universally correct.
  // Caught in production when an Aneros pitch upsold a Hush 2 plug.
  const searchInput: IvrSearchOpts = { query, limit: 5, productTypeDial: 'lube' }
  let searchResults: IvrProductCard[] = []
  let searchOk = true
  let searchError: string | undefined

  try {
    searchResults = await searchFn(searchInput)
  } catch (err) {
    searchOk = false
    searchError = err instanceof Error ? err.message : String(err)
    console.error('[upsell.server] searchForIvr failed:', err)
  }

  const toolCalls = [
    {
      name: 'searchForIvr',
      input: searchInput,
      ok: searchOk,
      ...(searchError ? { error: searchError } : {}),
    },
  ]

  // Repeat-pitch dedup (#3217). The UPSELL stage bypasses the conversation
  // agent's tool-wrapper dedup, so it must filter its own results against the
  // pitched-handles log and record what it pitches. Without this the repeat-pitch
  // guard is blind to every upsell: on 2026-08-14 Jelle Plus was pitched in turn
  // 1560 and re-pitched verbatim in turn 1562, with search_repeated_pitch FALSE
  // the whole time because nothing ever wrote the upsell pitch to the log.
  const pitchedLog = ctx.conversation.pitchedHandlesLog ?? []
  const pitchedSet = new Set(pitchedLog.map((h) => h.toLowerCase()))
  const freshResults = searchResults.filter((c) => !pitchedSet.has(c.handle.toLowerCase()))
  // searchForIvr returned candidates but every one was already pitched. Do not
  // re-offer; record the signal the dedup filter was missing on this turn.
  const allRepeats = searchResults.length > 0 && freshResults.length === 0

  // Step 3: no fresh accessory (none found, or all already pitched) — short-circuit
  // to CHECKOUT rather than re-pitching something the caller already heard.
  if (freshResults.length === 0) {
    return {
      stageOut: resolveTransition('UPSELL', 'CHECKOUT'),
      goalAchieved: false,
      segments: [
        {
          prose: 'Anything else, or want me to grab the link?',
        },
      ],
      stateWrites: {},
      telemetry: {
        intent: intent.intent,
        intentConfidence: intent.confidence,
        toolCalls,
        ...(allRepeats && { searchRepeatedPitch: true }),
      },
    }
  }

  // Step 4: take the first (margin-weighted) fresh result and build the ProductRef
  const accessory = freshResults[0]!
  const pdpUrl = `https://xdipx.com/products/${accessory.handle}`

  // Fetch image URL from Shopify (IvrProductCard doesn't carry image)
  let imageUrl: string | undefined
  try {
    const fullProduct = await getProductByHandle(accessory.handle)
    imageUrl = fullProduct?.images?.[0]?.url
  } catch {
    // non-fatal — MMS image is optional
  }

  const priceStr = formatPrice(accessory.price)

  const productCard: ProductRef = {
    handle: accessory.handle,
    title: accessory.title,
    price: priceStr,
    pdpUrl,
    ...(imageUrl ? { imageUrl } : {}),
  }

  // Step 5: fill a template variant — channel-aware so voice gets a
  // TTS-friendly variant (no URLs, no emoji, natural spoken closer) instead
  // of the SMS template ("👍 / 'yes' to toss it in") which TTS reads as
  // garbage. The voice adapter's permission gate picks up productCard.pdpUrl
  // separately and handles the link-text permission flow on the NEXT turn.
  const channel = ctx.channel ?? 'sms'
  // #3218: key the closer to this session's pitch ordinal (how many products
  // already pitched) so two different accessories in one conversation never get
  // the identical closer sentence.
  const prose = pickUpsellTemplate(
    {
      name: accessory.title,
      price: priceStr,
      pdpUrl,
    },
    channel,
    pitchedLog.length,
  )

  // Step 6: return with stageOut: 'UPSELL' — wait for accept/decline next turn
  // Web chat surfaces pill options as tap chips below the reply. SMS/voice
  // can't render pills, so pillOptions stay empty for those channels.
  const segment: StageResponse['segments'][number] = {
    prose,
    productCard,
  }
  if (channel === 'web') {
    segment.pillOptions = ['Add it', 'No thanks']
  }
  return {
    stageOut: 'UPSELL',
    goalAchieved: false,
    segments: [segment],
    stateWrites: {
      currentUpsellHandle: accessory.handle,
      // #3217: record the upsell pitch so the repeat-pitch guard can see it on
      // the next turn and this call. Filtered above, so it is never a duplicate.
      pitchedHandlesLog: appendPitchedHandle(pitchedLog, accessory.handle),
    },
    telemetry: {
      intent: intent.intent,
      intentConfidence: intent.confidence,
      toolCalls,
    },
  }
}
