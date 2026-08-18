/**
 * Homepage precompute payload — Variant A ("Discovery Home").
 *
 * The live Variant A loader fans out to 5+ upstreams (Shopify, Sanity, Neon,
 * KV) at request time. On a cold instance during a Googlebot crawl that render
 * can abort before data is ready -> ErrorBoundary. This module ASSEMBLES the
 * full Variant A payload once (on rotation / cron warm) as a JSON-safe plain
 * object, stores it in KV (L1/L2) + a durable Neon row, and lets the indexable
 * request path read ONE precomputed blob instead of fanning out.
 *
 * JSON-safety is the load-bearing invariant: the blob round-trips through
 * KV (JSON.stringify) and a Neon JSON column. No Map/Set/Date/undefined may
 * ever enter the payload — that is the exact class of bug that poisoned the
 * sitemap (Set -> {}). `assertJsonSafe` is the gate.
 *
 * Server-only. Never import from a client component.
 */

import { eq } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { homepagePayload } from '../../db/schema'
import { kvGet, kvSet, kvDel } from '~/lib/kv.server'
import { withTimeout } from '~/lib/with-timeout.server'
import { getDiscoveryRails, getDiscoveryVocab } from '~/lib/discovery.server'
import { EMPTY_STATE } from '~/types/discovery'
import type { Rail } from '~/types/discovery'
import type { ChipAvailabilityArrays } from '~/lib/discovery-emma'
import { getHomepageSections } from '~/lib/sanity.server'
import { normalizeProductHandles } from '~/lib/product-handles'
import { getProductsByTag, getCollectionProducts, getProductsByHandles } from '~/lib/shopify.server'
import type { Product, LeanCardProduct, SensationDialV2 } from '~/types'
import type { DiscoveryProduct } from '~/types/discovery'
import type { ContentBlock, ProductCarouselBlock, EmmaCuratedRailBlock, PlayTogetherBannerBlock, EmmaHeroSettings, BlogPostCard, StorefrontHomeLayout, ResolvedPanelDeck } from '~/types/cms'
import type { CuriosityShelfData } from '~/types/curiosity'

/**
 * Bump on ANY shape change to `HomepagePayloadA` (mirrors INDEX_VERSION in
 * discovery.server.ts). Embedded in the KV key + stored in the Neon row so a
 * deploy with a new shape treats every old blob as a miss and self-heals on
 * the next warm — never serves a stale shape.
 */
export const HOMEPAGE_PAYLOAD_VERSION = 'v1'

/** KV key for the precomputed Variant A blob. Versioned. */
export const HOMEPAGE_PAYLOAD_KV_KEY = `homepage:payload:${HOMEPAGE_PAYLOAD_VERSION}`

/** KV-key PREFIX used by invalidateCache() to bust the L1 entry. */
export const HOMEPAGE_PAYLOAD_KV_PREFIX = 'homepage:payload'

// KV TTL — generous so the blob outlives normal traffic gaps. Rotation + the
// 15-min warm refresh it well before expiry; Neon is the durable backstop.
const KV_TTL_SECONDS = 6 * 60 * 60 // 6h

// Per-leg wall-clock budgets — mirror the loader's so a slow upstream can't
// sink the precompute build either.
const BUILD_TIMEOUT_MS = 8000

/**
 * JSON-safe — no Map/Set/Date/undefined anywhere. This object is stored
 * verbatim in KV (JSON.stringify) and a Neon JSON column.
 */
export interface HomepagePayloadA {
  version: typeof HOMEPAGE_PAYLOAD_VERSION
  variant: 'a'
  rails: Rail[]
  total: number
  welcomeBackEnabled: boolean
  moods: string[]
  audiences: string[]
  matters: string[]
  available: ChipAvailabilityArrays // already arrays (availableToArrays)
  sections: ContentBlock[] // folded-in (announcementBar filtered out)
  carouselProductMap: Record<string, Product[]>
  builtAt: number // epoch ms (number, NOT Date)
  degraded: boolean // true if discovery rails came back empty during build
}

/** Resolved content-blocks shape consumed by the homepage component. */
export interface HomeContentBlocks {
  sections: ContentBlock[]
  carouselProductMap: Record<string, Product[]>
}

/**
 * Assemble the Sanity CMS content blocks + their product maps. Extracted from
 * the old inline `getHomeContentBlocks()` closure in _layout._index.tsx so the
 * precompute build and the live/admin fallback share ONE implementation.
 * announcementBar is dropped (the layout renders it pinned from the same
 * singleton; rendering it in-page would duplicate it).
 */
export async function buildHomeContentBlocks(): Promise<HomeContentBlocks> {
  const cmsData = await withTimeout(
    getHomepageSections(), BUILD_TIMEOUT_MS, null, 'getHomepageSections(payloadA)',
  )
  const sections = (cmsData?.sections ?? []).filter(s => s._type !== 'announcementBar')

  const carouselBlocks = sections.filter(
    (s): s is ProductCarouselBlock => s._type === 'productCarousel',
  )
  const emmaRailBlocks = sections.filter(
    (s): s is EmmaCuratedRailBlock => s._type === 'emmaCuratedRail',
  )
  // The couples band's optional "chosen for sharing" strip. The band component
  // has always accepted a `rail` prop; nothing ever resolved one, so the strip
  // was dead code. Handles now come off the block's additive `productHandles`.
  const couplesBlocks = sections.filter(
    (s): s is PlayTogetherBannerBlock => s._type === 'playTogetherBanner',
  )

  const [carouselResults, emmaRailResults, couplesResults] = await Promise.all([
    carouselBlocks.length > 0
      ? withTimeout(Promise.all(carouselBlocks.map(b => {
          const limit = b.productLimit ?? 8
          const source = b.source ?? 'tag'
          if (source === 'collection' && b.collectionHandle) {
            return getCollectionProducts(b.collectionHandle, limit)
          }
          if (source === 'manual' && b.productHandles?.length) {
            return getProductsByHandles(normalizeProductHandles(b.productHandles))
          }
          return b.shopifyTag ? getProductsByTag(b.shopifyTag, limit) : Promise.resolve([] as Product[])
        })), BUILD_TIMEOUT_MS, [] as Product[][], 'carouselResults(payloadA)')
      : Promise.resolve([] as Product[][]),
    emmaRailBlocks.length > 0
      ? withTimeout(Promise.all(emmaRailBlocks.map(b =>
          b.productHandles?.length
            ? getProductsByHandles(normalizeProductHandles(b.productHandles))
            : Promise.resolve([] as Product[]),
        )), BUILD_TIMEOUT_MS, [] as Product[][], 'emmaRailResults(payloadA)')
      : Promise.resolve([] as Product[][]),
    // Couples strip. Uses the same hardened path as the rails above:
    // `normalizeProductHandles` tolerates BOTH shapes this array exists in
    // (productRef objects and bare strings), and each block additionally
    // catches its own rejection. That last part matters: every homepage block
    // resolves inside one Promise.all, so a single malformed entry used to
    // reject the whole contentBlocks build and blank every team-published
    // section on the page (the three-day outage PR #322 fixed). A bad couples
    // block must cost only its own strip.
    couplesBlocks.length > 0
      ? withTimeout(Promise.all(couplesBlocks.map(b =>
          b.productHandles?.length
            ? getProductsByHandles(normalizeProductHandles(b.productHandles))
                .catch((err: unknown) => {
                  console.error('[homepage-payload] couples rail resolve failed:', err)
                  return [] as Product[]
                })
            : Promise.resolve([] as Product[]),
        )), BUILD_TIMEOUT_MS, [] as Product[][], 'couplesResults(payloadA)')
      : Promise.resolve([] as Product[][]),
  ])

  const carouselProductMap: Record<string, Product[]> = {}
  carouselBlocks.forEach((b, i) => { carouselProductMap[b._key] = carouselResults[i] ?? [] })
  emmaRailBlocks.forEach((b, i) => { carouselProductMap[b._key] = emmaRailResults[i] ?? [] })
  couplesBlocks.forEach((b, i) => { carouselProductMap[b._key] = couplesResults[i] ?? [] })

  return { sections, carouselProductMap }
}

/**
 * `_type`s the variant-b StorefrontHome `<Await>` sites actually read out of
 * `contentBlocks.sections` (verified against app/components/store/
 * StorefrontHome.tsx): `emmaCuratedRail` feeds the Nº 03/06 team-rail slots,
 * `editorialTiles` feeds "From the Notebook", `wayfinderMosaic` feeds "Find
 * your way in", and `playTogetherBanner` feeds the Couples band. Every other
 * section type in `singleton.homepage` (trustBar/categoryGrid/productCarousel/
 * promoBanner/etc.) is shell-owned or legacy and variant b never reads it —
 * shipping them to the client is pure dead weight. Exported so the lean
 * builder, its tests, and (if ever needed) the component can share one list.
 */
export const VARIANT_B_SECTION_TYPES = [
  'emmaCuratedRail',
  'editorialTiles',
  'wayfinderMosaic',
  'playTogetherBanner',
  // The hero trust strip (Nº 02). A `trustBar` block + `trustItem` docs already
  // existed and were already projected as `trustItems`, but this whitelist
  // filtered them out, so the strip stayed a hardcoded four-string array no
  // agent could touch. Published trust items now win; the shell array is the
  // fallback.
  'trustBar',
  // The FAQ band (Nº 11), same story: hardcoded Q&A with no Sanity read. The
  // published block feeds BOTH the visible accordion and the FAQPage JSON-LD.
  'homepageFaq',
] as const satisfies readonly ContentBlock['_type'][]

/** Lean resolved content-blocks shape streamed to variant b only. */
export interface HomeContentBlocksLean {
  sections: ContentBlock[]
  carouselProductMap: Record<string, LeanCardProduct[]>
}

/**
 * Explicit whitelist copy — never spread + delete. Truncates `images`/
 * `videos` to their first entry (the only one any variant-b card consumer
 * reads) so the multi-image/every-variant Shopify `Product` doesn't ride
 * along in the hydration payload.
 */
function toLeanCardProduct(p: Product): LeanCardProduct {
  const lean: LeanCardProduct = {
    id: p.id,
    handle: p.handle,
    title: p.title,
    price: p.price,
    images: p.images.length > 0 ? [p.images[0]!] : [],
  }
  if (p.compareAtPrice !== undefined) lean.compareAtPrice = p.compareAtPrice
  if (p.mapPrice !== undefined) lean.mapPrice = p.mapPrice
  if (p.brand !== undefined) lean.brand = p.brand
  if (p.videos && p.videos.length > 0) lean.videos = [p.videos[0]!]
  return lean
}

/**
 * Default collection filling the promoted Nº 03 anchor grid when the team has
 * not pinned one via `singleton.emmaHeroStorefront.anchorCollectionHandle`.
 */
export const DEFAULT_ANCHOR_COLLECTION_HANDLE = 'best-sellers'

/**
 * Resolve the Nº 03 anchor grid's products from the team's curated collection
 * (default best-sellers), in the collection's MANUAL order, slimmed to
 * `LeanCardProduct` for the hydration payload. Sourcing the page's most
 * prominent product wall from a merchandised collection rather than the raw
 * discovery ranking is what lets its heading drop the unbacked purchase-volume
 * claim (ticket #464). Degrades to `[]` on an empty collection or a failed
 * Shopify leg, so the caller falls back to the discovery best-of unchanged.
 */
export async function getAnchorCollectionProducts(
  handle: string | undefined | null,
  limit = 12,
): Promise<LeanCardProduct[]> {
  const h = (handle ?? '').trim() || DEFAULT_ANCHOR_COLLECTION_HANDLE
  try {
    const products = await getCollectionProducts(h, limit)
    return products.map(toLeanCardProduct)
  } catch (err) {
    console.warn(
      `[homepage-payload:b] anchor collection "${h}" fetch failed, falling back to discovery best-of:`,
      err,
    )
    return []
  }
}

/**
 * Variant-b-only slim of `buildHomeContentBlocks()`: filters `sections` down
 * to `VARIANT_B_SECTION_TYPES`, prunes `carouselProductMap` to only the
 * surviving `emmaCuratedRail` blocks' keys (the only surviving section type
 * that reads the map — `productCarousel`, the map's other historical
 * producer, is filtered out above), and slims every product to
 * `LeanCardProduct`. `buildHomeContentBlocks()` itself is untouched — it
 * stays shared with `buildHomepagePayloadA()` and the variant-A live/admin
 * fallback, both of which need the full `Product[]` shape.
 */
export async function buildHomeContentBlocksLean(): Promise<HomeContentBlocksLean> {
  const { sections, carouselProductMap } = await buildHomeContentBlocks()

  const leanSections = sections.filter(s =>
    (VARIANT_B_SECTION_TYPES as readonly string[]).includes(s._type),
  )

  // Section types that carry products through `carouselProductMap`: the curated
  // rails, plus `playTogetherBanner` now that the couples band resolves its own
  // "chosen for sharing" strip. `productCarousel` (the map's other historical
  // producer) is filtered out of variant b above, so it never appears here.
  const survivingRailKeys = new Set(
    leanSections
      .filter(s => s._type === 'emmaCuratedRail' || s._type === 'playTogetherBanner')
      .map(s => s._key),
  )

  const leanCarouselProductMap: Record<string, LeanCardProduct[]> = {}
  for (const key of survivingRailKeys) {
    leanCarouselProductMap[key] = (carouselProductMap[key] ?? []).map(toLeanCardProduct)
  }

  return { sections: leanSections, carouselProductMap: leanCarouselProductMap }
}

/**
 * Build the full Variant A payload as a JSON-safe plain object. Reuses the
 * existing discovery / vocab / Sanity / Shopify functions (no duplicated fetch
 * logic). The per-minute reshuffle seed is NOT baked in — it is a per-request
 * bit applied at read time via reshuffleRailsWithSeed().
 */
export async function buildHomepagePayloadA(): Promise<HomepagePayloadA> {
  // Stable seed: the per-request minute reshuffle is applied at read time, so
  // the stored rail order is deterministic (seed 0).
  const [railsResult, vocab, content] = await Promise.all([
    withTimeout(
      getDiscoveryRails(EMPTY_STATE, { perRail: 12, seed: 0 }),
      BUILD_TIMEOUT_MS,
      { rails: [] as Rail[], total: 0, available: { moods: [], audiences: [], matters: [] } },
      'getDiscoveryRails(payloadA)',
    ),
    withTimeout(
      getDiscoveryVocab(),
      BUILD_TIMEOUT_MS,
      { moods: [] as string[], audiences: [] as string[], matters: [] as string[] },
      'getDiscoveryVocab(payloadA)',
    ),
    buildHomeContentBlocks(),
  ])

  // welcomeBackEnabled lives in the Sanity homeConfig; the loader defaults it
  // to true. We keep the same default here rather than adding another upstream.
  const payload: HomepagePayloadA = {
    version: HOMEPAGE_PAYLOAD_VERSION,
    variant: 'a',
    rails: railsResult.rails,
    total: railsResult.total,
    welcomeBackEnabled: true,
    moods: vocab.moods,
    audiences: vocab.audiences,
    matters: vocab.matters,
    available: railsResult.available,
    sections: content.sections,
    carouselProductMap: content.carouselProductMap,
    builtAt: Date.now(),
    // Empty rails == the discovery index was cold during the build. Strictly
    // worse than a populated blob; the write guard refuses to clobber a good
    // blob with a degraded one unless forced.
    degraded: railsResult.rails.length === 0,
  }

  return payload
}

/**
 * Throws if the payload would not survive a JSON round-trip (Map/Set/Date/
 * undefined corruption). This is the single most important safety gate — the
 * Set -> {} class of bug. Callers must run this before any write.
 */
export function assertJsonSafe(payload: HomepagePayloadA): void {
  const round = JSON.parse(JSON.stringify(payload)) as HomepagePayloadA
  // Cheap structural checks on the fields most likely to carry a non-JSON value.
  if (!Array.isArray(round.rails)) throw new Error('payload.rails not array after JSON round-trip')
  if (typeof round.builtAt !== 'number') throw new Error('payload.builtAt not number after JSON round-trip')
  if (round.version !== HOMEPAGE_PAYLOAD_VERSION) throw new Error('payload.version mismatch after JSON round-trip')
}

/**
 * Read precedence: KV (L1/L2) -> Neon durable row -> null (caller falls back
 * to live/minimal assembly). Rows with a stale version are treated as a miss.
 * On a Neon-fallback hit, opportunistically re-seed KV so subsequent reads are
 * L2-hot.
 */
export async function readHomepagePayloadA(): Promise<HomepagePayloadA | null> {
  // 1. KV (fast path).
  try {
    const kv = await kvGet<HomepagePayloadA>(HOMEPAGE_PAYLOAD_KV_KEY)
    if (kv && kv.version === HOMEPAGE_PAYLOAD_VERSION) return kv
  } catch (err) {
    console.warn('[homepage-payload] KV read failed, trying Neon:', err)
  }

  // 2. Neon durable row.
  try {
    const [row] = await db
      .select()
      .from(homepagePayload)
      .where(eq(homepagePayload.variant, 'a'))
      .limit(1)
    if (row && row.version === HOMEPAGE_PAYLOAD_VERSION && row.payload) {
      const payload = row.payload as HomepagePayloadA
      // Re-seed KV so the next read is L2-hot. Fire-and-forget.
      void kvSet(HOMEPAGE_PAYLOAD_KV_KEY, payload, KV_TTL_SECONDS).catch(() => {})
      return payload
    }
  } catch (err) {
    console.warn('[homepage-payload] Neon read failed:', err)
  }

  return null
}

/**
 * Write the payload to BOTH KV and Neon. Guards against overwriting a good blob
 * with a degraded one unless force=true (rotation forces — the deal/content
 * genuinely changed). Never writes a payload that fails the JSON round-trip.
 */
export async function writeHomepagePayloadA(
  payload: HomepagePayloadA,
  opts: { force?: boolean } = {},
): Promise<void> {
  assertJsonSafe(payload)

  // Degraded-clobber guard: a non-forced warm must not replace a good blob with
  // an empty-rails one. Forced warms (rotation / explicit) always write.
  if (payload.degraded && !opts.force) {
    const existing = await readHomepagePayloadA()
    if (existing && !existing.degraded) {
      console.warn('[homepage-payload] skipping degraded write over a good blob (use force to override)')
      return
    }
  }

  // KV (L1/L2).
  await kvSet(HOMEPAGE_PAYLOAD_KV_KEY, payload, KV_TTL_SECONDS)

  // Neon durable row — upsert on (variant, version).
  try {
    await db
      .insert(homepagePayload)
      .values({
        variant: 'a',
        version: HOMEPAGE_PAYLOAD_VERSION,
        payload,
        degraded: payload.degraded,
      })
      .onConflictDoUpdate({
        target: [homepagePayload.variant, homepagePayload.version],
        set: {
          payload,
          degraded: payload.degraded,
          builtAt: new Date(),
        },
      })
  } catch (err) {
    // KV already holds the blob; a Neon write failure is non-fatal (the next
    // warm retries). Surface it but don't throw into the cron/rotation path.
    console.error('[homepage-payload] Neon upsert failed (KV still written):', err)
  }
}

/**
 * Build + write (force) + return. Convenience used by the cron warm route, the
 * rotation hook, and cold-miss self-heal. force defaults to true because an
 * explicit warm intends to refresh.
 */
export async function warmHomepagePayloadA(
  opts: { force?: boolean } = {},
): Promise<HomepagePayloadA> {
  const force = opts.force ?? true
  const payload = await buildHomepagePayloadA()
  await writeHomepagePayloadA(payload, { force })
  return payload
}

/** Bust both cache tiers (admin invalidation path). */
export async function invalidateHomepagePayloadA(): Promise<void> {
  await kvDel(HOMEPAGE_PAYLOAD_KV_KEY)
}

/**
 * Fire-and-forget: kick a background warm by POSTing to the dedicated cron
 * endpoint. Returns immediately (void) so it never blocks the calling SSR
 * request. Mirrors triggerDiscoveryRebuild() in discovery.server.ts.
 */
export function triggerHomepageWarm(): void {
  const baseUrl = process.env['BASE_URL']
  const cronSecret = process.env['CRON_SECRET']
  if (!baseUrl || !cronSecret) return
  void fetch(`${baseUrl}/cron/warm-homepage`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${cronSecret}` },
  }).catch(() => {})
}

/** Seeded PRNG (mulberry32) — deterministic for a given numeric seed. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = t
    r = Math.imul(r ^ (r >>> 15), r | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Pure, in-memory per-request overlay. Reshuffles the items WITHIN each stored
 * rail by a numeric seed (the minute bucket) so edge-cached HTML still varies
 * across the 60s window WITHOUT re-fetching any upstream. Deterministic per
 * seed. Returns new rail objects (does not mutate the stored payload).
 */
export function reshuffleRailsWithSeed(rails: Rail[], seed: number): Rail[] {
  return rails.map((rail, railIdx) => {
    if (rail.items.length <= 1) return rail
    const items = [...rail.items]
    // Offset the seed per rail so they don't all permute identically.
    const rand = mulberry32(seed + railIdx * 0x9e3779b1)
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      const tmp = items[i]!
      items[i] = items[j]!
      items[j] = tmp
    }
    return { ...rail, items }
  })
}

/* ───────────────────────────────────────────────────────────────────────────
 * Variant B — the storefront homepage ("/" once HOME_VARIANT=b).
 *
 * Same precompute contract as Variant A above, for the same reason but a
 * sharper one. `assembleStorefrontHome` used to call `getDiscoveryRails`, which
 * pulls the ENTIRE discovery index — 4,094 products / ~2.7 MB of JSON — through
 * KV (or, on a KV miss, out of a Neon JSON column) on every render whose 2-min
 * in-process memo had expired, purely to rank it down to the ~50 products the
 * page actually shows. Measured origin TTFB for that path was 2–12s.
 *
 * The blob below carries only what the page renders (rails + hero + notebook +
 * sensation map), which is ~50–100 KB rather than 2.7 MB. The read path never
 * touches the full index at all.
 *
 * The per-bucket rail rotation is NOT baked in: rails are stored at seed 0 and
 * `hydrateStorefrontPayloadB` (in storefront-home.server.ts) applies the
 * reshuffle at read time, exactly as Variant A does.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * Bump on ANY shape change to `HomepagePayloadB`. See HOMEPAGE_PAYLOAD_VERSION.
 * b2: added `contentBlocks` (the team's Sanity merchandising surface, folded in
 *     from PR #322's resolved-not-deferred fix). A b1 blob has no such field, so
 *     serving one would silently render shell fallbacks everywhere — exactly
 *     the P0 #322 fixed. The version bump makes every b1 blob a miss.
 * b3: `contentBlocks` now also carries `trustBar` + `homepageFaq` sections and
 *     the couples band's resolved `productHandles`, and `notebookPosts` grew
 *     from 3 to 6. A b2 blob has none of that, so serving one would keep the
 *     trust strip, FAQ, couples strip and notebook on their old shape forever.
 * b4: added `layout` (singleton.storefrontHome band order + per-band chrome
 *     overrides). A b3 blob has no such field, so it would read as "no layout"
 *     and keep serving the shipped order after the team published a new
 *     arrangement. Null stays the normal, correct value for both.
 * b5: added `panelDeck` (singleton.panelDeck resolved to renderable rows with
 *     validated destinations). A b4 blob has no such field, so the deck would
 *     stay invisible after the team published it. Null = no deck, which is the
 *     launch state.
 * b7: added `pinnedSensationDial` (the pinned hero product's sensation dial,
 *     ticket #3530). A b6 blob has no such field, so the hero would keep
 *     hiding the dial after a pin gained data. Null = no dial, which renders
 *     nothing (doctrine section 6, never fabricate proof).
 * b8: replaced `sensationMap` (SensationMapData) with `curiosityShelf`
 *     (CuriosityShelfData | null), ticket #3532. The Sensation Map band was
 *     retired for the Curiosity Shelf; the field shape is different, so a b7
 *     blob's `sensationMap` would read as absent and the new band render
 *     nothing. Null = band skipped (cold index / < 3 lanes), the same shape as
 *     the retired band's cold-index skip.
 */
export const HOMEPAGE_PAYLOAD_B_VERSION = 'b8'

/** KV key for the precomputed storefront blob. Versioned. */
export const HOMEPAGE_PAYLOAD_B_KV_KEY = `homepage:payload:b:${HOMEPAGE_PAYLOAD_B_VERSION}`

/**
 * JSON-safe — no Map/Set/Date/undefined anywhere. Stored verbatim in KV and a
 * Neon JSON column, so the same round-trip invariant as `HomepagePayloadA`
 * applies.
 */
export interface HomepagePayloadB {
  version: typeof HOMEPAGE_PAYLOAD_B_VERSION
  variant: 'b'
  /** Stored at seed 0; the per-bucket reshuffle is applied at read time. */
  rails: Rail[]
  total: number
  /**
   * The team's `featuredProductHandle` pin, resolved to a full product AT BUILD
   * TIME. Stored rather than re-resolved because the live path's fallback for an
   * unrailed handle was `(await getDiscoveryIndex()).find(...)` — the exact
   * full-index read this precompute exists to eliminate. Null = rotating hero.
   */
  pinnedProduct: DiscoveryProduct | null
  /**
   * The pinned product's sensation dial (xdipx.sensation_dial_v2, legacy
   * sensation_dial projected), fetched from Shopify AT BUILD TIME for the
   * hero's "how it feels" readout (ticket #3530). The discovery index does not
   * carry the dial, so the pin path resolves it once per build rather than the
   * request path paying a Shopify round-trip. Null when there is no pin, the
   * product carries no dial data, or the Shopify leg failed. Null renders
   * nothing, never placeholder chrome.
   */
  pinnedSensationDial?: SensationDialV2 | null
  /**
   * Products for the promoted Nº 03 anchor grid, sourced from the team's
   * `anchorCollectionHandle` collection (default best-sellers) in its curated
   * MANUAL order, resolved to `LeanCardProduct` AT BUILD TIME. This decouples
   * the page's most prominent product wall from the raw discovery ranking so it
   * can no longer surface products unrelated to the day's theme, and its heading
   * no longer implies a purchase-volume claim the store cannot back (ticket
   * #464). Empty (`[]`) when the collection is unset-and-missing, empty, or the
   * Shopify leg failed — StorefrontHome then falls back to the discovery best-of
   * (`rails[0]`), i.e. the prior behaviour. Not reshuffled: a curated collection
   * keeps its merchandised order.
   */
  anchorProducts: LeanCardProduct[]
  emmaHero: EmmaHeroSettings | null
  emmaPhotoUrl: string | null
  emmaPhotoAlt: string | null
  /**
   * The team's published Sanity merchandising surface (curated rails, wayfinder
   * mosaic, Notebook override, couples band), RESOLVED at build time.
   *
   * PR #322 established the invariant that this must never reach the component
   * as an un-awaited promise: a deferred value is streamed after the shell, and
   * the CDN can only store the bytes flushed with the shell, so published
   * merchandising reached neither visitors nor crawlers. Storing it on the blob
   * satisfies that by construction — a precomputed field cannot be pending —
   * and additionally takes the Sanity round-trip off the request path.
   *
   * Freshness is therefore bounded by the warm cadence (~15 min) rather than
   * per-request, same as `emmaHero`. Admin saves bust both tiers immediately,
   * and admin sessions bypass the blob entirely via `{ fresh: true }`.
   */
  contentBlocks: HomeContentBlocksLean
  notebookPosts: BlogPostCard[]
  /** Nº 07 Curiosity Shelf, fully resolved at build time. Null = band skipped. */
  curiosityShelf: CuriosityShelfData | null
  /**
   * Band order + per-band chrome overrides from `singleton.storefrontHome`.
   *
   * Null is the normal value and means "render the shipped order", so an
   * unpublished layout costs nothing and unpublishing is a complete rollback.
   * Resolved at build time for the same reason `contentBlocks` is: a value the
   * shell needs in order to decide what to render cannot be allowed to arrive
   * after the shell has flushed.
   */
  layout: StorefrontHomeLayout | null
  /**
   * The door deck from `singleton.panelDeck`, destinations validated
   * against the live collection list at build time (a typo cannot ship a dead
   * door). Null = no deck published, which renders nothing. The layout's
   * `panelDeckSection` marker decides WHERE it renders; this field is only
   * WHAT.
   */
  panelDeck: ResolvedPanelDeck | null
  builtAt: number // epoch ms (number, NOT Date)
  degraded: boolean // true if discovery rails came back empty during build
}

/** Throws if the payload would not survive a JSON round-trip. See assertJsonSafe. */
export function assertJsonSafeB(payload: HomepagePayloadB): void {
  const round = JSON.parse(JSON.stringify(payload)) as HomepagePayloadB
  if (!Array.isArray(round.rails)) throw new Error('payloadB.rails not array after JSON round-trip')
  if (typeof round.builtAt !== 'number') throw new Error('payloadB.builtAt not number after JSON round-trip')
  if (round.version !== HOMEPAGE_PAYLOAD_B_VERSION) throw new Error('payloadB.version mismatch after JSON round-trip')
}

/**
 * Read precedence: KV (L1/L2) -> Neon durable row -> null (caller falls back to
 * live assembly). Stale versions are treated as a miss. Mirrors
 * `readHomepagePayloadA`.
 */
export async function readHomepagePayloadB(): Promise<HomepagePayloadB | null> {
  try {
    const kv = await kvGet<HomepagePayloadB>(HOMEPAGE_PAYLOAD_B_KV_KEY)
    if (kv && kv.version === HOMEPAGE_PAYLOAD_B_VERSION) return kv
  } catch (err) {
    console.warn('[homepage-payload:b] KV read failed, trying Neon:', err)
  }

  try {
    const [row] = await db
      .select()
      .from(homepagePayload)
      .where(eq(homepagePayload.variant, 'b'))
      .limit(1)
    if (row && row.version === HOMEPAGE_PAYLOAD_B_VERSION && row.payload) {
      const payload = row.payload as HomepagePayloadB
      // Re-seed KV so the next read is L2-hot. Fire-and-forget.
      void kvSet(HOMEPAGE_PAYLOAD_B_KV_KEY, payload, KV_TTL_SECONDS).catch(() => {})
      return payload
    }
  } catch (err) {
    console.warn('[homepage-payload:b] Neon read failed:', err)
  }

  return null
}

/**
 * Write to BOTH KV and Neon, with the same degraded-clobber guard as Variant A:
 * a non-forced warm must never replace a good blob with an empty-rails one.
 */
export async function writeHomepagePayloadB(
  payload: HomepagePayloadB,
  opts: { force?: boolean } = {},
): Promise<void> {
  assertJsonSafeB(payload)

  if (payload.degraded && !opts.force) {
    const existing = await readHomepagePayloadB()
    if (existing && !existing.degraded) {
      console.warn('[homepage-payload:b] skipping degraded write over a good blob (use force to override)')
      return
    }
  }

  await kvSet(HOMEPAGE_PAYLOAD_B_KV_KEY, payload, KV_TTL_SECONDS)

  try {
    await db
      .insert(homepagePayload)
      .values({
        variant: 'b',
        version: HOMEPAGE_PAYLOAD_B_VERSION,
        payload,
        degraded: payload.degraded,
      })
      .onConflictDoUpdate({
        target: [homepagePayload.variant, homepagePayload.version],
        set: {
          payload,
          degraded: payload.degraded,
          builtAt: new Date(),
        },
      })
  } catch (err) {
    console.error('[homepage-payload:b] Neon upsert failed (KV still written):', err)
  }
}

/** Bust both cache tiers (admin invalidation path). */
export async function invalidateHomepagePayloadB(): Promise<void> {
  await kvDel(HOMEPAGE_PAYLOAD_B_KV_KEY)
}

/**
 * Fire-and-forget background warm for variant B. Mirrors `triggerHomepageWarm`.
 * Returns immediately so a cold-miss SSR render is never blocked by the rebuild
 * it just kicked off.
 */
export function triggerHomepageWarmB(): void {
  const baseUrl = process.env['BASE_URL']
  const cronSecret = process.env['CRON_SECRET']
  if (!baseUrl || !cronSecret) return
  void fetch(`${baseUrl}/cron/warm-homepage-b`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${cronSecret}` },
  }).catch(() => {})
}
