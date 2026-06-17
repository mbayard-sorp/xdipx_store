/**
 * Storefront homepage (variant 'b') data assembly.
 *
 * The new traditional storefront `/` — a content-rich, crawlable catalog front
 * door that replaces "The Compass" discovery tool at `/` (which moves to
 * `/discover`). Reuses the already-populated, SSR-safe discovery index for
 * "best of" product sets so there are no cold-KV degraded-HTML gaps, plus the
 * Sanity homepage sections so the autonomous merchandising team can inject
 * promos / editorial bands without a deploy.
 *
 * Server-only (`.server.ts`): never import from a client component.
 */

import { getDiscoveryRails } from '~/lib/discovery.server'
import { getProductsByTag } from '~/lib/shopify.server'
import { buildHomeContentBlocks, type HomeContentBlocks } from '~/lib/homepage-payload.server'
import { EMPTY_STATE, type DiscoveryProduct, type Rail } from '~/types/discovery'
import type { Product } from '~/types'

export interface StorefrontData {
  variant: 'b'
  /** Discovery category rails (Pleasure/Play/Body/Wear) — "best of" per category. */
  rails: Rail[]
  /** Top hero feature set — the lead product from each populated rail. */
  featured: DiscoveryProduct[]
  /** Total products surfaced across the rails (a soft "X products" signal). */
  total: number
  forHim: Product[]
  forHer: Product[]
  /**
   * Sanity homepage sections, DEFERRED so they never block the shell's TTFB.
   * This is the surface the daily merchandiser team writes to (promo banners,
   * editorial tiles, curated carousels) — content-only changes, no deploy.
   */
  contentBlocks: Promise<HomeContentBlocks>
}

/**
 * Assemble the storefront homepage payload. All upstreams are bounded by their
 * own callers' caching; for-him/for-her tag fetches degrade to [] so a slow
 * Shopify leg can never sink the render.
 */
export async function assembleStorefrontHome(): Promise<StorefrontData> {
  // Reshuffle the empty-state rails on each 60s edge-cache revalidation so the
  // home page doesn't always lead with the same products (time bucket, not a
  // per-visitor cookie).
  const railSeed = Math.floor(Date.now() / 60_000)
  const [railsResult, forHim, forHer] = await Promise.all([
    getDiscoveryRails(EMPTY_STATE, { perRail: 12, seed: railSeed }),
    getProductsByTag('for-him', 8).catch(() => [] as Product[]),
    getProductsByTag('for-her', 8).catch(() => [] as Product[]),
  ])

  const rails = railsResult.rails
  // Hero feature set: the single highest-ranked product from each populated
  // rail, in category order — a tidy 1–4 product editorial lead.
  const featured = rails
    .map(r => r.items[0]?.product)
    .filter((p): p is DiscoveryProduct => !!p)

  return {
    variant: 'b',
    rails,
    featured,
    total: railsResult.total,
    forHim,
    forHer,
    contentBlocks: buildHomeContentBlocks(), // deferred — team-managed CMS
  }
}
