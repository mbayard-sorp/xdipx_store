/**
 * Product selection for the sitemap — which PDPs are worth submitting.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * On 2026-09-17 the sitemap carried 5,483 URLs and Google had 108 of them
 * indexed (2.0%). The binding constraint is not page quality — 5,286 of 5,372
 * productPages already carry a tagline, an SEO description and FAQs — it is
 * crawl. Google fetched 341 of those 5,483 URLs in the preceding 30 days, and
 * 1,383 still carried a crawl date from May. Submitting 5,000 URLs to a
 * crawler willing to spend ~340 is not a submission, it is a queue nobody
 * works through, and the queue reorders itself every time the catalog grows.
 *
 * So the sitemap now submits a bounded, rotating slice instead of everything.
 *
 * ── What this reverses, deliberately ──────────────────────────────────────
 *
 * Ticket #9316 (see sitemap.server.ts) examined the stale-'noindex' cohort and
 * decided to keep every live sellable product in the sitemap, on the reasoning
 * that the sitemap is Google's main path back to a URL to reconsider it, so
 * dropping one makes its stale verdict permanent. That reasoning is correct
 * and the conclusion was still changed by owner direction on 2026-09-17,
 * because it assumes crawl is free. It is not: an unbounded sitemap does not
 * buy those URLs a recrawl, it just spreads the same ~340 fetches thinner.
 *
 * Two things keep the reversal from being the permanent suppression #9316
 * warned about:
 *
 *   1. Rotation. Slots turn over weekly on a contiguous, wrapping window, so
 *      every in-stock product reaches the sitemap within
 *      ceil(bucketSize / quota) weeks — bounded, not probabilistic. A hash
 *      lottery would have left some products waiting indefinitely.
 *   2. The protected set. Anything Google already indexed, anything earning
 *      impressions, and anything a customer or an editor has touched is
 *      exempt from the quota entirely and never rotates out.
 *
 * Deselected products are NOT deindexed. No `noindex`, no 410, no canonical
 * change: they keep serving 200, stay linked from collections and /discover,
 * and remain eligible for organic discovery. This module governs submission
 * only.
 *
 * Pure — no server imports, no I/O — so the whole policy is unit-testable.
 * Assembly lives in sitemap.server.ts.
 */

/** A product the sitemap could list, with the two facts selection needs. */
export interface SitemapCandidate {
  handle: string
  /** `productTypeDial` from the discovery index; null buckets under 'other'. */
  dial: string | null
  inStock: boolean
}

/**
 * Products submitted per product-type dial per week.
 *
 * 22 dials are populated, so this is the main lever on total size: 25 yields
 * roughly 500 quota slots, which the protected set then adds to. Override with
 * SITEMAP_PRODUCT_QUOTA_PER_DIAL; a value at or above the largest bucket
 * disables the shrink without a deploy.
 */
export const DEFAULT_QUOTA_PER_DIAL = 25

/**
 * Candidate pool below which we decline to have an opinion.
 *
 * A partial discovery-index read looks exactly like a genuinely tiny catalog,
 * and silently submitting 40 URLs because a query half-failed is a far worse
 * outcome than submitting too many. Same philosophy as
 * MAX_INDEXABLE_DROP_RATIO in sitemap-xml.ts: fail open, loudly.
 */
export const MIN_CANDIDATE_POOL = 500

/** Bucket key for a candidate whose dial is missing. */
const OTHER_DIAL = 'other'

/**
 * FNV-1a, 32-bit. Used only to give each dial bucket a stable order that is
 * uncorrelated with handle alphabetics — without it the rotation window would
 * march through the catalog brand by brand, so a single week's sitemap would
 * be "every Blush product" rather than a spread of the category.
 */
export function stableHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * Weeks since the Unix epoch, turning over at 00:00 UTC on Monday.
 *
 * Day 0 (1970-01-01) was a Thursday, so +3 aligns the division boundary to
 * Monday. The sitemap build memo is 1h, well inside a week, so a rotation
 * never lands mid-cache in a way a crawler could observe as inconsistent.
 */
export function isoWeekIndex(now: Date = new Date()): number {
  return Math.floor((Math.floor(now.getTime() / 86_400_000) + 3) / 7)
}

/**
 * Take `quota` entries from `bucket` starting at a week-dependent offset,
 * wrapping at the end.
 *
 * Contiguous-and-wrapping rather than a per-week hash lottery: this guarantees
 * every entry is selected at least once every ceil(size / quota) weeks, which
 * is the property that makes deselection temporary rather than a coin flip
 * some products lose forever.
 */
export function rotatingSlice<T>(bucket: T[], quota: number, weekIndex: number): T[] {
  const size = bucket.length
  if (size === 0 || quota <= 0) return []
  if (quota >= size) return bucket.slice()
  // Positive modulo: weekIndex is always positive here, but an explicit guard
  // keeps a negative (test-supplied, or a clock before 1970) from indexing
  // off the front of the array.
  const start = ((weekIndex * quota) % size + size) % size
  const out: T[] = []
  for (let i = 0; i < quota; i++) out.push(bucket[(start + i) % size]!)
  return out
}

export interface SelectionInput {
  candidates: SitemapCandidate[]
  /** Handles exempt from the quota — see selectProductHandles. */
  protectedHandles: Set<string>
  quotaPerDial: number
  weekIndex: number
}

export interface SelectionResult {
  /**
   * Handles to submit, or null for "no opinion — publish the full list".
   * Null is the fail-open signal, never an empty set. May contain handles the
   * caller's live list does not — it intersects, so that is harmless.
   */
  handles: Set<string> | null
  /** Why selection declined, when it did. Logged by the caller. */
  reason?: string
  /** Counts for the build log; zeroed when handles is null. */
  stats: { candidates: number; inStock: number; quotaPicked: number; protectedPicked: number }
}

/**
 * Choose the week's submittable product handles.
 *
 * Three rules, in order:
 *
 *   1. Protected handles are always in, stock state notwithstanding. A page
 *      Google has already indexed is the one page we must never pull from the
 *      sitemap — doing so invites exactly the deindexing we are trying to
 *      reverse — and an out-of-stock product that ranks is still a page worth
 *      keeping submitted.
 *   2. Out-of-stock, unprotected products are out. 795 of them on 2026-09-17,
 *      and a crawl spent confirming an unbuyable page buys nothing.
 *   3. Everything else competes for `quotaPerDial` slots in its dial's bucket,
 *      awarded by the rotating window above.
 *
 * Returns `handles: null` when the input is too small or the quota is
 * non-positive, meaning the caller should publish unfiltered.
 */
export function selectProductHandles(input: SelectionInput): SelectionResult {
  const { candidates, protectedHandles, quotaPerDial, weekIndex } = input
  const empty = { candidates: candidates.length, inStock: 0, quotaPicked: 0, protectedPicked: 0 }

  if (quotaPerDial <= 0) {
    return { handles: null, reason: `quota ${quotaPerDial} is not positive`, stats: empty }
  }
  if (candidates.length < MIN_CANDIDATE_POOL) {
    return {
      handles: null,
      reason: `candidate pool ${candidates.length} < ${MIN_CANDIDATE_POOL}; treating as a failed read`,
      stats: empty,
    }
  }

  // Seed with the WHOLE protected set, not just its intersection with the
  // candidate pool. The discovery index is a slightly narrower view of the
  // catalog than the sitemap's own Sanity∩Shopify list (5,128 vs 5,372 on
  // 2026-09-17), and four already-indexed products sat in exactly that gap —
  // intersecting here would have dropped them, which is the single outcome
  // this whole protected set exists to prevent. The caller intersects the
  // result with its own live list, so a handle that no longer resolves is
  // filtered out there rather than needing a guard here.
  const selected = new Set<string>(protectedHandles)
  const protectedPicked = selected.size

  // Bucket the unprotected, in-stock remainder by dial, each bucket ordered by
  // a stable hash so the rotation window spreads across brands.
  const buckets = new Map<string, SitemapCandidate[]>()
  let inStock = 0
  for (const c of candidates) {
    if (!c.inStock) continue
    inStock++
    if (protectedHandles.has(c.handle)) continue
    const key = c.dial?.trim() || OTHER_DIAL
    const bucket = buckets.get(key)
    if (bucket) bucket.push(c)
    else buckets.set(key, [c])
  }

  let quotaPicked = 0
  // Iterate dials in name order so a build is reproducible regardless of the
  // candidate array's incoming order.
  for (const key of [...buckets.keys()].sort()) {
    const bucket = buckets.get(key)!
    bucket.sort((a, b) => {
      const ha = stableHash(a.handle)
      const hb = stableHash(b.handle)
      return ha === hb ? a.handle.localeCompare(b.handle) : ha - hb
    })
    for (const c of rotatingSlice(bucket, quotaPerDial, weekIndex)) {
      selected.add(c.handle)
      quotaPicked++
    }
  }

  return {
    handles: selected,
    stats: { candidates: candidates.length, inStock, quotaPicked, protectedPicked },
  }
}

/** Read the quota override, falling back to the default on anything unusable. */
export function quotaFromEnv(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_QUOTA_PER_DIAL
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    console.warn(`[sitemap] SITEMAP_PRODUCT_QUOTA_PER_DIAL="${raw}" is not a non-negative integer; using ${DEFAULT_QUOTA_PER_DIAL}`)
    return DEFAULT_QUOTA_PER_DIAL
  }
  return n
}
