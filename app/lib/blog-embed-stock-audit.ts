/**
 * blog-embed-stock-audit.ts
 *
 * Pure detection logic for ticket #2753: a published Notebook post keeps its
 * blogProductEmbed handles forever, but the products behind them decay. A post
 * that embeds a product that has gone out of stock, been de-listed, or dropped
 * from the catalog is pushing readers at a dead CTA on a surface whose whole job
 * is being citable. Nothing revisits a post after publish: the content routine
 * verifies an embed is in stock BEFORE embedding (one shot), and
 * inventory-sentinel only watches hero/rail/featured slots, never blog embeds.
 *
 * This module is the classifier. It takes the embed handles a post carries plus
 * a buyability snapshot per handle and returns, per post, which embeds are dead
 * and why — and flags the worst case, a post whose ONLY embed is dead so it has
 * no purchasable path at all (run 2026-08-11 found
 * "what-size-should-you-actually-start-with" in exactly that state).
 *
 * Kept pure and dependency-free so it is unit-testable without network access.
 * The live Sanity + Shopify Admin + storefront queries live in
 * scripts/audit-blog-embed-stock.ts.
 *
 * Signals (from the sweep that filed #2753 — do NOT use Admin publishedAt, which
 * is null across a headless catalog and flags essentially everything):
 *   - the handle is GONE from the catalog: no Admin product, or status ARCHIVED,
 *     or the storefront PDP returns 404 (bloom-curve-g was the one true 404)
 *   - the product is INACTIVE: Admin status is set and is not ACTIVE
 *   - the product is OUT OF STOCK: totalInventory is known and <= 0
 */

/** How a handle failed buyability, worst first. */
export type EmbedDeadReason = 'gone' | 'inactive' | 'out-of-stock'

/**
 * A buyability snapshot for one catalog handle, assembled by the caller from
 * Shopify Admin (status, totalInventory) and an optional storefront PDP probe.
 */
export interface ProductBuyability {
  handle: string
  /** False when Admin returned no product for this handle at all (de-listed). */
  found: boolean
  /** Admin product status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT', or null if unknown. */
  status: string | null
  /** Shopify totalInventory across variants, or null when the caller did not resolve it. */
  totalInventory: number | null
  /** Storefront PDP HTTP status, when probed. 404 marks the product gone. */
  storefrontStatus?: number | null
}

export interface EmbedAuditPost {
  slug: string
  /** productHandle values of every blogProductEmbed in the post body. */
  embedHandles: string[]
}

export interface DeadEmbed {
  handle: string
  reason: EmbedDeadReason
}

export interface PostEmbedReport {
  slug: string
  /** Every embed on the post, in body order. */
  embedHandles: string[]
  /** The embeds that are not buyable, worst reason first. */
  deadEmbeds: DeadEmbed[]
  /**
   * True when the post has at least one embed and EVERY embed is dead: the post
   * offers the reader no purchasable product at all. These are remediated first.
   */
  hasNoBuyablePath: boolean
}

/** Normalize a handle for map lookups: lowercase, trimmed. */
function normHandle(h: string): string {
  return h.toLowerCase().trim()
}

/**
 * Classify a single handle's buyability. Returns null when the product is
 * buyable (found, ACTIVE, in stock, PDP not 404). Reasons are ranked so a
 * product that is both gone and out of stock reports the more fundamental
 * failure.
 *
 * A handle with no snapshot at all is treated as `gone`: the caller asked Admin
 * about it and got nothing back, which is the de-listed case.
 */
export function classifyBuyability(b: ProductBuyability | undefined): EmbedDeadReason | null {
  if (!b || !b.found) return 'gone'
  if (b.storefrontStatus === 404) return 'gone'
  if (b.status != null && b.status.toUpperCase() === 'ARCHIVED') return 'gone'
  if (b.status != null && b.status.toUpperCase() !== 'ACTIVE') return 'inactive'
  if (b.totalInventory != null && b.totalInventory <= 0) return 'out-of-stock'
  return null
}

/**
 * Find every published post carrying at least one embed that is no longer
 * buyable. Posts with only-buyable embeds are omitted entirely, so an empty
 * result means the whole Notebook is clean.
 *
 * `buyabilityByHandle` is keyed on the raw handle; lookups normalize case and
 * whitespace so a stray uppercase handle in a post body still resolves.
 */
export function findDeadEmbeds(
  posts: EmbedAuditPost[],
  buyability: ProductBuyability[],
): PostEmbedReport[] {
  const byHandle = new Map<string, ProductBuyability>()
  for (const b of buyability) byHandle.set(normHandle(b.handle), b)

  const reports: PostEmbedReport[] = []

  for (const post of posts) {
    const handles = (post.embedHandles ?? []).map(normHandle).filter(Boolean)
    if (handles.length === 0) continue

    const deadEmbeds: DeadEmbed[] = []
    for (const handle of handles) {
      const reason = classifyBuyability(byHandle.get(handle))
      if (reason) deadEmbeds.push({ handle, reason })
    }
    if (deadEmbeds.length === 0) continue

    reports.push({
      slug: post.slug,
      embedHandles: handles,
      deadEmbeds,
      hasNoBuyablePath: deadEmbeds.length === handles.length,
    })
  }

  // Posts with no buyable path at all come first — they are the ones with a
  // reader dead-end, remediated before posts that still sell something.
  reports.sort((a, b) => {
    if (a.hasNoBuyablePath !== b.hasNoBuyablePath) return a.hasNoBuyablePath ? -1 : 1
    return a.slug.localeCompare(b.slug)
  })

  return reports
}
