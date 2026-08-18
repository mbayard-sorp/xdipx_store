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
import { getProductByHandle, getCuratedUpsellCandidates } from '~/lib/shopify.server'
import type { CuratedUpsellData } from '~/lib/shopify.server'
import { resolveTransition } from '../transitions.server'
import { pickUpsellTemplate, renderCuratedUpsellTemplate } from '../templates/upsell-templates'
import type { EmmaContext, IntentResult, StageResponse, ProductRef } from '../types.server'

// ─── Injectable dependencies (for testing) ───────────────────────────────────

/**
 * Override in tests via executeUpsellStage(ctx, intent, text, { searchFn }).
 * Accepts the full IvrSearchOpts so the upsell handler can pass productTypeDial
 * (and any future filter) to constrain results to a specific catalog category.
 */
export type SearchForIvrFn = (opts: IvrSearchOpts) => Promise<IvrProductCard[]>

/** Override in tests to inject curated attach candidates without hitting Shopify. */
export type AttachSourceFn = (pitchedHandle: string) => Promise<CuratedUpsellData>

export interface UpsellStageOverrides {
  searchFn?: SearchForIvrFn
  attachFn?: AttachSourceFn
}

// ─── Category-aware lube fallback ─────────────────────────────────────────────

/**
 * Pick the lube fallback query when the pitched product has no curated
 * accessory (#3516). Only anal/insertable pitches get an anal lube; everything
 * else gets water-based lube and, critically, anal-lube search results are
 * dropped downstream (`isAnalLubeCard`) so a cock-ring buyer is never pitched
 * anal lube — the exact production failure (call CA27c5008a, 2026-08-15) this
 * replaces.
 *
 * `allowAnal` gates the result filter; `query` seeds the search.
 */
export function pickLubeFallback(
  tagsLower: readonly string[],
  typeDial?: string,
): { query: string; allowAnal: boolean } {
  const isAnal =
    typeDial === 'anal' ||
    tagsLower.some(
      (t) => t.includes('anal') || t.includes('butt') || t.includes('prostate') || t.includes('plug'),
    )
  return isAnal ? { query: 'anal lube', allowAnal: true } : { query: 'water-based lube', allowAnal: false }
}

/**
 * True when a search result is an anal-specific product. Used to drop anal
 * lubes from the candidate set for a non-anal pitch (#3516). Checks the fields
 * an IvrProductCard actually carries (title/handle/category/tagline) with a
 * word-boundary match so "analog" or "canal" never trip it.
 */
export function isAnalLubeCard(card: IvrProductCard): boolean {
  const hay = `${card.title} ${card.handle} ${card.category ?? ''} ${card.tagline ?? ''}`.toLowerCase()
  return /\banal\b/.test(hay) || hay.includes('prostate') || hay.includes('butt plug')
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
  // Rule 3e: this pitch turn is a DELIBERATE deterministic path (like
  // checkout.server.ts), and it does not absorb foreign intents by ignoring
  // them — pickEffectiveStage (#3214) routes NAME_ITEM/RESEARCH → DISCOVERY and
  // OBJECTION → OBJECTION BEFORE this handler ever runs, so a customer who has
  // left the accept/decline script never reaches here. The remaining intents
  // (COMMIT_PICK opening the upsell, or accept/decline on the next turn) carry
  // no product selection for this turn, so the raw text is not consumed.
  _customerText: string,
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

  // Resolve the attach source once: the pitched product's curated
  // accessory_product_ids (primary) plus its tags/dial for the lube fallback.
  const attachFn: AttachSourceFn = overrides?.attachFn ?? getCuratedUpsellCandidates
  const channel = ctx.channel ?? 'sms'
  const pitchedLog = ctx.conversation.pitchedHandlesLog ?? []
  const pitchedSet = new Set(pitchedLog.map((h) => h.toLowerCase()))

  const attach = await attachFn(mainHandle)

  // Build the pitch response for a chosen accessory. Shared by the curated and
  // fallback paths so the ProductRef, MMS image fetch, closer selection, dedup
  // log append, and web pill options stay identical on both.
  async function buildPitch(
    pick: { handle: string; title: string; price: number; blurb?: string },
    toolCalls: StageResponse['telemetry']['toolCalls'],
  ): Promise<StageResponse> {
    const pdpUrl = `https://xdipx.com/products/${pick.handle}`

    // Fetch image URL from Shopify (IvrProductCard / curated candidate don't
    // carry an image). Non-fatal — the MMS image is optional. The same fetch
    // yields real availability, so we thread stock rather than assume it (#3542);
    // a failed/absent fetch resolves to false — never assert unchecked stock.
    let imageUrl: string | undefined
    let inStock = false
    try {
      const fullProduct = await getProductByHandle(pick.handle)
      imageUrl = fullProduct?.images?.[0]?.url
      inStock = fullProduct?.variants.some(v => v.availableForSale) ?? false
    } catch {
      // non-fatal
    }

    const priceStr = formatPrice(pick.price)
    const productCard: ProductRef = {
      handle: pick.handle,
      title: pick.title,
      price: priceStr,
      pdpUrl,
      inStock,
      ...(imageUrl ? { imageUrl } : {}),
    }

    // Channel-aware prose. A curated pairing_why blurb (#3516) leads with the
    // product-specific rationale in Emma's voice; with no blurb, fall back to
    // the rotating template keyed to this session's pitch ordinal (#3218) so
    // two accessories in one conversation never share a closer.
    const prose = pick.blurb
      ? renderCuratedUpsellTemplate({ name: pick.title, price: priceStr, pdpUrl }, pick.blurb, channel)
      : pickUpsellTemplate({ name: pick.title, price: priceStr, pdpUrl }, channel, pitchedLog.length)

    // Web chat surfaces pill options as tap chips below the reply. SMS/voice
    // can't render pills, so pillOptions stay empty for those channels.
    const segment: StageResponse['segments'][number] = { prose, productCard }
    if (channel === 'web') segment.pillOptions = ['Add it', 'No thanks']

    return {
      stageOut: 'UPSELL',
      goalAchieved: false,
      segments: [segment],
      stateWrites: {
        currentUpsellHandle: pick.handle,
        // #3217: record the pitch so the repeat-pitch guard sees it next turn.
        pitchedHandlesLog: appendPitchedHandle(pitchedLog, pick.handle),
      },
      telemetry: {
        intent: intent.intent,
        intentConfidence: intent.confidence,
        toolCalls,
      },
    }
  }

  const curatedToolCall = { name: 'getCuratedUpsellCandidates', input: { handle: mainHandle }, ok: true }

  // ─── Primary: curated accessory_product_ids (#3516) ────────────────────────
  // The pitched product's editorial attach list — in stock and not already
  // pitched. This is the point of the ticket: a real curated pairing (with its
  // pairing_why aside) instead of a category-guessed lube on every path.
  const freshCurated = attach.candidates.filter(
    (c) => c.inStock && !pitchedSet.has(c.handle.toLowerCase()),
  )
  if (freshCurated.length > 0) {
    const pick = freshCurated[0]!
    return buildPitch(
      {
        handle: pick.handle,
        title: pick.title,
        price: pick.price,
        ...(pick.pairingWhy ? { blurb: pick.pairingWhy } : {}),
      },
      [curatedToolCall],
    )
  }

  // ─── Fallback: category-aware lube search ──────────────────────────────────
  // No curated accessory available (none authored, out of stock, or all already
  // pitched). Search a lube keyed to the pitched product's category so a
  // NON-anal pitch never gets an anal lube (#3516).
  const { query, allowAnal } = pickLubeFallback(attach.pitchedTags, attach.pitchedTypeDial)

  // productTypeDial='lube' keeps the margin ranker from surfacing a higher-margin
  // plug above the actual lubes (an Aneros pitch once upsold a Hush 2 plug).
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
    curatedToolCall,
    { name: 'searchForIvr', input: searchInput, ok: searchOk, ...(searchError ? { error: searchError } : {}) },
  ]

  // Drop anal-specific results for a non-anal pitch BEFORE dedup, so a cock-ring
  // buyer is never offered anal lube (#3516). allowAnal is true only for an
  // anal/insertable pitch, where an anal lube is the correct attach.
  const categoryFiltered = allowAnal ? searchResults : searchResults.filter((c) => !isAnalLubeCard(c))

  // Repeat-pitch dedup (#3217): filter against the pitched-handles log so an
  // already-offered lube is never re-pitched.
  const freshResults = categoryFiltered.filter((c) => !pitchedSet.has(c.handle.toLowerCase()))
  // Candidates existed after the category filter but every one was already
  // pitched — record the signal the dedup filter was missing (#3217). A set
  // emptied purely by the category filter is "no appropriate lube", not a repeat.
  const allRepeats = categoryFiltered.length > 0 && freshResults.length === 0

  // No fresh accessory — short-circuit to CHECKOUT rather than re-pitching or
  // offering an inappropriate lube.
  if (freshResults.length === 0) {
    return {
      stageOut: resolveTransition('UPSELL', 'CHECKOUT'),
      goalAchieved: false,
      segments: [{ prose: 'Anything else, or want me to grab the link?' }],
      stateWrites: {},
      telemetry: {
        intent: intent.intent,
        intentConfidence: intent.confidence,
        toolCalls,
        ...(allRepeats && { searchRepeatedPitch: true }),
      },
    }
  }

  const accessory = freshResults[0]!
  return buildPitch(
    { handle: accessory.handle, title: accessory.title, price: accessory.price },
    toolCalls,
  )
}
