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
import {
  buildHomeContentBlocksLean,
  readHomepagePayloadB,
  writeHomepagePayloadB,
  triggerHomepageWarmB,
  reshuffleRailsWithSeed,
  HOMEPAGE_PAYLOAD_B_VERSION,
  type HomeContentBlocksLean,
  type HomepagePayloadB,
} from '~/lib/homepage-payload.server'
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
 * Time-bucket used to reshuffle the rails on each edge-cache revalidation, so
 * the home page doesn't always lead with the same products. A time bucket, not
 * a per-visitor cookie, since this feeds a shared cached render. The bucket
 * width must match the edge cache window (see `STOREFRONT_EDGE_CACHE_HEADERS`
 * below): 60s -> 300s -> now 900s, tracking the cache window each time so the
 * shuffle cadence stays aligned with how often anonymous visitors actually get
 * a fresh render.
 */
export const RAIL_SEED_BUCKET_MS = 900_000

export function railSeedBucket(now = Date.now()): number {
  return Math.floor(now / RAIL_SEED_BUCKET_MS)
}

/**
 * Edge-cache headers for the storefront (variant b) anonymous, non-degraded
 * render. 60s -> 300s -> now 900s + a 1h SWR tail.
 *
 * The reason for widening again: at 300s freshness + 900s SWR the edge entry
 * goes fully cold 20 minutes after the last request, while `/cron/warm` only
 * re-primes it every 15 minutes and real traffic is sparse. Visitors were
 * therefore landing on a genuinely empty cache and paying full origin TTFB.
 * At 900s + 3600s SWR the warm cron always lands inside the window, so the CDN
 * has something to serve instantly on every request — stale-then-revalidate at
 * worst, never a cold MISS.
 *
 * The tradeoff is that merch edits reach anonymous visitors in up to ~15
 * minutes rather than ~5. That is already the floor set by the precomputed
 * payload's warm cadence, so this doesn't make anything staler than it was;
 * admin saves still bust both tiers immediately via `bustHomepagePayload`.
 * Admins keep `ADMIN_BYPASS_HEADERS` (always fresh) and a degraded/cold render
 * keeps `DEGRADED_NO_STORE_HEADERS` (never cached), both in the route file.
 */
export const STOREFRONT_EDGE_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0, s-maxage=900, stale-while-revalidate=3600',
  'Vercel-CDN-Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
} as const

/**
 * Assemble the storefront payload from the precomputed blob when one exists,
 * falling back to a full live build on a miss.
 *
 * The fast path reads a ~50–100 KB blob (`readHomepagePayloadB`) and does no
 * upstream work at all. The slow path is the original live assembly, which
 * pulls the full 4,094-product / 2.7 MB discovery index through KV or Neon just
 * to rank it down to the ~50 products on screen — measured at 2–12s of origin
 * TTFB. That path now runs at most once per blob lifetime instead of on every
 * render whose 2-minute index memo had expired, because a successful live build
 * writes the blob on its way out.
 */
export async function assembleStorefrontHome(
  opts: { fresh?: boolean } = {},
): Promise<StorefrontData> {
  // `fresh` (admin sessions) skips the blob so an editor sees their Sanity /
  // settings change on the next reload instead of waiting for the next warm.
  // It deliberately does NOT write the blob back: an admin preview shouldn't
  // reset the rotation window that anonymous visitors are sharing.
  if (opts.fresh) return hydrateStorefrontPayloadB(await buildHomepagePayloadB())

  const payload = await readHomepagePayloadB()
  if (payload) {
    // A degraded blob (empty rails) means the discovery index was cold when it
    // was built. Rebuilding inline wouldn't help — the index is what's missing —
    // so kick a background warm and render what we have.
    if (payload.degraded) triggerHomepageWarmB()
    return hydrateStorefrontPayloadB(payload)
  }

  // Cold miss: build inline so we never render an empty storefront, then write
  // the blob so the next request takes the fast path. Concurrent cold requests
  // can each pay this once; they converge after the first write lands.
  const fresh = await buildHomepagePayloadB()
  void writeHomepagePayloadB(fresh).catch(err => {
    console.warn('[storefront-home] payload write after cold build failed:', err)
  })
  return hydrateStorefrontPayloadB(fresh)
}

/**
 * Turn a stored blob into the loader's `StorefrontData`. Pure and synchronous
 * apart from the deferred content blocks — no upstream reads, which is the
 * whole point of the precompute.
 *
 * Rails are stored at seed 0; the per-bucket rotation is applied here so
 * edge-cache windows still vary without re-fetching anything. `featured` is
 * recomputed from the reshuffled rails (rather than stored) so the hero product
 * and the rail beneath it can never disagree about what's in slot 0.
 */
export function hydrateStorefrontPayloadB(payload: HomepagePayloadB): StorefrontData {
  const rails = reshuffleRailsWithSeed(payload.rails, railSeedBucket())

  let featured = rails
    .map(r => r.items[0]?.product)
    .filter((p): p is DiscoveryProduct => !!p)

  // Re-apply the team's pin on top of the rotated set. The product was resolved
  // to a full record at build time, so this needs no index lookup.
  const pinned = payload.pinnedProduct
  if (pinned) {
    featured = [pinned, ...featured.filter(p => p.handle !== pinned.handle)]
  }

  return {
    variant: 'b',
    rails,
    emmaHero: payload.emmaHero,
    emmaPhotoUrl: payload.emmaPhotoUrl,
    emmaPhotoAlt: payload.emmaPhotoAlt,
    featured,
    total: payload.total,
    contentBlocks: buildHomeContentBlocksLean(), // deferred — never blocks the shell
    notebookPosts: payload.notebookPosts,
    sensationMap: payload.sensationMap,
  }
}

/**
 * Full live assembly, producing the JSON-safe blob. This is the expensive path
 * (it reads the whole discovery index); it runs on the warm cron and on a cold
 * miss, never on a normal request. Rails are built at seed 0 — the per-bucket
 * reshuffle is a read-time overlay, not part of the stored blob.
 */
export async function buildHomepagePayloadB(): Promise<HomepagePayloadB> {
  const railSeed = 0
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

  // Pinnable headliner: when the team sets featuredProductHandle on
  // singleton.emmaHeroStorefront, pin that product to featured[0] so the hero
  // image + peek link match the hero copy instead of following the rail
  // shuffle. Resolved to a full product HERE, at build time, and stored on the
  // blob — the read path re-applies it without touching the index. Unknown
  // handle (or a timed-out Sanity leg) degrades to the rotating default; unset
  // skips this block entirely.
  const pinnedHandle = emmaHero?.featuredProductHandle?.trim()
  let pinnedProduct: DiscoveryProduct | null = null
  if (pinnedHandle) {
    pinnedProduct =
      rails.flatMap(r => r.items).find(i => i.product.handle === pinnedHandle)?.product ??
      // Not surfaced by today's rails: pull it from the discovery index. The
      // rails call above already warmed the L1 memo, so this is an in-memory
      // lookup, not a second KV round-trip.
      (await getDiscoveryIndex()).find(p => p.handle === pinnedHandle) ??
      null
    if (!pinnedProduct) {
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
    version: HOMEPAGE_PAYLOAD_B_VERSION,
    variant: 'b',
    rails,
    total: railsResult.total,
    pinnedProduct,
    emmaHero,
    emmaPhotoUrl: editor?.photoUrl ?? null,
    emmaPhotoAlt: editor?.photoAlt ?? null,
    notebookPosts: notebook.posts,
    sensationMap,
    builtAt: Date.now(),
    // Empty rails == the discovery index was cold during the build. The write
    // guard refuses to clobber a good blob with this unless forced.
    degraded: rails.length === 0,
  }
}

/**
 * Build + write (force) + return. Used by the warm cron and by admin
 * invalidation. Mirrors `warmHomepagePayloadA`.
 */
export async function warmHomepagePayloadB(
  opts: { force?: boolean } = {},
): Promise<HomepagePayloadB> {
  const force = opts.force ?? true
  const payload = await buildHomepagePayloadB()
  await writeHomepagePayloadB(payload, { force })
  return payload
}
