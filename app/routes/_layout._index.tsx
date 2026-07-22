import { Suspense, useEffect } from 'react'
import type { HeadersFunction, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Await, Link, data, useLoaderData, useOutletContext } from 'react-router'
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
import { assembleStorefrontHome } from '~/lib/storefront-home.server'
import { HomeA } from '~/components/discovery/HomeA'
import { StorefrontHome } from '~/components/store/StorefrontHome'
import { getBundleByHandle }                    from '~/lib/bundles.server'
import { getProductReviews, getProductAggregate } from '~/lib/reviews.server'
import { getEmmaContextRows }    from '~/lib/emma-rails.server'
import { getCartIdFromCookie }   from '~/lib/cart.server'
import { fireCapiEvent } from '~/lib/meta-capi.server'
import { getSwatchMap }          from '~/lib/swatches.server'
import { EmmaHero }              from '~/components/store/EmmaHero'
import { BundleHero }            from '~/components/store/BundleHero'
import { QuietEndorsementHero }  from '~/components/store/QuietEndorsementHero'
import { PairBundleHero }        from '~/components/store/PairBundleHero'
import { PairBundleFullBleedHero } from '~/components/store/PairBundleFullBleedHero'
import { EndorsementHero }       from '~/components/store/EndorsementHero'
import { ProductCarousel }       from '~/components/cms/ProductCarousel'
import { EmmaContextRow }        from '~/components/home/EmmaContextRow'
import { EmailSubscribe }        from '~/components/store/EmailSubscribe'
import { ContentBlockRenderer }  from '~/components/cms/ContentBlockRenderer'
import { TrustBarBlock }         from '~/components/cms/TrustBarBlock'
import { ProductStructuredData } from '~/components/seo/ProductStructuredData'
import type { Product } from '~/types'
import { categoryToLegacyString } from '~/types'
import type { ProductCarouselBlock, TrustBarBlock as TrustBarBlockType } from '~/types/cms'
import { trackViewItem, trackViewItemList, trackDealView, type GA4Item } from '~/lib/analytics.client'
import { trackFbViewContent } from '~/lib/meta-pixel.client'
import { buildSocialMeta } from '~/lib/social-meta'
import { heroPreloadTag } from '~/lib/image-preload'
import { BRAND_TITLE, BRAND_DESCRIPTION } from '~/lib/brand'
import { withTimeout } from '~/lib/with-timeout.server'

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
    const value = { ...await loadVariantAData(request, { welcomeBackEnabled, isAdmin: !!adminUser }), seo }
    return adminUser ? data(value, { headers: ADMIN_BYPASS_HEADERS }) : value
  }

  // ── Variant B: the new traditional storefront home page ───────────────────
  // Content-rich, crawlable catalog front door. Reuses the discovery index for
  // "best of" rails so there is no cold-KV degraded-HTML gap. Default stays
  // 'legacy'/'a' until HOME_VARIANT=b (or Sanity activeVariant='b') flips it on.
  if (variant === 'b') {
    const adminUser = await getAdminUser(request).catch(() => null)
    const value = { ...await assembleStorefrontHome(), seo }
    if (adminUser) return data(value, { headers: ADMIN_BYPASS_HEADERS })
    // Cold KV / degraded assembly (no rails, no featured product) — never let
    // the edge cache pin a blank storefront for the next 60s+SWR window.
    const isDegraded = value.rails.length === 0 && value.featured.length === 0
    return isDegraded ? data(value, { headers: DEGRADED_NO_STORE_HEADERS }) : value
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

  const pairBundleDealP = (homepageSettings.template === 'pair_bundle' || homepageSettings.template === 'pair_bundle_fullbleed') && homepageSettings.pairProductHandle
    ? withTimeout(getDealByHandle(homepageSettings.pairProductHandle), LOADER_TIMEOUT_MS, null, 'getDealByHandle(pairBundle)')
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
    ? withTimeout(getDealByHandle(emmaHero.pairProductHandle), LOADER_TIMEOUT_MS, null, 'getDealByHandle(pairDeal)')
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
          return getProductsByHandles(b.productHandles.map(p => p.handle))
        }
        return b.shopifyTag ? getProductsByTag(b.shopifyTag, limit) : Promise.resolve([] as Product[])
      })), LOADER_TIMEOUT_MS, [] as Product[][], 'carouselResults')
    : Promise.resolve([] as Product[][])

  const emmaRailResultsP = emmaRailBlocks.length > 0
    ? withTimeout(Promise.all(emmaRailBlocks.map(b =>
        b.productHandles?.length
          ? getProductsByHandles(b.productHandles.map(p => p.handle))
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
      viewContentEventId: null as string | null,
      seo,
    }
    return isAdmin ? data(value, { headers: ADMIN_BYPASS_HEADERS }) : value
  }

  // Generate a dedup id shared with the browser pixel. ViewContent failure is non-fatal.
  const viewContentEventId = fireCapiEvent(request, 'ViewContent', {
    contentIds: [deal.shopifyProductId],
    value:      deal.dealPrice,
  })

  const value = {
    variant: 'legacy' as const,
    deal, bundle, forHim, forHer, bonusDeal,
    viewers, soldToday: 0, cmsData, carouselProductMap,
    reviews: reviewData.reviews,
    reviewTotal: reviewData.total,
    aggregate: aggregate ?? null,
    emmaHero, pairDeal, homepageSettings, pairBundleDeal,
    emmaContextRows, pairSwatches,
    viewContentEventId,
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
    const heroPreload = heroPreloadTag(data.featured[0]?.imageUrl)
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
  const title = `${deal.seoTitle} | ${BRAND_TITLE}`
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
      image: deal.images[0]?.url ?? null,
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
        <HomeA
          rails={loaderData.rails}
          total={loaderData.total}
          welcomeBackEnabled={loaderData.welcomeBackEnabled}
          moods={loaderData.moods}
          audiences={loaderData.audiences}
          matters={loaderData.matters}
          available={loaderData.available}
        />
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
  const {
    deal, bundle, forHim, forHer, bonusDeal,
    cmsData, carouselProductMap,
    emmaHero, pairDeal, homepageSettings, pairBundleDeal,
    emmaContextRows, pairSwatches,
  } = loaderData
  const { buyButtonText } = useOutletContext<{ buyButtonText: string }>()

  // ── GA4: track deal view + item lists ───────────────────────────────────
  useEffect(() => {
    if (!deal) return
    const item: GA4Item = {
      item_id: deal.shopifyProductId,
      item_name: deal.seoTitle,
      item_brand: deal.brand,
      item_category: categoryToLegacyString(deal.category),
      price: deal.dealPrice,
    }
    trackViewItem(item, deal.dealPrice)
    trackDealView(deal.handle, deal.seoTitle, deal.dealPrice)
  }, [deal?.handle])

  // ── Meta Pixel: ViewContent (fire-once side-effect, not data fetching) ───
  // viewContentEventId was generated server-side so the browser pixel and
  // server CAPI share the same id for Meta-side deduplication.
  const { viewContentEventId } = loaderData
  useEffect(() => {
    if (!deal || !viewContentEventId) return
    trackFbViewContent(
      { content_ids: [deal.shopifyProductId], value: deal.dealPrice, currency: 'USD' },
      viewContentEventId,
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal?.handle])

  useEffect(() => {
    if (forHim.length > 0) {
      trackViewItemList('for_him', 'For Him', forHim.map((p, i) => ({
        item_id: p.id, item_name: p.title, ...(p.brand ? { item_brand: p.brand } : {}), price: p.price, index: i,
      })))
    }
    if (forHer.length > 0) {
      trackViewItemList('for_her', 'For Her', forHer.map((p, i) => ({
        item_id: p.id, item_name: p.title, ...(p.brand ? { item_brand: p.brand } : {}), price: p.price, index: i,
      })))
    }
  }, [forHim, forHer])

  // Split CMS sections: those that sit above BonusDeal/Vault vs below
  const cmsSections = cmsData?.sections ?? []
  // announcementBar is handled in _layout.tsx — exclude it here
  const allContentBlocks = cmsSections.filter(s => s._type !== 'announcementBar')
  // Lift Emma-curated rails out of the regular content stream so they render
  // directly below the hero, matching the editorial intent (rails are deal-
  // specific cross-sell, not bottom-of-page CMS modules).
  const emmaCuratedRails = allContentBlocks.filter(
    (b): b is import('~/types/cms').EmmaCuratedRailBlock => b._type === 'emmaCuratedRail',
  )
  // For the pair_bundle_fullbleed and endorsement templates, lift the first
  // trust bar out of the regular content stream so it can render directly
  // below the price strip inside the hero.
  const isFullBleedPair = !!(deal && homepageSettings.template === 'pair_bundle_fullbleed' && pairBundleDeal && deal.pairBundleCopy)
  const isEndorsement   = !!(deal && homepageSettings.template === 'endorsement' && deal.endorsementCopy)
  const liftedTrustBar  = (isFullBleedPair || isEndorsement)
    ? (allContentBlocks.find((b): b is TrustBarBlockType => b._type === 'trustBar') ?? null)
    : null
  const liftedKeys = new Set<string>(emmaCuratedRails.map(b => b._key))
  if (liftedTrustBar) liftedKeys.add(liftedTrustBar._key)
  const contentBlocks = allContentBlocks.filter(b => !liftedKeys.has(b._key))

  // MAP-restricted: prefer the Shopify metafield; fall back to MAP-vs-MSRP heuristic
  // for legacy products without the `map_restricted` flag set.
  const mapRestricted = !!(deal && (deal.mapRestricted ?? (deal.mapPrice > 0 && deal.mapPrice >= deal.msrp)))

  // Priority: Shopify `xdipx.emma_hero` metafield (Claude-generated on promotion)
  // → Sanity `emmaHero` doc (manual editorial override) → component defaults.
  const shopifyEmma = deal?.emmaHero
  const heroVariant = shopifyEmma?.variant ?? emmaHero?.heroVariant ?? 'loving'
  const heroCopy = shopifyEmma
    ? {
        eyebrow:  shopifyEmma.eyebrow,
        headline: shopifyEmma.headline,
        body:     shopifyEmma.body,
        aside:    shopifyEmma.aside,
        ...(shopifyEmma.pullQuote ? { pullQuote: shopifyEmma.pullQuote } : {}),
      }
    : emmaHero
      ? {
          ...(emmaHero.eyebrow   ? { eyebrow:   emmaHero.eyebrow }   : {}),
          ...(emmaHero.headline  ? { headline:  emmaHero.headline }  : {}),
          ...(emmaHero.body      ? { body:      emmaHero.body }      : {}),
          ...(emmaHero.aside     ? { aside:     emmaHero.aside }     : {}),
          ...(emmaHero.pullQuote ? { pullQuote: emmaHero.pullQuote } : {}),
        }
      : undefined

  return (
    <>
      {bundle ? (
        <BundleHero bundle={bundle} buyButtonText={buyButtonText} />
      ) : deal && homepageSettings.template === 'pair_bundle' && pairBundleDeal && deal.pairBundleCopy ? (
        <>
          <PairBundleHero
            primary={deal}
            partner={pairBundleDeal}
            copy={deal.pairBundleCopy}
            discountPct={homepageSettings.pairDiscountPct}
          />
          <ProductStructuredData deal={deal} />
        </>
      ) : deal && homepageSettings.template === 'pair_bundle_fullbleed' && pairBundleDeal && deal.pairBundleCopy ? (
        <>
          <PairBundleFullBleedHero
            primary={deal}
            partner={pairBundleDeal}
            copy={deal.pairBundleCopy}
            discountPct={homepageSettings.pairDiscountPct}
            trustBar={liftedTrustBar ? <TrustBarBlock block={liftedTrustBar} frameless /> : null}
            swatches={pairSwatches ?? {}}
          />
          <ProductStructuredData deal={deal} />
        </>
      ) : deal && homepageSettings.template === 'endorsement' && deal.endorsementCopy ? (
        <>
          <EndorsementHero
            deal={deal}
            copy={deal.endorsementCopy}
            showFreeShipping={homepageSettings.showFreeShipping}
            swatches={pairSwatches ?? {}}
          />
          {/* Emma contextual rails — sit between the hero and the trust bar.
              Each rail links to its configured collection; empty / unconfigured
              rails are skipped so half-edited drafts don't render dead links.
              The first rail is positioned as "Staff Picks" and the second as
              "Try something new" — admin-editable rail titles still render
              as the curated headline beneath. */}
          {deal.endorsementCopy.rails && deal.endorsementCopy.rails.filter(r => r.collectionHandle && r.title).length > 0 && (
            <section className="bg-cream">
              <div className="max-w-6xl mx-auto px-4 pt-3 pb-3 grid gap-3 md:grid-cols-2">
                {deal.endorsementCopy.rails
                  .filter(r => r.collectionHandle && r.title)
                  .slice(0, 2)
                  .map((rail, i) => (
                    <Link
                      key={rail.collectionHandle}
                      to={`/collections/${rail.collectionHandle}`}
                      className="group block rounded-[var(--radius-lg)] border border-line bg-paper px-5 py-4 hover:bg-cream-2 transition-colors"
                    >
                      <p className="text-[11px] uppercase tracking-[0.18em] text-coral font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                        {i === 0 ? 'Staff Picks' : 'Try something new'}
                      </p>
                      <p className="mt-1 text-base md:text-lg italic text-ink group-hover:text-coral transition-colors" style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>
                        {rail.title} <span aria-hidden="true">→</span>
                      </p>
                    </Link>
                  ))}
              </div>
            </section>
          )}
          {/* Trust bar — anchors the foot of the endorsement section, below
              the rails. Lifted out of the regular content stream upstream so
              it only renders here for the endorsement template. */}
          {liftedTrustBar && (
            <div className="bg-cream">
              <div className="max-w-6xl mx-auto px-4 pt-3 pb-10 md:pb-14">
                <TrustBarBlock block={liftedTrustBar} frameless />
              </div>
            </div>
          )}
          <ProductStructuredData deal={deal} />
        </>
      ) : deal && homepageSettings.template === 'quiet_endorsement' && deal.quietEndorsementCopy ? (
        <>
          <QuietEndorsementHero deal={deal} showFreeShipping={homepageSettings.showFreeShipping} />
          <ProductStructuredData deal={deal} />
        </>
      ) : deal ? (
        <>
          <EmmaHero
            deal={deal}
            variant={heroVariant}
            mapRestricted={mapRestricted}
            {...(heroCopy ? { copy: heroCopy } : {})}
            pairDeal={pairDeal}
          />

          <ProductStructuredData deal={deal} />
        </>
      ) : (
        <div className="max-w-2xl mx-auto px-4 py-24 text-center">
          <p className="text-sage text-5xl mb-4">♥</p>
          <h1
            className="text-3xl font-bold text-ink mb-3"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Something good is coming.
          </h1>
          <p className="text-ink/60">
            Emma's next pick is just around the corner.
          </p>
        </div>
      )}

      {/* ── Emma curated rails (admin-published cross-sell, lifted to sit
            directly under the hero so deal-specific rails read as part of
            the editorial spread). ──────────────────────────────────────── */}
      {emmaCuratedRails.map(block => (
        <ContentBlockRenderer
          key={block._key}
          block={block}
          carouselProductMap={carouselProductMap}
          bonusDealProduct={bonusDeal}
        />
      ))}

      {/* ── Emma context rows (AI-personalized rails under the hero) ──────── */}
      {emmaContextRows && emmaContextRows.length > 0 && emmaContextRows.map(row => (
        <EmmaContextRow key={row.rail.id} row={row} />
      ))}

      {/* ── CMS content blocks (ordered by Sanity `order` field) ──────────── */}
      {contentBlocks.map(block => (
        <ContentBlockRenderer
          key={block._key}
          block={block}
          carouselProductMap={carouselProductMap}
          bonusDealProduct={bonusDeal}
        />
      ))}

      {/* ── Hardcoded sections (shown when no CMS carousel blocks replace them) */}
      {!contentBlocks.some(b => b._type === 'productCarousel') && (
        <>
          <ProductCarousel
            heading="Dialed in. Just for him. ♥"
            eyebrow="For Him"
            ctaLink="/for-him"
            ctaLabel="See all →"
            bgStyle="mist"
            products={forHim}
          />
          <ProductCarousel
            heading="Made for her. Obviously. ♥"
            eyebrow="For Her"
            ctaLink="/for-her"
            ctaLabel="See all →"
            bgStyle="cream"
            products={forHer}
          />
        </>
      )}

      <EmailSubscribe />
    </>
  )
}
