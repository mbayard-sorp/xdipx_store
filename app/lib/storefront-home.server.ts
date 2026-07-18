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

import { getDiscoveryIndex, getDiscoveryRails } from '~/lib/discovery.server'
import { buildHomeContentBlocks, type HomeContentBlocks } from '~/lib/homepage-payload.server'
import { getEmmaHeroSettings, getBlogPosts } from '~/lib/sanity.server'
import { withTimeout } from '~/lib/with-timeout.server'
import { EMPTY_STATE, type DiscoveryProduct, type Rail } from '~/types/discovery'
import type { EmmaHeroSettings, BlogPostCard } from '~/types/cms'

const EMMA_HERO_TIMEOUT_MS = 4000

export interface StorefrontData {
  variant: 'b'
  /** Discovery category rails (Pleasure/Play/Body/Wear) — "best of" per category. */
  rails: Rail[]
  /** Top hero feature set — the lead product from each populated rail. */
  featured: DiscoveryProduct[]
  /** Total products surfaced across the rails (a soft "X products" signal). */
  total: number
  /**
   * Team-managed `singleton.emmaHero` doc (Sanity `emmaHeroSettings`). Text/
   * config only — eyebrow/headline/body/aside/pullQuote/heroVariant. The Hero
   * falls back field-by-field to the discovery-derived defaults when this is
   * null or a field is empty. The LCP product image always stays derived from
   * `featured[0]`; the doc's one lever over it is `featuredProductHandle`
   * (merged in from `singleton.emmaHeroStorefront`), which pins `featured[0]`
   * to a specific product at assembly time so the hero image + peek link stop
   * rotating out from under the hero copy. Unset = rotating behavior.
   */
  emmaHero: EmmaHeroSettings | null
  /**
   * Team-managed Sanity homepage blocks (DEFERRED — never blocks the shell's
   * TTFB). The autonomous merchandising team writes `singleton.homepage`; the
   * storefront renders only the team's merchandising surfaces from it:
   *   - `emmaCuratedRail` → the rotating-rails zone (discovery rails are the
   *     cold-start / no-team-content fallback)
   *   - `editorialTiles`  → the "From the Notebook" zone
   * Shell-owned layout (trust, mosaic, FAQ, etc.) is NOT read from Sanity, and
   * legacy `productCarousel` / shell-duplicate blocks are intentionally
   * ignored so stale v2 content can't surface on the new homepage. The Hero's
   * text/config (eyebrow/headline/body/aside/pullQuote/heroVariant) IS read
   * from the existing `singleton.emmaHero` doc (see `emmaHero` field below) so
   * the team can edit it without a deploy; the LCP product image stays
   * discovery-derived.
   */
  contentBlocks: Promise<HomeContentBlocks>
  /**
   * Latest published Notebook posts (DEFERRED — never blocks the shell's TTFB),
   * auto-populating the "From the Notebook" band so fresh daily content reaches
   * the homepage with no merchandiser action. A curated `editorialTiles` block
   * (in `contentBlocks`) overrides this when present; otherwise these render via
   * `NotebookTeaser`. Degrades to [] so a slow/failed Sanity leg can never sink
   * the render.
   */
  notebookPosts: Promise<BlogPostCard[]>
}

/**
 * Assemble the storefront homepage payload. All upstreams are bounded by their
 * own callers' caching; for-him/for-her tag fetches degrade to [] so a slow
 * Shopify leg can never sink the render. `emmaHero` is bounded by its own
 * short timeout and degrades to null (Hero falls back to discovery-derived
 * copy) so a slow/cold Sanity leg can never sink the render.
 */
export async function assembleStorefrontHome(): Promise<StorefrontData> {
  // Reshuffle the empty-state rails on each 60s edge-cache revalidation so the
  // home page doesn't always lead with the same products (time bucket, not a
  // per-visitor cookie).
  const railSeed = Math.floor(Date.now() / 60_000)

  // Kick off the Notebook fetch up front so it runs concurrently with the
  // awaited rails/hero legs, but keep it DEFERRED (like `contentBlocks`): the
  // "From the Notebook" band sits well below the fold, so streaming it in keeps
  // the blog fetch off the shell's TTFB path. The immediate `.catch` degrades
  // it to [] so a slow/failed Sanity leg can never sink the render (and never
  // surfaces as an unhandled rejection while it's held unawaited).
  const notebookPosts = getBlogPosts({ perPage: 3 })
    .then(r => r.posts)
    .catch(() => [] as BlogPostCard[])

  const [railsResult, emmaHero] = await Promise.all([
    getDiscoveryRails(EMPTY_STATE, { perRail: 12, seed: railSeed }),
    withTimeout(getEmmaHeroSettings(), EMMA_HERO_TIMEOUT_MS, null, 'getEmmaHeroSettings(storefront)'),
  ])

  const rails = railsResult.rails
  // Hero feature set: the single highest-ranked product from each populated
  // rail, in category order — a tidy 1–4 product editorial lead.
  let featured = rails
    .map(r => r.items[0]?.product)
    .filter((p): p is DiscoveryProduct => !!p)

  // Pinnable headliner: when the team sets featuredProductHandle on
  // singleton.emmaHeroStorefront, pin that product to featured[0] so the hero
  // image + peek link match the hero copy instead of following the 60s rail
  // shuffle. Unknown handle (or a timed-out Sanity leg) degrades to the
  // rotating default; unset skips this block entirely.
  const pinnedHandle = emmaHero?.featuredProductHandle?.trim()
  if (pinnedHandle) {
    const pinned =
      featured.find(p => p.handle === pinnedHandle) ??
      rails.flatMap(r => r.items).find(i => i.product.handle === pinnedHandle)?.product ??
      // Not surfaced by today's rails: pull it from the discovery index. The
      // rails call above already warmed the L1 memo, so this is an in-memory
      // lookup, not a second KV round-trip.
      (await getDiscoveryIndex()).find(p => p.handle === pinnedHandle)
    if (pinned) {
      featured = [pinned, ...featured.filter(p => p.handle !== pinnedHandle)]
    } else {
      console.warn(
        `[storefront-home] featuredProductHandle "${pinnedHandle}" not in discovery index, hero stays rotating`,
      )
    }
  }

  return {
    variant: 'b',
    rails,
    emmaHero,
    featured,
    total: railsResult.total,
    contentBlocks: buildHomeContentBlocks(), // deferred — team-managed Sanity surface
    notebookPosts, // deferred — latest live posts, streamed below the fold
  }
}
