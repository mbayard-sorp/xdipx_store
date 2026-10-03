import { lazy, Suspense } from 'react'
import type { HeadersFunction, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Await, data, useLoaderData } from 'react-router'
import { getAdminUser } from '~/lib/session.server'
import {
  getDealByShopifyId, getDealByHandle, getProductsByTag, getBonusDeal,
  getCollectionProducts, getProductsByHandles,
} from '~/lib/shopify.server'
import { db } from '~/lib/db.server'
import { dealHistory, pipelineSettings } from '../../db/schema'
import { eq, inArray } from 'drizzle-orm'
import { kvGet, KV_KEYS } from '~/lib/kv.server'
import { getHomepageSections, getEmmaHeroSettings, getHomeConfig, getHomeSeo } from '~/lib/sanity.server'
import { resolveHomeVariant } from '~/lib/home-variant.server'
import { loadVariantAData } from '~/lib/home-discover.server'
import { assembleStorefrontHome, STOREFRONT_EDGE_CACHE_HEADERS } from '~/lib/storefront-home.server'
import { StorefrontHome } from '~/components/store/StorefrontHome'
import { getBundleByHandle }                    from '~/lib/bundles.server'
import { getProductReviews, getProductAggregate } from '~/lib/reviews.server'
import { getEmmaContextRows }    from '~/lib/emma-rails.server'
import { getCartIdFromCookie }   from '~/lib/cart.server'
import { getSwatchMap }          from '~/lib/swatches.server'
import { ContentBlockRenderer }  from '~/components/cms/ContentBlockRenderer'
import type { Product } from '~/types'
import type { ProductCarouselBlock } from '~/types/cms'
import { buildSocialMeta } from '~/lib/social-meta'
import { heroPreloadTag } from '~/lib/image-preload'
import { BRAND_TITLE, BRAND_DESCRIPTION, BRAND_NAME } from '~/lib/brand'
import { withTimeout } from '~/lib/with-timeout.server'
import { normalizeProductHandles } from '~/lib/product-handles'

// Ticket #13146: HomeA (variant 'a') and LegacyHome (variant 'legacy') are
// each only ever rendered for the ONE visitor on that variant, but a static
// import pulls a component's whole module graph into the SAME client chunk
// as this route regardless of which branch actually renders — every visitor
// on variant 'b' (the live storefront) was downloading HomeA's and all six
// legacy hero components' code (~20-30 KB compressed) that never ran.
// React.lazy + Suspense code-splits each into its own chunk, fetched only
// when its branch actually renders.
const HomeA = lazy(() => import('~/components/discovery/HomeA').then(m => ({ default: m.HomeA })))
const LegacyHome = lazy(() => import('~/components/store/LegacyHome'))

// Per-fetch wall-clock budgets. Any single upstream that exceeds its budget
// resolves to a safe fallback so the homepage always returns 200 SSR HTML well
// under the serverless maxDuration. Cold-instance Googlebot crawls were tipping
// past the 60s function limit and returning 499s when a dependency hung; these
// bound each leg so the slowest upstream can't sink the whole render.
const LOADER_TIMEOUT_MS = 8000
const LOADER_DEAL_TIMEOUT_MS = 9000

const DEFAULT_PIPELINE_SETTINGS_ROWS: { key: string; value: string }[] = [
  { key: 'homepage_template',            value: 'endorsement' },
  { key: 'homepage_show_free_shipping',  value: 'true' },
  { key: 'homepage_pair_product_handle', value: '' },
  { key: 'homepage_pair_discount_pct',   value: '0' },
]

async function getLiveDealRow() {
  const [dbDeal] = await db
    .select()
    .from(dealHistory)
    .where(eq(dealHistory.status, 'live'))
    .limit(1)
  return dbDeal ?? null
}

export const headers: HeadersFunction = ({ loaderHeaders }) => {
  // When the loader detects an admin session it returns `Cache-Control: private,
  // no-store` so admins always see fresh data after switching templates / saving
  // settings — no waiting on the 60s edge cache to expire.
  const fromLoader = loaderHeaders.get('Cache-Control')
  if (fromLoader) {
    const cdn = loaderHeaders.get('Vercel-CDN-Cache-Control') ?? 'no-store'
    return {
      'Cache-Control': fromLoader,
      'Vercel-CDN-Cache-Control': cdn,
    }
  }
  // Edge-cache the homepage so burst traffic doesn't fan out to Shopify/Sanity.
  // Deal rotations happen at midnight (and inventory sellouts), so 60s
  // revalidation is safe — SWR keeps users fast during revalidation.
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    // Explicit Vercel CDN directive — overrides browser Cache-Control at the edge
    // so the CDN serves cached HTML for 60s with 600s SWR while origin revalidates.
    'Vercel-CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
  }
}

// Admin sessions get fresh-every-request HTML so template / setting changes
// in /admin/deals propagate immediately. Anonymous visitors keep the edge cache.
const ADMIN_BYPASS_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Vercel-CDN-Cache-Control': 'no-store',
} as const

// Cold-KV / degraded storefront (variant b) never gets edge-cached — otherwise
// one unlucky cold-cache render gets pinned at the edge for up to 660s
// (60s + 600s SWR) and every visitor in that window sees an empty homepage.
const DEGRADED_NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'Vercel-CDN-Cache-Control': 'no-store',
} as const

// Variant-A "The Compass" assembly (VariantAData, assembleVariantALive,
// assembleVariantAMinimal, loadVariantAData) now lives in
// `~/lib/home-discover.server` so the standalone `/discover` route can reuse it.
// Storefront (variant 'b') assembly lives in `~/lib/storefront-home.server`.

export async function loader({ request }: LoaderFunctionArgs) {
  // ── Variant A: "The Compass" discovery home page ─────────────────────────
  // Resolve variant before the heavy legacy fan-out so variant A skips all
  // Shopify/Sanity calls it doesn't need. Variant A has its own loader branch
  // that runs a lightweight getDiscoveryRails() instead.
  const [homeConfig, homeSeo] = await Promise.all([
    getHomeConfig().catch(() => null),
    getHomeSeo().catch(() => null),
  ])
  const { variant } = resolveHomeVariant(request, homeConfig?.activeVariant ?? null)

  // Ticket #13144: the live-rebuild opt-in for an admin session (template /
  // Sanity preview before a save). Only meaningful when an admin cookie is
  // also present below — an anonymous `?fresh=1` is a no-op, never a live
  // rebuild, so this stays load-bearing only for the editor path.
  const wantsFresh = new URL(request.url).searchParams.get('fresh') === '1'

  // Team-editable SERP snippet (singleton.homeSeo), with brand-default fallback.
  // Attached to every loader return so the `meta` export can read `data.seo`
  // without an async fetch of its own. This is the homepage "update strategy":
  // the strategy/merch team rotates title/description in Studio, no deploy.
  const seo = {
    title: homeSeo?.seoTitle || BRAND_TITLE,
    description: homeSeo?.seoDescription || BRAND_DESCRIPTION,
    ogImageUrl: homeSeo?.ogImageUrl ?? null,
  }

  if (variant === 'a') {
    // "The Compass" discovery home. Assembly (admin / precompute / cold-miss /
    // bot-fallback) lives in loadVariantAData so `/discover` reuses it verbatim.
    const welcomeBackEnabled = homeConfig?.welcomeBackEnabled ?? true
    const adminUser = await getAdminUser(request).catch(() => null)
    const value = { ...await loadVariantAData(request, { welcomeBackEnabled, isAdmin: !!adminUser, fresh: wantsFresh }), seo }
    return adminUser ? data(value, { headers: ADMIN_BYPASS_HEADERS }) : value
  }

  // ── Variant B: the new traditional storefront home page ───────────────────
  // Content-rich, crawlable catalog front door. Reuses the discovery index for
  // "best of" rails so there is no cold-KV degraded-HTML gap. Default stays
  // 'legacy'/'a' until HOME_VARIANT=b (or Sanity activeVariant='b') flips it on.
  if (variant === 'b') {
    const adminUser = await getAdminUser(request).catch(() => null)
    // Admin reads the precomputed blob like everyone else by default (ticket
    // #13144 — the live assembly measured 2-4s+ of origin TTFB against prod,
    // paid on every homepage load for anyone who had used /admin within the
    // cookie's 7-day window). ADMIN_BYPASS_HEADERS below still keeps the
    // response private/no-store so a shared cache never stores admin HTML;
    // only an explicit `?fresh=1` still pays the full live assembly, for
    // previewing an unsaved Sanity edit. A saved edit already busts the blob
    // via bustHomepagePayload, so default admin freshness is unchanged.
    const value = { ...await assembleStorefrontHome({ fresh: !!adminUser && wantsFresh }), seo }
    if (adminUser) return data(value, { headers: ADMIN_BYPASS_HEADERS })
    // Cold KV / degraded assembly (no rails, no featured product) — never let
    // the edge cache pin a blank storefront for the next window.
    const isDegraded = value.rails.length === 0 && value.featured.length === 0
    if (isDegraded) return data(value, { headers: DEGRADED_NO_STORE_HEADERS })
    // Anonymous, non-degraded render: edge-cache (see
    // STOREFRONT_EDGE_CACHE_HEADERS) so real visitors hit the CDN instead of
    // paying full SSR TTFB on every request. `headers` (below) forwards both
    // Cache-Control and Vercel-CDN-Cache-Control from these loader headers.
    return data(value, { headers: STOREFRONT_EDGE_CACHE_HEADERS })
  }

  // ── Legacy path (unchanged) ───────────────────────────────────────────────
  // Read the live-deal row first (indexed, cheap); then fan out the Shopify
  // fetch alongside the other branches so it overlaps rather than chains.
  const [dbDeal, adminUser] = await Promise.all([
    getLiveDealRow(),
    getAdminUser(request).catch(() => null),
  ])
  const isAdmin = !!adminUser
  const [deal, forHim, forHer, bonusDeal, cmsData, emmaHero, templateRows] = await Promise.all([
    withTimeout(
      dbDeal?.shopifyProductId ? getDealByShopifyId(dbDeal.shopifyProductId) : Promise.resolve(null),
      LOADER_DEAL_TIMEOUT_MS, null, 'getDealByShopifyId',
    ),
    withTimeout(getProductsByTag('for-him', 8), LOADER_TIMEOUT_MS, [] as Product[], 'getProductsByTag(for-him)'),
    withTimeout(getProductsByTag('for-her', 8), LOADER_TIMEOUT_MS, [] as Product[], 'getProductsByTag(for-her)'),
    withTimeout(getBonusDeal(), LOADER_TIMEOUT_MS, null, 'getBonusDeal'),
    withTimeout(getHomepageSections(), LOADER_TIMEOUT_MS, null, 'getHomepageSections'),
    withTimeout(getEmmaHeroSettings(), LOADER_TIMEOUT_MS, null, 'getEmmaHeroSettings'),
    withTimeout(
      db.select().from(pipelineSettings).where(inArray(pipelineSettings.key, [
        'homepage_template',
        'homepage_show_free_shipping',
        'homepage_pair_product_handle',
        'homepage_pair_discount_pct',
      ])),
      8000, DEFAULT_PIPELINE_SETTINGS_ROWS, 'pipelineSettings',
    ),
  ])

  const homepageSettings = {
    template: (templateRows.find(r => r.key === 'homepage_template')?.value ?? 'endorsement') as 'default' | 'quiet_endorsement' | 'pair_bundle' | 'pair_bundle_fullbleed' | 'endorsement',
    showFreeShipping: (templateRows.find(r => r.key === 'homepage_show_free_shipping')?.value ?? 'true') === 'true',
    pairProductHandle: (templateRows.find(r => r.key === 'homepage_pair_product_handle')?.value ?? '').trim(),
    pairDiscountPct: parseInt(templateRows.find(r => r.key === 'homepage_pair_discount_pct')?.value ?? '0', 10) || 0,
  }

  // Session seed: prefer the cart cookie (stable per visitor once they engage);
  // anon visitors fall back to a 60s rotating bucket so the edge-cached window
  // naturally reshuffles on each revalidation. Cheap enough to compute inline.
  const cartId  = getCartIdFromCookie(request)
  const minuteBucket = Math.floor(Date.now() / 60_000)
  const sessionSeed = cartId ?? `anon-${minuteBucket}`

  // Phase 3: every remaining external call fans out in parallel. Previous code
  // chained these sequentially (pairBundleDeal → swatches → pairDeal → bundle →
  // carousel → rails → reviews) which on a cold cache could add 1.5–4s of
  // serialization on top of each leg's own latency. Cold-instance hits during
  // Googlebot crawls were tipping past the 60s function limit and returning
  // 499s. Now the loader waits on a single Promise.all.
  const carouselBlocks = (cmsData?.sections ?? []).filter(
    (s): s is ProductCarouselBlock => s._type === 'productCarousel',
  )
  const emmaRailBlocks = (cmsData?.sections ?? []).filter(
    (s): s is import('~/types/cms').EmmaCuratedRailBlock => s._type === 'emmaCuratedRail',
  )

  // withTimeout only converts a *timeout* to the fallback; a rejection still
  // propagates. getDealByHandle rejects on any Storefront failure (so the PDP
  // can answer 503 instead of a de-indexing 404), and a missing pair product is
  // never worth 500ing the homepage over, so catch to the same null fallback.
  const pairBundleDealP = (homepageSettings.template === 'pair_bundle' || homepageSettings.template === 'pair_bundle_fullbleed') && homepageSettings.pairProductHandle
    ? withTimeout(getDealByHandle(homepageSettings.pairProductHandle).catch(() => null), LOADER_TIMEOUT_MS, null, 'getDealByHandle(pairBundle)')
    : Promise.resolve(null)

  // Swatches depend on pairBundleDeal — chain rather than serialize the whole
  // loader. The chained .then keeps it parallel with the rest of Promise.all.
  const pairSwatchesP: Promise<Record<string, string>> = withTimeout(
    pairBundleDealP.then(pbd => {
      const labels = homepageSettings.template === 'pair_bundle_fullbleed' && deal && pbd
        ? [
            ...((deal.options ?? []).filter(o => /colou?r/i.test(o.name)).flatMap(o => o.values)),
            ...((pbd.options ?? []).filter(o => /colou?r/i.test(o.name)).flatMap(o => o.values)),
          ]
        : homepageSettings.template === 'endorsement' && deal
          ? (deal.options ?? []).filter(o => /colou?r/i.test(o.name)).flatMap(o => o.values)
          : []
      return labels.length > 0 ? getSwatchMap(labels) : Promise.resolve({})
    }),
    LOADER_TIMEOUT_MS, {} as Record<string, string>, 'pairSwatches',
  )

  const pairDealP = emmaHero?.heroVariant === 'bundle' && emmaHero.pairProductHandle
    ? withTimeout(getDealByHandle(emmaHero.pairProductHandle).catch(() => null), LOADER_TIMEOUT_MS, null, 'getDealByHandle(pairDeal)')
    : Promise.resolve(null)

  const bundleP = deal?.handle
    ? withTimeout(getBundleByHandle(deal.handle), LOADER_TIMEOUT_MS, null, 'getBundleByHandle')
    : Promise.resolve(null)

  const carouselResultsP = carouselBlocks.length > 0
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
      })), LOADER_TIMEOUT_MS, [] as Product[][], 'carouselResults')
    : Promise.resolve([] as Product[][])

  const emmaRailResultsP = emmaRailBlocks.length > 0
    ? withTimeout(Promise.all(emmaRailBlocks.map(b =>
        b.productHandles?.length
          ? getProductsByHandles(normalizeProductHandles(b.productHandles))
          : Promise.resolve([] as Product[]),
      )), LOADER_TIMEOUT_MS, [] as Product[][], 'emmaRailResults')
    : Promise.resolve([] as Product[][])

  // Deal-dependent calls — only meaningful when there's a live deal. When
  // there isn't, short-circuit with empty defaults so the Promise.all stays
  // shape-stable.
  const viewersP = deal
    ? withTimeout(kvGet<number>(KV_KEYS.viewerCount(deal.handle)).then(n => n ?? 0), LOADER_TIMEOUT_MS, 0, 'viewerCount')
    : Promise.resolve(0)
  const reviewDataP = deal
    ? withTimeout(
        getProductReviews(deal.shopifyProductId, { sort: 'newest', page: 1, perPage: 10 }),
        LOADER_TIMEOUT_MS,
        { reviews: [] as Awaited<ReturnType<typeof getProductReviews>>['reviews'], total: 0 },
        'getProductReviews',
      )
    : Promise.resolve({ reviews: [] as Awaited<ReturnType<typeof getProductReviews>>['reviews'], total: 0 })
  const aggregateP = deal
    ? withTimeout(getProductAggregate(deal.shopifyProductId), LOADER_TIMEOUT_MS, null, 'getProductAggregate')
    : Promise.resolve(null)
  const emmaContextRowsP = deal
    ? getEmmaContextRows({ dealHandle: deal.handle, sessionSeed }).catch(err => {
        console.error('[homepage] emma context rows failed:', err)
        return [] as Awaited<ReturnType<typeof getEmmaContextRows>>
      })
    : Promise.resolve([] as Awaited<ReturnType<typeof getEmmaContextRows>>)

  const [
    pairBundleDeal, pairDeal, bundle, carouselResults, emmaRailResults,
    pairSwatches, viewers, reviewData, aggregate, emmaContextRows,
  ] = await Promise.all([
    pairBundleDealP, pairDealP, bundleP, carouselResultsP, emmaRailResultsP,
    pairSwatchesP, viewersP, reviewDataP, aggregateP, emmaContextRowsP,
  ])

  const carouselProductMap: Record<string, Product[]> = {}
  carouselBlocks.forEach((b, i) => { carouselProductMap[b._key] = carouselResults[i] ?? [] })
  emmaRailBlocks.forEach((b, i) => { carouselProductMap[b._key] = emmaRailResults[i] ?? [] })

  if (!deal) {
    const value = {
      variant: 'legacy' as const,
      deal: null, bundle: null, forHim, forHer, bonusDeal,
      viewers: 0, soldToday: 0, cmsData, carouselProductMap,
      emmaHero: null, pairDeal: null, homepageSettings, pairBundleDeal: null,
      emmaContextRows: [], pairSwatches: {} as Record<string, string>,
      seo,
    }
    return isAdmin ? data(value, { headers: ADMIN_BYPASS_HEADERS }) : value
  }

  // No ViewContent here. A homepage visit is not a product detail view: it
  // fired for every visitor regardless of interest, doubled the ViewContent
  // count, and taught Meta that the featured product is viewed by everyone,
  // which corrupts the product-level signal retargeting depends on.

  const value = {
    variant: 'legacy' as const,
    deal, bundle, forHim, forHer, bonusDeal,
    viewers, soldToday: 0, cmsData, carouselProductMap,
    reviews: reviewData.reviews,
    reviewTotal: reviewData.total,
    aggregate: aggregate ?? null,
    emmaHero, pairDeal, homepageSettings, pairBundleDeal,
    emmaContextRows, pairSwatches,
    seo,
  }
  return isAdmin ? data(value, { headers: ADMIN_BYPASS_HEADERS }) : value
}

// LCP preload now lives in ~/lib/image-preload (heroPreloadTag) and is
// CDN-aware: the hero may be a Sanity-hosted editorial still once the homepage
// team publishes generated art, and a Shopify-shaped preload URL against a
// Sanity asset is silently ignored by the browser.

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const canonical = 'https://xdipx.com/'
  // Team-editable homepage title/description resolved in the loader
  // (singleton.homeSeo → brand-default fallback). `data.seo` is present on
  // every non-null loader return; the `!data` fallback keeps the hard-coded
  // brand defaults for the error/empty case.
  const seoTitle = data?.seo?.title ?? BRAND_TITLE
  const seoDescription = data?.seo?.description ?? BRAND_DESCRIPTION
  const seoOgImage = data?.seo?.ogImageUrl ?? null
  // Variant A uses the team-editable brand-level snippet -- no deal fields.
  if (!data || data.variant === 'a') {
    return [
      { title: seoTitle },
      { name: 'description', content: seoDescription },
      { tagName: 'link', rel: 'canonical', href: canonical },
      { tagName: 'link', rel: 'alternate', type: 'text/markdown', href: 'https://xdipx.com/index.md' },
      ...buildSocialMeta({ title: seoTitle, description: seoDescription, url: canonical, image: seoOgImage, type: 'website' }),
    ]
  }
  // Variant B (storefront): team-editable brand-level snippet, but preload the
  // LCP hero image — the first featured product's image — same AVIF responsive
  // preload as the legacy/deal home gets for its hero. Guarded for empty
  // featured (cold KV / degraded render). An explicit homeSeo OG image wins;
  // otherwise the featured hero image is the social card.
  if (data.variant === 'b') {
    // `sizes` must stay byte-identical to the `<OptimizedImage priority sizes=...>`
    // StorefrontHome.tsx actually renders for this image (ticket #13146): the
    // default `heroPreloadTag` sizes breaks at 768px while StorefrontHome's
    // hero breaks at 1024px, so a 769-1023px viewport fetched one width from
    // the mismatched preload hint and a different width for the real `<img>`,
    // two downloads instead of one.
    const heroPreload = heroPreloadTag(data.featured[0]?.imageUrl, { sizes: '(max-width: 1024px) 100vw, 50vw' })
    return [
      { title: seoTitle },
      { name: 'description', content: seoDescription },
      { tagName: 'link', rel: 'canonical', href: canonical },
      { tagName: 'link', rel: 'alternate', type: 'text/markdown', href: 'https://xdipx.com/index.md' },
      ...(heroPreload ? [heroPreload] : []),
      ...buildSocialMeta({
        title: seoTitle,
        description: seoDescription,
        url: canonical,
        image: seoOgImage ?? data.featured[0]?.imageUrl ?? null,
        type: 'website',
      }),
    ]
  }
  if (!('deal' in data) || !data.deal || !('seoTitle' in data.deal)) {
    return [
      { title: seoTitle },
      { name: 'description', content: seoDescription },
      { tagName: 'link', rel: 'canonical', href: canonical },
      { tagName: 'link', rel: 'alternate', type: 'text/markdown', href: 'https://xdipx.com/index.md' },
      ...buildSocialMeta({ title: seoTitle, description: seoDescription, url: canonical, image: seoOgImage, type: 'website' }),
    ]
  }
  // Legacy daily-deal home: the product-specific SEO title stays the strongest
  // signal; homeSeo's description is the fallback when the deal has none.
  const { deal } = data
  // BRAND_NAME, not BRAND_TITLE: BRAND_TITLE already contains a `|` separator,
  // so composing with it here would emit a double-pipe title well past 60 chars.
  const title = `${deal.seoTitle} | ${BRAND_NAME}`
  const description = deal.metaDescription || seoDescription
  const heroPreload = heroPreloadTag(deal.images[0]?.url)
  return [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: canonical },
    { tagName: 'link', rel: 'alternate', type: 'text/markdown', href: 'https://xdipx.com/index.md' },
    ...(heroPreload ? [heroPreload] : []),
    ...buildSocialMeta({
      title,
      description,
      url: canonical,
      // An explicit homeSeo OG override wins, same precedence as variants a/b.
      image: seoOgImage ?? deal.images[0]?.url ?? null,
      type: 'website',
      imageAlt: deal.seoTitle,
    }),
  ]
}

export default function Homepage() {
  const loaderData = useLoaderData<typeof loader>()

  // ── Variant A: "The Compass" discovery home page ─────────────────────────
  if (loaderData.variant === 'a') {
    return (
      <>
        {/* HomeA is lazy-loaded (ticket #13146); fallback null is safe since
            the shell and the hero markup it renders have no SSR-only content
            above the fold that would otherwise reserve layout space. */}
        <Suspense fallback={null}>
          <HomeA
            rails={loaderData.rails}
            total={loaderData.total}
            welcomeBackEnabled={loaderData.welcomeBackEnabled}
            moods={loaderData.moods}
            audiences={loaderData.audiences}
            matters={loaderData.matters}
            available={loaderData.available}
          />
        </Suspense>
        {/* Sanity CMS content blocks, deferred so they never block the shell's
            TTFB — they stream in below the discovery rails. Reuses the same
            renderer + section schema as the legacy home. */}
        <Suspense fallback={null}>
          <Await resolve={loaderData.contentBlocks} errorElement={null}>
            {({ sections, carouselProductMap }) =>
              sections.length > 0 ? (
                <>
                  {sections.map(block => (
                    <ContentBlockRenderer
                      key={block._key}
                      block={block}
                      carouselProductMap={carouselProductMap}
                    />
                  ))}
                </>
              ) : null
            }
          </Await>
        </Suspense>
      </>
    )
  }

  // ── Variant B: the new traditional storefront home page ───────────────────
  if (loaderData.variant === 'b') {
    return <StorefrontHome {...loaderData} />
  }

  // ── Legacy path ───────────────────────────────────────────────────────────
  // Extracted to its own lazily-loaded module (ticket #13146): see
  // LegacyHome's own doc comment for why. It reads loaderData/outlet context
  // itself via hooks, so no props are threaded through here.
  return (
    <Suspense fallback={null}>
      <LegacyHome />
    </Suspense>
  )
}
