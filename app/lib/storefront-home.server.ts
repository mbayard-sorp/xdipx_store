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
import { buildHomeContentBlocksLean, type HomeContentBlocksLean } from '~/lib/homepage-payload.server'
import { getSensationMapData, type SensationMapData } from '~/lib/sensation-map.server'
import { getEmmaHeroSettings, getBlogPosts, getEditor } from '~/lib/sanity.server'
import { withTimeout } from '~/lib/with-timeout.server'
import { EMPTY_STATE, type DiscoveryProduct, type Rail } from '~/types/discovery'
import type { EmmaHeroSettings, BlogPostCard } from '~/types/cms'

const EMMA_HERO_TIMEOUT_MS = 4000
const EDITOR_TIMEOUT_MS = 4000

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
   * Full-size Meet Emma portrait (Nº 04). The canonical photorealistic editor
   * photo from `singleton.editor.photo` (`getEditor().photoUrl`), rendered at the
   * 420px 4/5 slot. Null on a Sanity outage/cold leg, in which case MeetEmma
   * falls back to the bundled `/emma.webp` (the illustrated portrait). This
   * replaces the previously hardcoded `/emma.webp` src so the section shows the
   * same real portrait `/about` already uses instead of the Compass-era
   * illustration. `emmaPhotoAlt` comes from `photo.alt` (content-team owned,
   * currently null → the component supplies a default).
   */
  emmaPhotoUrl: string | null
  emmaPhotoAlt: string | null
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
  contentBlocks: Promise<HomeContentBlocksLean>
  /**
   * Latest published Notebook posts, auto-populating the "From the Notebook"
   * section so fresh daily content reaches the homepage with no merchandiser
   * action. A curated `editorialTiles` block (in `contentBlocks`) overrides this
   * when present; otherwise these render.
   */
  notebookPosts: BlogPostCard[]
  /**
   * Nº 07 Sensation Map instrument data: the Type + Feel dial notches, the SSR
   * default dial state, and the default matched product set. `defaultState` is
   * null on a cold/empty index, in which case StorefrontHome skips the band.
   */
  sensationMap: SensationMapData
}

/**
 * Assemble the storefront homepage payload. All upstreams are bounded by their
 * own callers' caching; for-him/for-her tag fetches degrade to [] so a slow
 * Shopify leg can never sink the render. `emmaHero` is bounded by its own
 * short timeout and degrades to null (Hero falls back to discovery-derived
 * copy) so a slow/cold Sanity leg can never sink the render.
 */
/**
 * Time-bucket used to reshuffle the empty-state rails on each edge-cache
 * revalidation, so the home page doesn't always lead with the same products.
 * A time bucket, not a per-visitor cookie, since this feeds a shared cached
 * render. The bucket width must match the edge cache window (see
 * `STOREFRONT_EDGE_CACHE_HEADERS` below) — 300s, widened from 60s in the
 * homepage performance plan's PR-4 so the shuffle cadence stays aligned with
 * how often anonymous visitors actually get a fresh SSR render.
 */
export function railSeedBucket(now = Date.now()): number {
  return Math.floor(now / 300_000)
}

/**
 * Edge-cache headers for the storefront (variant b) anonymous, non-degraded
 * render. Widened from 60s to 300s (homepage performance plan, PR-4): lab
 * metrics are unaffected, but field visitors were hitting an edge cache MISS
 * on effectively every request at 60s and paying full SSR TTFB. The tradeoff
 * is merch edits and inventory sellouts now take up to 5 minutes to reach
 * anonymous visitors. Admins keep `ADMIN_BYPASS_HEADERS` (always fresh) and a
 * degraded/cold-KV render keeps `DEGRADED_NO_STORE_HEADERS` (never cached),
 * both defined in the route file — unaffected by this change.
 */
export const STOREFRONT_EDGE_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
  'Vercel-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900',
} as const

export async function assembleStorefrontHome(): Promise<StorefrontData> {
  const railSeed = railSeedBucket()
  const [railsResult, emmaHero, notebook, editor] = await Promise.all([
    getDiscoveryRails(EMPTY_STATE, { perRail: 12, seed: railSeed }),
    withTimeout(getEmmaHeroSettings(), EMMA_HERO_TIMEOUT_MS, null, 'getEmmaHeroSettings(storefront)'),
    getBlogPosts({ perPage: 3 }).catch(() => ({ posts: [] as BlogPostCard[], total: 0 })),
    // Meet Emma portrait (Nº 04). Own short timeout + degrade-to-null so a slow
    // or cold Sanity leg can never sink the render; MeetEmma falls back to the
    // bundled illustration when this is null. getEditor() is already cached 300s
    // and swallows its own errors, so this is belt-and-suspenders with emmaHero.
    withTimeout(getEditor(), EDITOR_TIMEOUT_MS, null, 'getEditor(storefront)'),
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

  // Sensation Map (Nº 07). Reads the discovery index, already warmed into the
  // L1 memo by the getDiscoveryRails call above, so this is an in-memory hit and
  // never a second KV round-trip. Degrades to an empty payload (band skipped)
  // on a cold index, same as the rails.
  const sensationMap = await getSensationMapData()

  return {
    variant: 'b',
    rails,
    emmaHero,
    emmaPhotoUrl: editor?.photoUrl ?? null,
    emmaPhotoAlt: editor?.photoAlt ?? null,
    featured,
    total: railsResult.total,
    contentBlocks: buildHomeContentBlocksLean(), // deferred — team-managed Sanity surface, lean/slimmed for variant b
    notebookPosts: notebook.posts,
    sensationMap,
  }
}
