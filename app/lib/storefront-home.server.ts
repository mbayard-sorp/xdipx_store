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
  getAnchorCollectionProducts,
  readHomepagePayloadB,
  writeHomepagePayloadB,
  triggerHomepageWarmB,
  reshuffleRailsWithSeed,
  HOMEPAGE_PAYLOAD_B_VERSION,
  type HomeContentBlocksLean,
  type HomepagePayloadB,
} from '~/lib/homepage-payload.server'
import { getSensationMapData, type SensationMapData } from '~/lib/sensation-map.server'
import { getProductByHandle } from '~/lib/shopify.server'
import type { SensationDialV2 } from '~/types'
import { getEmmaHeroSettings, getBlogPosts, getEditor, getStorefrontHomeLayout } from '~/lib/sanity.server'
import { getPanelDeck } from '~/lib/panel-deck.server'
import { withTimeout } from '~/lib/with-timeout.server'
import { EMPTY_STATE, type DiscoveryProduct, type Rail } from '~/types/discovery'
import type { LeanCardProduct } from '~/types'
import type { EmmaHeroSettings, BlogPostCard, StorefrontHomeLayout, ResolvedPanelDeck } from '~/types/cms'

const EMMA_HERO_TIMEOUT_MS = 4000
const EDITOR_TIMEOUT_MS = 4000
// Layout is a single small singleton read; it degrades to the shipped order, so
// it gets the same short budget as the other Sanity legs.
const LAYOUT_TIMEOUT_MS = 4000
// The pinned hero product's dial fetch (ticket #3530). Build-time only, never
// on the request path, so it gets the same short budget as the Sanity legs and
// degrades to null (hero renders no dial, never placeholder chrome).
const PIN_DIAL_TIMEOUT_MS = 4000
/**
 * Wall-clock ceiling for the team's Sanity merchandising surface. This leg is
 * now resolved BEFORE the response is sent (see `contentBlocks` below), so it
 * is on the critical path and needs its own hard bound: on timeout it degrades
 * to the empty payload, which renders exactly the same shell fallbacks the page
 * showed while the promise was deferred. Worst case is therefore today's
 * behaviour, never a slower page. It runs in parallel with the discovery rails
 * (the longest leg), so in practice it adds no wall-clock at all.
 */
const CONTENT_BLOCKS_TIMEOUT_MS = 6000

/** Degraded team-content payload: every consumer falls back to shell defaults. */
const EMPTY_CONTENT_BLOCKS: HomeContentBlocksLean = { sections: [], carouselProductMap: {} }

export interface StorefrontData {
  variant: 'b'
  /** Discovery category rails (Pleasure/Play/Body/Wear) — "best of" per category. */
  rails: Rail[]
  /**
   * Products for the promoted Nº 03 anchor grid, from the team's curated
   * `anchorCollectionHandle` collection (default best-sellers), resolved at
   * build time. StorefrontHome renders this wall instead of the discovery
   * best-of so the page's most prominent band is a merchandised selection, not
   * an unbacked "most picked" claim (ticket #464). Empty (`[]`) falls back to
   * the discovery best-of (`rails[0]`), i.e. the prior behaviour.
   */
  anchorProducts: LeanCardProduct[]
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
   * The pinned featured product's sensation dial for the hero's compact "how
   * it feels" readout (ticket #3530). Non-null only when the team has pinned a
   * hero product AND that product carries xdipx.sensation_dial_v2 (or legacy
   * sensation_dial, projected). Null hides the readout entirely, no empty
   * chrome, per doctrine section 6 (never fabricate proof). Always describes
   * `featured[0]`, because the pin is what forces `featured[0]`.
   */
  heroSensationDial: SensationDialV2 | null
  /**
   * Meet Emma portrait (Nº 04). Prefers the additive homepage-only situational
   * portrait `singleton.editor.homepagePhoto` (`getEditor().homepagePhotoUrl`)
   * and falls back to the canonical editor photo `singleton.editor.photo`
   * (`getEditor().photoUrl`), the same asset `/about` uses. Null on a Sanity
   * outage/cold leg, in which case MeetEmma falls back to the bundled
   * `/emma.webp` (the illustrated portrait). The homepagePhoto preference is
   * scoped to this surface only: /about and the video pipeline identity anchor
   * (getEditorPhotoUrl) stay on `photo`, so a homepage-portrait swap never
   * re-portraits /about or the video frames. `emmaPhotoAlt` prefers
   * `homepagePhoto.alt` then `photo.alt` (content-team owned, may be null → the
   * component supplies a default).
   */
  emmaPhotoUrl: string | null
  emmaPhotoAlt: string | null
  /**
   * Team-managed Sanity homepage blocks, RESOLVED server-side before the
   * response is sent.
   *
   * This used to be a deferred `Promise` streamed in after the shell. That
   * never reached real visitors: the storefront is served as an edge-cached
   * document (`STOREFRONT_EDGE_CACHE_HEADERS`, s-maxage 300 + SWR), and a CDN
   * can only store the bytes flushed with the shell — the post-shell streamed
   * resolution is not part of the cacheable document. React Router also aborts
   * still-pending deferred promises at `entry.server.tsx`'s `streamTimeout`.
   * The net effect was that every consumer below rendered its hardcoded
   * fallback permanently, so published merchandising (rails, wayfinder,
   * Notebook override, couples band) was invisible to visitors AND to crawlers.
   * Resolving it here removes the streaming dependency entirely; the leg is
   * bounded by `CONTENT_BLOCKS_TIMEOUT_MS` and degrades to
   * `EMPTY_CONTENT_BLOCKS` (== the old fallback rendering) on a slow or failed
   * upstream.
   *
   * The autonomous merchandising team writes `singleton.homepage`; the
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
  contentBlocks: HomeContentBlocksLean
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
  /**
   * Band order + per-band chrome overrides from `singleton.storefrontHome`.
   * Null means render the shipped order, which is the normal state and what
   * makes an unpublished layout a no-op.
   */
  layout: StorefrontHomeLayout | null
  /** The door deck, resolved. Null = not published; renders nothing. */
  panelDeck: ResolvedPanelDeck | null
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
 * Turn a stored blob into the loader's `StorefrontData`. Pure and synchronous —
 * no upstream reads at all, which is the whole point of the precompute.
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
    // Curated collection order is merchandising, not a rotation set, so it is
    // passed through verbatim (no per-bucket reshuffle like `rails`).
    anchorProducts: payload.anchorProducts ?? [],
    emmaHero: payload.emmaHero,
    // The dial belongs to the pin: it was fetched for `pinnedProduct` at build
    // time, and only a pin holds `featured[0]` still. Guarding on the pin means
    // a rotating hero can never show another product's readings.
    heroSensationDial: pinned ? payload.pinnedSensationDial ?? null : null,
    emmaPhotoUrl: payload.emmaPhotoUrl,
    emmaPhotoAlt: payload.emmaPhotoAlt,
    featured,
    total: payload.total,
    // Already resolved at build time. PR #322 established that this must be a
    // RESOLVED value rather than a streamed promise (a deferred one never
    // survives the edge cache, so team merchandising reached nobody); reading
    // it off the precomputed blob satisfies that contract by construction and
    // removes the Sanity round-trip from the request path entirely.
    contentBlocks: payload.contentBlocks,
    notebookPosts: payload.notebookPosts,
    sensationMap: payload.sensationMap,
    // Resolved at build time for the same reason contentBlocks is: the shell
    // cannot decide what to render from a value that arrives after it flushes.
    layout: payload.layout ?? null,
    panelDeck: payload.panelDeck ?? null,
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
  const [railsResult, emmaHero, notebook, editor, contentBlocks, layout, panelDeck] = await Promise.all([
    getDiscoveryRails(EMPTY_STATE, { perRail: 12, seed: railSeed }),
    withTimeout(getEmmaHeroSettings(), EMMA_HERO_TIMEOUT_MS, null, 'getEmmaHeroSettings(storefront)'),
    // 6, not 3. The Notebook is ~21% of all site sessions with ~20 minutes of
    // dwell and currently sells nothing, so the homepage gives it a real shelf
    // plus a see-all link into /notebook (see HomeNotebookRail).
    getBlogPosts({ perPage: 6 }).catch(() => ({ posts: [] as BlogPostCard[], total: 0 })),
    // Meet Emma portrait (Nº 04). Own short timeout + degrade-to-null so a slow
    // or cold Sanity leg can never sink the render; MeetEmma falls back to the
    // bundled illustration when this is null. getEditor() is already cached 300s
    // and swallows its own errors, so this is belt-and-suspenders with emmaHero.
    withTimeout(getEditor(), EDITOR_TIMEOUT_MS, null, 'getEditor(storefront)'),
    // Team merchandising surface — resolved here rather than deferred, so it
    // survives the edge cache and reaches crawlers (see the `contentBlocks`
    // field doc). Resolving it at BUILD time rather than per-request also takes
    // the Sanity round-trip off the request path completely. `withTimeout` only
    // guards a slow upstream; the `.catch` is what replaces the old
    // `<Await errorElement>`, so a rejected leg degrades to shell fallbacks
    // instead of failing the build.
    withTimeout(
      buildHomeContentBlocksLean(),
      CONTENT_BLOCKS_TIMEOUT_MS,
      EMPTY_CONTENT_BLOCKS,
      'buildHomeContentBlocksLean(storefront)',
    ).catch((err: unknown) => {
      console.error('[storefront-home] contentBlocks failed, using shell fallbacks:', err)
      return EMPTY_CONTENT_BLOCKS
    }),
    // Band order + chrome overrides. Same reasoning as contentBlocks above: the
    // shell cannot decide what to render from a value that lands after it has
    // flushed, so this is resolved at build time and stored. Degrading to null
    // renders the shipped order, so a slow or failed leg costs nothing.
    withTimeout(
      getStorefrontHomeLayout(),
      LAYOUT_TIMEOUT_MS,
      null,
      'getStorefrontHomeLayout(storefront)',
    ).catch((err: unknown) => {
      console.error('[storefront-home] layout failed, using shipped band order:', err)
      return null
    }),
    // The deck. Same contract: resolved at build time, degrades to null, and
    // null renders nothing, so a failed leg costs the deck and only the deck.
    withTimeout(
      getPanelDeck(),
      LAYOUT_TIMEOUT_MS,
      null,
      'getPanelDeck(storefront)',
    ).catch((err: unknown) => {
      console.error('[storefront-home] panel deck failed, rendering without it:', err)
      return null
    }),
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

  // Hero sensation dial (ticket #3530). The discovery index does not carry the
  // dial metafields, so the pin path resolves them from Shopify once per build.
  // Pinned products only: a rotating hero changes product every rail-shuffle
  // bucket, so its dial would describe the wrong product within one blob
  // lifetime. Degrades to null on any failure; null renders nothing.
  let pinnedSensationDial: SensationDialV2 | null = null
  if (pinnedProduct) {
    pinnedSensationDial = await withTimeout(
      getProductByHandle(pinnedProduct.handle).then(p => p?.sensationDialV2 ?? null),
      PIN_DIAL_TIMEOUT_MS,
      null,
      'getProductByHandle(hero sensation dial)',
    ).catch((err: unknown) => {
      console.warn('[storefront-home] hero sensation dial fetch failed, rendering without it:', err)
      return null
    })
  }

  // Nº 03 anchor grid source: the team's curated collection (default
  // best-sellers), resolved to lean cards HERE at build time so the read path
  // stays a pure blob hydrate. This depends on the resolved emmaHero (its
  // anchorCollectionHandle), so it runs after the Promise.all rather than
  // inside it. Off the request path (warm cron / cold miss only), and
  // getCollectionProducts is itself cached. Empty on a missing/empty collection
  // or a failed Shopify leg → the component falls back to the discovery best-of.
  const anchorProducts = await getAnchorCollectionProducts(emmaHero?.anchorCollectionHandle)

  // Sensation Map (Nº 07). Reads the discovery index, already warmed into the
  // L1 memo by the getDiscoveryRails call above, so this is an in-memory hit and
  // never a second KV round-trip. Degrades to an empty payload (band skipped)
  // on a cold index, same as the rails.
  const sensationMap = await getSensationMapData()

  return {
    version: HOMEPAGE_PAYLOAD_B_VERSION,
    variant: 'b',
    rails,
    anchorProducts,
    total: railsResult.total,
    pinnedProduct,
    pinnedSensationDial,
    emmaHero,
    // Nº 04 prefers the additive homepage-only situational portrait
    // (`editor.homepagePhoto`) and falls back to the canonical `photo`. Only
    // this homepage surface reads homepagePhoto; /about and the video
    // pipeline's identity anchor (getEditorPhotoUrl) stay on `photo`, so a
    // homepage-portrait swap never re-portraits /about or the video frames.
    emmaPhotoUrl: editor?.homepagePhotoUrl ?? editor?.photoUrl ?? null,
    emmaPhotoAlt: editor?.homepagePhotoAlt ?? editor?.photoAlt ?? null,
    contentBlocks, // resolved above — team-managed Sanity surface, lean/slimmed for variant b
    notebookPosts: notebook.posts,
    sensationMap,
    layout,
    panelDeck,
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
