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
import type { Product, LeanCardProduct } from '~/types'
import type { ContentBlock, ProductCarouselBlock, EmmaCuratedRailBlock } from '~/types/cms'

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

  const [carouselResults, emmaRailResults] = await Promise.all([
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
  ])

  const carouselProductMap: Record<string, Product[]> = {}
  carouselBlocks.forEach((b, i) => { carouselProductMap[b._key] = carouselResults[i] ?? [] })
  emmaRailBlocks.forEach((b, i) => { carouselProductMap[b._key] = emmaRailResults[i] ?? [] })

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
  if (p.brand !== undefined) lean.brand = p.brand
  if (p.videos && p.videos.length > 0) lean.videos = [p.videos[0]!]
  return lean
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

  const survivingRailKeys = new Set(
    leanSections
      .filter((s): s is EmmaCuratedRailBlock => s._type === 'emmaCuratedRail')
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
