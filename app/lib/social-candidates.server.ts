/**
 * social-candidates.server.ts
 *
 * Ticket #12876 (owner 2026-10-01, companion to #12875): "we are too narrow
 * on product selection [in social images]... consistently repeating only a
 * few. Ideally we showcase new products on the site as they arrive." Measured:
 * 14 distinct products posted in 21 days out of ~4,800 in stock, the top five
 * took 64% of product posts, and 6 of 452 products that went live in 30 days
 * ever appeared in social. Nothing in the codebase supplied product
 * candidates or tracked per-product post counts before this file; the
 * drafting routine picked from memory, which is exactly how a catalog of
 * 4,800 became a rotation of 14 (docs/store-team/routine-social-daily.md
 * Step 2.9).
 *
 * Pure scoring core (`scoreSocialCandidates`) + a live Shopify/DB wrapper
 * (`getSocialCandidates`), same split as `blog-hero-embed-audit.ts` and
 * `shopify.server.ts`'s `resolveBareProductReference`: the scoring logic —
 * cooldown exclusion, the Instagram category filter, the never-posted /
 * newness / type-variety / stock-depth ordering, the date-seeded shuffle —
 * is unit-testable with fixture data and never touches the network.
 *
 * NOTE ON THE TICKET'S OWN TEXT: it asks to "reuse isInstagramEligible" for
 * the category filter. No such function exists anywhere in this codebase
 * (grepped before writing this file) — the only place "Instagram-eligible by
 * category" is defined is prose, `docs/store-team/instagram-campaigns.md`
 * §4b, "Picking the product", filter 2: "Never a dildo, never an
 * anatomically realistic product." `isInstagramEligibleCategory` below is
 * new code codifying that literal text, not a reuse of prior art, and it is
 * deliberately conservative: a product type the doctrine doesn't name in
 * words is never excluded here, and the editorial read
 * routine-social-daily.md Step 2.9 item 1 already requires stays the
 * backstop for everything this regex doesn't catch.
 */

export interface RawSocialCandidate {
  handle: string
  productId: string
  title: string
  vendor: string
  /** Shopify's native product_type field, or null when unset. */
  productType: string | null
  totalInventory: number | null
  /** import_candidates.published_at by SKU, else the Shopify createdAt
   *  fallback (Shopify's own `publishedAt` is useless here: every product
   *  reads the same headless-channel-publish timestamp, verified 2026-09-30). */
  publishedAt: string | null
  /** The product's resolved xdipx.bare_product_reference url, or null when
   *  unresolved or resolved to no bare frame (see shopify.server.ts,
   *  ticket #11474/#12875). */
  bareRefUrl: string | null
  /** Most recent non-rejected social_posts row featuring this product
   *  (any status — draft counts, per routine-social-daily.md Step 2.9 item
   *  2: "list ... every status except rejected"), or null if never. */
  lastFeaturedAt: string | null
  /** Non-rejected posts in the trailing 30 days. */
  posts30d: number
}

export interface SocialCandidate {
  handle: string
  productId: string
  title: string
  vendor: string
  productType: string | null
  publishedAt: string | null
  isNewArrival: boolean
  inventory: number | null
  lastFeaturedAt: string | null
  posts30d: number
  bareRefUrl: string | null
  /** PLANNED: no cast-target derivation exists yet; always null. */
  castTarget: string | null
  reason: string
}

export type SocialCandidatePlatform = 'instagram' | 'x'

export interface ScoreSocialCandidatesOptions {
  platform: SocialCandidatePlatform
  /** A product featured (non-rejected) within this many days is excluded outright. Default 21 (Step 2.9 item 2). */
  cooldownDays?: number
  /** A product published within this many days scores as a new arrival. Default 21 (Step 2.9 item 4). */
  newWithinDays?: number
  limit?: number
  /** Exact, case-insensitive match against productType. */
  productType?: string
  /** The product types of the last N product posts on this platform, newest
   *  first — scores a candidate whose type is absent from this list higher
   *  (Step 2.9 item 4: "a product type absent from the last 7 product posts"). */
  recentProductTypes?: string[]
  /** Injected for deterministic tests; defaults to `new Date()`. */
  now?: Date
}

const DEFAULT_COOLDOWN_DAYS = 21
const DEFAULT_NEW_WITHIN_DAYS = 21
const DEFAULT_LIMIT = 20

// docs/store-team/instagram-campaigns.md §4b, "Picking the product", filter 2.
// See the file header for why this is new code, not a reuse of a prior
// function. Matches the dildo family in product-type-derive.ts's
// CANONICAL_PRODUCT_TYPES ("Dildo", "Fantasy Dildo", "Realistic Dildo",
// "Silicone Dildo", "Strap-On Dildo", "Vibrating Dildo") plus "Sex Doll", the
// one other canonical type that is unambiguously "anatomically realistic" by
// the doctrine's own wording. A type this pattern doesn't name is never
// excluded here — see the file header note on why that's deliberate.
const INSTAGRAM_INELIGIBLE_PRODUCT_TYPE = /dildo|realistic|sex\s*doll/i

export function isInstagramEligibleCategory(productType: string | null | undefined): boolean {
  if (!productType) return true
  return !INSTAGRAM_INELIGIBLE_PRODUCT_TYPE.test(productType)
}

function isInCooldown(lastFeaturedAt: string | null, cooldownDays: number, now: Date): boolean {
  if (!lastFeaturedAt) return false
  const last = new Date(lastFeaturedAt).getTime()
  if (!Number.isFinite(last)) return false
  return now.getTime() - last < cooldownDays * 24 * 60 * 60 * 1000
}

function isFreshArrival(publishedAt: string | null, newWithinDays: number, now: Date): boolean {
  if (!publishedAt) return false
  const t = new Date(publishedAt).getTime()
  if (!Number.isFinite(t)) return false
  return now.getTime() - t <= newWithinDays * 24 * 60 * 60 * 1000
}

/**
 * Small deterministic hash -> [0, 1). Seeded from the UTC day plus the
 * candidate's own handle, so tie-break order is stable within one day (and
 * in a test that injects `now`) but moves tomorrow — the "date-seeded
 * shuffle" the ticket asks for, without reaching for a real RNG or crypto
 * for something that only ever needs to not repeat identically every call.
 */
function seededRand(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return ((h >>> 0) % 100_000) / 100_000
}

/**
 * Pure scorer: cooldown and category exclusion first (hard filters, never
 * just scored lower), then an order of never-posted, newness, product-type
 * variety against the recent run, and stock depth as the tiebreak — the
 * exact priority order the ticket specifies — with a date-seeded shuffle
 * inside each tied score band so the same band doesn't return in the same
 * order on every call.
 */
export function scoreSocialCandidates(
  raw: RawSocialCandidate[],
  opts: ScoreSocialCandidatesOptions,
): SocialCandidate[] {
  const cooldownDays = opts.cooldownDays ?? DEFAULT_COOLDOWN_DAYS
  const newWithinDays = opts.newWithinDays ?? DEFAULT_NEW_WITHIN_DAYS
  const limit = opts.limit ?? DEFAULT_LIMIT
  const now = opts.now ?? new Date()
  const day = now.toISOString().slice(0, 10)
  const recentTypes = new Set((opts.recentProductTypes ?? []).filter(Boolean).map(t => t.toLowerCase()))
  const wantedType = opts.productType?.trim().toLowerCase()

  interface Scored { c: RawSocialCandidate; score: number; reasonParts: string[] }
  const scored: Scored[] = []

  for (const c of raw) {
    // Hard exclusions: dropped outright, never merely scored lower.
    if (isInCooldown(c.lastFeaturedAt, cooldownDays, now)) continue
    if (opts.platform === 'instagram' && !isInstagramEligibleCategory(c.productType)) continue
    if (wantedType && (c.productType ?? '').toLowerCase() !== wantedType) continue

    const neverPosted = c.lastFeaturedAt == null
    const fresh = isFreshArrival(c.publishedAt, newWithinDays, now)
    const typeAbsentFromRecent = !c.productType || !recentTypes.has(c.productType.toLowerCase())
    const inventory = c.totalInventory ?? 0

    // Each criterion is weighted well clear of the one below it, so a
    // lower-priority signal can never outrank a higher one. Inventory is
    // capped so no SKU's raw stock count can bleed into the bits above it.
    const score =
      (neverPosted ? 8_000_000 : 0) +
      (fresh ? 400_000 : 0) +
      (typeAbsentFromRecent ? 20_000 : 0) +
      Math.min(inventory, 1000)

    const reasonParts = [
      neverPosted ? 'never posted' : `last featured ${c.lastFeaturedAt}`,
      fresh ? 'new arrival' : null,
      typeAbsentFromRecent ? 'product type absent from last 7 product posts' : null,
    ].filter((p): p is string => !!p)

    scored.push({ c, score, reasonParts })
  }

  const bands = new Map<number, Scored[]>()
  for (const s of scored) {
    const band = bands.get(s.score) ?? []
    band.push(s)
    bands.set(s.score, band)
  }
  const ordered: Scored[] = []
  for (const score of [...bands.keys()].sort((a, b) => b - a)) {
    const band = bands.get(score)!
    const withRand = band.map(s => ({ s, r: seededRand(`${day}:${s.c.handle}`) }))
    withRand.sort((a, b) => a.r - b.r)
    ordered.push(...withRand.map(x => x.s))
  }

  return ordered.slice(0, limit).map(({ c, reasonParts }) => ({
    handle: c.handle,
    productId: c.productId,
    title: c.title,
    vendor: c.vendor,
    productType: c.productType,
    publishedAt: c.publishedAt,
    isNewArrival: isFreshArrival(c.publishedAt, newWithinDays, now),
    inventory: c.totalInventory,
    lastFeaturedAt: c.lastFeaturedAt,
    posts30d: c.posts30d,
    bareRefUrl: c.bareRefUrl,
    castTarget: null,
    reason: reasonParts.join(', ') || 'in pool',
  }))
}

// --- Live wrapper -----------------------------------------------------

export interface GetSocialCandidatesInput {
  platform: SocialCandidatePlatform
  cooldownDays?: number
  newWithinDays?: number
  limit?: number
  productType?: string
}

interface AdminCandidateNode {
  id: string
  handle: string
  title: string
  vendor: string | null
  productType: string | null
  totalInventory: number | null
  createdAt: string
  sku: string | null
  bareRefRaw: string | null
}

// Bounded, not a full-catalog scan. The new-arrival pool is cheap (Step 2.9's
// own measurement: "roughly 100 products go live a week"); the wider pool is
// explicitly pool source #1 among several the routine already combines
// (routine-social-daily.md Step 2.9 item 1), not the only source of variety.
const NEW_ARRIVAL_POOL_SIZE = 100
const WIDE_POOL_SIZE = 150
const MIN_INVENTORY = 3

async function fetchCandidatePool(searchQuery: string, first: number): Promise<AdminCandidateNode[]> {
  const { adminGraphQL } = await import('./shopify.server')
  const data = await adminGraphQL<{
    products: {
      nodes: Array<{
        id: string
        handle: string
        title: string
        vendor: string | null
        productType: string | null
        totalInventory: number | null
        createdAt: string
        variants: { nodes: Array<{ sku: string | null }> }
        bareRef: { value: string } | null
      }>
    }
  }>(`
    query SocialCandidatesPool($first: Int!, $query: String!) {
      products(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id handle title vendor productType totalInventory createdAt
          variants(first: 1) { nodes { sku } }
          bareRef: metafield(namespace: "xdipx", key: "bare_product_reference") { value }
        }
      }
    }
  `, { first, query: searchQuery })
  return data.products.nodes.map(n => ({
    id: n.id,
    handle: n.handle,
    title: n.title,
    vendor: n.vendor,
    productType: n.productType,
    totalInventory: n.totalInventory,
    createdAt: n.createdAt,
    sku: n.variants.nodes[0]?.sku ?? null,
    bareRefRaw: n.bareRef?.value ?? null,
  }))
}

function parseBareRefUrl(raw: string | null): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { url?: string | null }
    return parsed.url ?? null
  } catch {
    return null
  }
}

/** Most recent non-rejected post per handle, plus a trailing-30-day count. */
async function loadFeaturedByHandle(
  handles: string[],
  platform: SocialCandidatePlatform,
): Promise<Map<string, { lastFeaturedAt: string | null; posts30d: number }>> {
  const out = new Map<string, { lastFeaturedAt: string | null; posts30d: number }>()
  if (!handles.length) return out
  const { db } = await import('./db.server')
  const { socialPosts, socialMediaAssets } = await import('../../db/schema')
  const { and, eq, ne, inArray, sql } = await import('drizzle-orm')
  const since30 = Date.now() - 30 * 24 * 60 * 60 * 1000
  const rows = await db
    .select({
      handle: socialMediaAssets.productHandle,
      featuredAt: sql<string | null>`coalesce(${socialPosts.postedAt}, ${socialPosts.scheduledAt}, ${socialPosts.createdAt})`,
    })
    .from(socialMediaAssets)
    .innerJoin(socialPosts, eq(socialMediaAssets.postId, socialPosts.id))
    .where(and(
      inArray(socialMediaAssets.productHandle, handles),
      eq(socialPosts.platform, platform),
      ne(socialPosts.status, 'rejected'),
    ))
  for (const r of rows) {
    if (!r.handle || !r.featuredAt) continue
    const t = new Date(r.featuredAt)
    if (!Number.isFinite(t.getTime())) continue
    const entry = out.get(r.handle) ?? { lastFeaturedAt: null, posts30d: 0 }
    if (!entry.lastFeaturedAt || t.getTime() > new Date(entry.lastFeaturedAt).getTime()) {
      entry.lastFeaturedAt = t.toISOString()
    }
    if (t.getTime() >= since30) entry.posts30d++
    out.set(r.handle, entry)
  }
  return out
}

/**
 * The product types of the last `n` non-rejected product posts on this
 * platform, newest first. Only resolves a type for a handle that happens to
 * be in `typeByHandle` (this call's own candidate pool) — a historical
 * product outside today's pool has an unknown type here and is simply left
 * out of the set rather than guessed, which only softens this one tertiary
 * scoring bonus and never affects the cooldown or category hard filters.
 */
async function loadRecentProductTypes(
  platform: SocialCandidatePlatform,
  n: number,
  typeByHandle: Map<string, string | null>,
): Promise<string[]> {
  const { db } = await import('./db.server')
  const { socialPosts, socialMediaAssets } = await import('../../db/schema')
  const { and, eq, ne, desc } = await import('drizzle-orm')
  const rows = await db
    .select({ handle: socialMediaAssets.productHandle, createdAt: socialPosts.createdAt })
    .from(socialMediaAssets)
    .innerJoin(socialPosts, eq(socialMediaAssets.postId, socialPosts.id))
    .where(and(eq(socialPosts.platform, platform), ne(socialPosts.status, 'rejected')))
    .orderBy(desc(socialPosts.createdAt))
    .limit(n)
  return rows
    .map(r => (r.handle ? typeByHandle.get(r.handle) : null))
    .filter((t): t is string => !!t)
}

async function loadPublishedAtBySku(skus: (string | null)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const clean = [...new Set(skus.filter((s): s is string => !!s))]
  if (!clean.length) return out
  const { db } = await import('./db.server')
  const { importCandidates } = await import('../../db/schema')
  const { inArray } = await import('drizzle-orm')
  const rows = await db
    .select({ sku: importCandidates.sku, publishedAt: importCandidates.publishedAt })
    .from(importCandidates)
    .where(inArray(importCandidates.sku, clean))
  for (const r of rows) {
    if (r.publishedAt) out.set(r.sku, new Date(r.publishedAt).toISOString())
  }
  return out
}

/**
 * Live candidate pool: new-arrival tag pool + a wider active-catalog pool,
 * de-duped (new-arrival wins the handle on overlap), filtered to in-stock
 * (qty > 3), joined against social_posts/social_media_assets for cooldown
 * and against import_candidates for a real publish date, then scored.
 */
export async function getSocialCandidates(input: GetSocialCandidatesInput): Promise<SocialCandidate[]> {
  const [newArrivalNodes, catalogNodes] = await Promise.all([
    fetchCandidatePool('status:active tag:"new-arrival"', NEW_ARRIVAL_POOL_SIZE),
    fetchCandidatePool('status:active', WIDE_POOL_SIZE),
  ])
  const byHandle = new Map<string, AdminCandidateNode>()
  for (const n of newArrivalNodes) byHandle.set(n.handle, n)
  for (const n of catalogNodes) if (!byHandle.has(n.handle)) byHandle.set(n.handle, n)

  const nodes = [...byHandle.values()].filter(n => (n.totalInventory ?? 0) > MIN_INVENTORY)
  const handles = nodes.map(n => n.handle)
  const typeByHandle = new Map(nodes.map(n => [n.handle, n.productType]))

  const [featuredByHandle, recentProductTypes, publishedAtBySku] = await Promise.all([
    loadFeaturedByHandle(handles, input.platform),
    loadRecentProductTypes(input.platform, 7, typeByHandle),
    loadPublishedAtBySku(nodes.map(n => n.sku)),
  ])

  const raw: RawSocialCandidate[] = nodes.map(n => {
    const featured = featuredByHandle.get(n.handle)
    return {
      handle: n.handle,
      productId: n.id,
      title: n.title,
      vendor: n.vendor ?? '',
      productType: n.productType,
      totalInventory: n.totalInventory,
      publishedAt: (n.sku ? publishedAtBySku.get(n.sku) : undefined) ?? n.createdAt ?? null,
      bareRefUrl: parseBareRefUrl(n.bareRefRaw),
      lastFeaturedAt: featured?.lastFeaturedAt ?? null,
      posts30d: featured?.posts30d ?? 0,
    }
  })

  return scoreSocialCandidates(raw, {
    platform: input.platform,
    ...(input.cooldownDays !== undefined ? { cooldownDays: input.cooldownDays } : {}),
    ...(input.newWithinDays !== undefined ? { newWithinDays: input.newWithinDays } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.productType !== undefined ? { productType: input.productType } : {}),
    recentProductTypes,
  })
}
