import { Suspense, useState, useRef, useEffect, useMemo, useCallback } from 'react'
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Await, data, useLoaderData, useOutletContext, useFetcher, useSearchParams, useRouteLoaderData } from 'react-router'
import type { loader as layoutLoader } from '~/routes/_layout'
import { ProductImageGallery, type GalleryItem } from '~/components/store/ProductImageGallery'
import { ReviewList } from '~/components/reviews/ReviewList'
import {
  getDealByHandle, getProductsByTag,
  getCollectionProducts, getProductsByHandles,
  getProductsByIds, getMainMenu,
  StorefrontUnavailableError,
} from '~/lib/shopify.server'
import { normalizeProductHandles } from '~/lib/product-handles'
import { resolveBreadcrumbs, type BreadcrumbCrumb } from '~/lib/breadcrumbs.server'
import { getProductPageBlocks, getProductFaqs, getPdpTrustBar, getNotebookPostsForProduct, getNotebookPostsForProductType } from '~/lib/sanity.server'
import { getBundleByHandle, getBundleCompanionFor } from '~/lib/bundles.server'
// Reviews: UI + aggregateRating JSON-LD flip together behind the
// reviews_pdp_enabled valve. They must never be decoupled (Google's
// review-snippet policy requires ratings be visible on-page), and
// deal.rating only ever comes from real approved customer reviews.
import { getProductReviews, getProductAggregate } from '~/lib/reviews.server'
import type { Review, ReviewAggregate } from '~/types/reviews'
import { getValve } from '~/lib/team.server'
import { VALVE_KEYS } from '~/lib/team-keys'
import { getFrequentlyBoughtWith } from '~/lib/recommendations.server'
import {
  getProductVoteAggregate,
  getCustomerProductVote,
  type ProductVoteAggregate,
} from '~/lib/dial-votes.server'
import { getCustomerToken } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import { getCartIdFromCookie } from '~/lib/cart.server'
import { fireCapiEvent } from '~/lib/meta-capi.server'
import { isCapiEligible } from '~/lib/capi-eligibility.server'
import { getCart } from '~/lib/shopify.server'
import { getEmmaAside, type EmmaAsideResult } from '~/lib/emma-aside.server'
import { isCrawlerRequest, qualifiesForPaidAside } from '~/lib/crawler-ua.server'
import { parseBrowseCookie, buildBrowseCookie } from '~/lib/browse-history.server'
import { checkRateLimit } from '~/lib/rate-limit.server'
// EmmaContextualAside / Skeleton no longer used — Emma's take now lives inside
// the SEO summary grid via EmmaTakeBody (defined below).
import { getFallbackAside } from '~/lib/emma-aside-templates'
import { STOREFRONT_CACHE_HEADERS } from '~/lib/cache-headers'
import { shopifyImageUrl } from '~/lib/shopify-image'
import BundleHero from '~/components/store/BundleHero'
import BundleSaveCard from '~/components/store/BundleSaveCard'
import { ProductStructuredData }  from '~/components/seo/ProductStructuredData'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { FAQStructuredData }      from '~/components/seo/FAQStructuredData'
import { HowToStructuredData }    from '~/components/seo/HowToStructuredData'
import { VideoStructuredData }    from '~/components/seo/VideoStructuredData'
import { ProductFaqList }         from '~/components/store/ProductFaqList'
import { BreadcrumbNav } from '~/components/blog/BreadcrumbNav'
import { NotebookRail } from '~/components/blog/NotebookRail'
import type { BlogPostCard } from '~/types/cms'
// ProductTabs removed — content now lives in the SEO summary grid above.
import RecentlyBrowsed            from '~/components/store/RecentlyBrowsed'
import FrequentlyBoughtWith       from '~/components/store/FrequentlyBoughtWith'
import { SensationDial }          from '~/components/store/SensationDial'
import { PairsWith, type PairsWithItem } from '~/components/store/PairsWith'
import { VariantSelector, resolveVariant } from '~/components/store/VariantSelector'
import { CircleOptionSelector } from '~/components/store/CircleOptionSelector'
import { ProductSummaryGrid } from '~/components/store/ProductSummaryGrid'
import { getSwatchMap } from '~/lib/swatches.server'
import { StockIndicator } from '~/components/store/StockIndicator'
import { WaitlistButton }         from '~/components/store/WaitlistButton'
import { SubscriptionSelector } from '~/components/store/SubscriptionSelector'
import { getSubscriptionPrice, getBestSubscriptionOffer } from '~/lib/selling-plan'
import { EmailSubscribe }         from '~/components/store/EmailSubscribe'
import { ContentBlockRenderer }   from '~/components/cms/ContentBlockRenderer'
import { TrustBarBlock }          from '~/components/cms/TrustBarBlock'
import type { Product } from '~/types'
import { categoryToLegacyString } from '~/types'
import type { ProductCarouselBlock, ProductFaq, TrustBarBlock as TrustBarBlockType } from '~/types/cms'
import { trackViewItem, trackAddToCart } from '~/lib/analytics.client'
import { trackFbViewContent, trackFbAddToCart } from '~/lib/meta-pixel.client'
import { ShareButtons } from '~/components/common/ShareButtons'
import { HeartButton } from '~/components/store/HeartButton'
import { Toast } from '~/components/account/Toast'
import { buildSocialMeta } from '~/lib/social-meta'

/** Max combined product cards across the two PDP cross-link rails. */
const PDP_CROSSLINK_CAP = 7

// ─── Loader ───────────────────────────────────────────────────────────────────

export function headers() {
  return STOREFRONT_CACHE_HEADERS
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const slug = params['slug']!

  // ── Batch A ─────────────────────────────────────────────────────────────────
  // The deal fetch and every slug-only CMS fetch are mutually independent, so
  // fire them together rather than blocking the CMS calls behind the deal
  // round-trip. The customer token (cookie read) rides along too. The bundle
  // lookup rides along here as well (cached() so this stays a cheap KV hit) —
  // its result is branched on after the batch resolves, below.
  const [deal, pdpBlocks, fbtHandles, companionBundle, faqs, mainMenu, pdpTrustBar, customerToken, bundle, embedNotebookPosts] = await Promise.all([
    // A Storefront outage must never reach the `!deal` 404 below. Google reads
    // a 404 as "drop this URL"; a 503 with Retry-After reads as "come back",
    // which is the truth when Shopify simply did not answer in time.
    getDealByHandle(slug).catch((err: unknown) => {
      if (err instanceof StorefrontUnavailableError) {
        console.error(`[pdp] ${slug}: ${err.message}`)
        throw new Response('Product temporarily unavailable', {
          status: 503,
          headers: { 'Retry-After': '120', 'Cache-Control': 'no-store' },
        })
      }
      throw err
    }),
    getProductPageBlocks(slug),
    getFrequentlyBoughtWith(slug, 4),
    getBundleCompanionFor(slug),
    getProductFaqs(slug),
    getMainMenu(),
    getPdpTrustBar(),
    getCustomerToken(request),
    getBundleByHandle(slug),
    getNotebookPostsForProduct(slug, 3),
  ])

  // Bundle fast-path: if Sanity has a bundle doc for this handle, render the
  // BundleHero instead of the normal PDP. Shopify product still needs to exist
  // (for the handle), but we skip the heavy PDP data fetches.
  if (bundle) {
    return {
      type: 'bundle' as const,
      bundle,
      deal: null,
      swatches: {} as Record<string, string>,
      pdpBlocks: [],
      carouselProductMap: {},
      fbtProducts: [],
      pairsWithItems: [] as PairsWithItem[],
      productVoteAggregate: { agrees: 0, disagrees: 0, agreePct: 0 } as ProductVoteAggregate,
      customerProductVote: null as (1 | -1 | null),
      isLoggedIn: false,
      companionBundle: null,
      faqs: [] as ProductFaq[],
      emmaAsideStatic: '',
      emmaAsidePromise: null as Promise<EmmaAsideResult> | null,
      reviewData: null as { aggregate: ReviewAggregate; reviews: Review[]; total: number } | null,
      reviewPage: 1, reviewSort: 'newest', reviewFilter: 'all',
      breadcrumbs: [
        { label: 'Home', url: 'https://xdipx.com/', href: '/' },
        { label: bundle.title, url: `https://xdipx.com/products/${bundle.handle}`, href: `/products/${bundle.handle}` },
      ] as BreadcrumbCrumb[],
      pdpTrustBar: null as TrustBarBlockType | null,
      notebookPosts: [] as BlogPostCard[],
    }
  }

  // A product the Storefront API *answered about* and does not return is
  // genuinely gone (unpublished or Shopify-archived) and 404s here. Reaching
  // this line means Shopify responded — an outage was already turned into a
  // 503 above, so a slow or failing Shopify can no longer de-index a live PDP.
  // There is no second, metafield-driven gate: the old
  // `deal_status === 'archived'` check was daily-deal bookkeeping, and it 410'd
  // 17 active, sellable products whose only sin was having once been a deal.
  if (!deal) throw new Response('Product not found', { status: 404 })

  // Related-guides rail data. Posts that embed THIS product are the strongest
  // signal, so they win when they exist. Otherwise fall back to the latest
  // guides sharing this product's type so the product still links out to
  // editorial (closes the product -> guide loop for AEO). A curated
  // relatedGuides content block, when present, overrides this rail in the
  // component. The fallback query only fires when there are no direct posts.
  let notebookPosts = embedNotebookPosts
  if (notebookPosts.length === 0 && deal.productTypeDial) {
    notebookPosts = await getNotebookPostsForProductType(deal.productTypeDial, slug, 3)
  }

  // Resolve current customer (for sticky vote state + gating). Failures here
  // are non-fatal — PDP still renders for anonymous users.
  let customerGid: string | null = null
  if (customerToken) {
    try {
      const profile = await customerAPI(customerToken).getProfile()
      customerGid = profile?.id ?? null
    } catch { /* treat as anonymous */ }
  }
  const isLoggedIn = !!customerGid

  const hasDial = !!(deal.productTypeDial && (deal.sensationDialV2?.items?.length || (deal.sensationDial && Object.keys(deal.sensationDial).length > 0)))
  const hasPairing = !!(deal.pairingWhy && Object.keys(deal.pairingWhy).length > 0 && deal.accessoryProductIds.length > 0)

  const colorLabels = (deal.options ?? [])
    .filter(o => o.name.toLowerCase() === 'color' || o.name.toLowerCase() === 'colour')
    .flatMap(o => o.values)

  // productCarousel + emmaCuratedRail blocks need Shopify product hydration.
  // The block lists come from pdpBlocks (Batch A), so build them now and resolve
  // their product fetches inside Batch B instead of in separate serial awaits.
  const carouselBlocks = pdpBlocks.filter(
    (b): b is ProductCarouselBlock => b._type === 'productCarousel',
  )
  const emmaRailBlocks = pdpBlocks.filter(
    (b): b is import('~/types/cms').EmmaCuratedRailBlock => b._type === 'emmaCuratedRail',
  )

  // Review list URL params (namespaced so they can't clash with variant params).
  const requestUrl = new URL(request.url)
  const reviewPage   = Math.max(1, Number(requestUrl.searchParams.get('reviewPage') ?? '1') || 1)
  const reviewSort   = requestUrl.searchParams.get('reviewSort') ?? 'newest'
  const reviewFilter = requestUrl.searchParams.get('reviewFilter') ?? 'all'

  // ── Batch B ─────────────────────────────────────────────────────────────────
  // Everything that depends on the resolved deal (and customer), plus FBT
  // hydration and carousel/rail product resolution — all independent of each
  // other, so one parallel batch instead of three serial hops.
  const [productVoteAggregate, customerProductVote, pairProducts, swatches, fbtResolved, carouselResults, railResults, reviewData] = await Promise.all([
    hasDial
      ? getProductVoteAggregate(deal.shopifyProductId)
      : Promise.resolve({ agrees: 0, disagrees: 0, agreePct: 0 } as ProductVoteAggregate),
    hasDial && customerGid
      ? getCustomerProductVote(deal.shopifyProductId, customerGid)
      : Promise.resolve(null as (1 | -1 | null)),
    hasPairing ? getProductsByIds(deal.accessoryProductIds) : Promise.resolve([]),
    colorLabels.length > 0 ? getSwatchMap(colorLabels) : Promise.resolve({} as Record<string, string>),
    fbtHandles.length > 0 ? getProductsByHandles(fbtHandles) : Promise.resolve([] as Awaited<ReturnType<typeof getProductsByHandles>>),
    carouselBlocks.length > 0
      ? Promise.all(carouselBlocks.map(b => {
          const limit = b.productLimit ?? 8
          const source = b.source ?? 'tag'
          if (source === 'collection' && b.collectionHandle) {
            return getCollectionProducts(b.collectionHandle, limit)
          }
          if (source === 'manual' && b.productHandles?.length) {
            return getProductsByHandles(normalizeProductHandles(b.productHandles))
          }
          return b.shopifyTag ? getProductsByTag(b.shopifyTag, limit) : Promise.resolve([] as Product[])
        }))
      : Promise.resolve([] as Product[][]),
    emmaRailBlocks.length > 0
      ? Promise.all(emmaRailBlocks.map(b =>
          b.productHandles?.length
            ? getProductsByHandles(normalizeProductHandles(b.productHandles))
            : Promise.resolve([] as Product[]),
        ))
      : Promise.resolve([] as Product[][]),
    // Reviews: gated by the reviews_pdp_enabled valve. UI and aggregateRating
    // JSON-LD flip together; valve off (or any failure) = null = no reviews
    // surface at all, exactly the pre-flip behavior.
    (async (): Promise<{ aggregate: ReviewAggregate; reviews: Review[]; total: number } | null> => {
      try {
        if (!(await getValve(VALVE_KEYS.reviewsPdp))) return null
        const [aggregate, list] = await Promise.all([
          getProductAggregate(deal.shopifyProductId),
          getProductReviews(deal.shopifyProductId, { page: reviewPage, sort: reviewSort as never, filter: reviewFilter as never }),
        ])
        if (!aggregate || aggregate.approvedCount < 1) return null
        return { aggregate, reviews: list.reviews, total: list.total }
      } catch (err) {
        console.error('[pdp:reviews] load failed (non-fatal):', err)
        return null
      }
    })(),
  ])

  // aggregateRating in Product JSON-LD comes ONLY from real approved customer
  // reviews, and only while the on-page review block renders (same valve).
  // Never populate deal.rating from any other source (see commit 4a5b165).
  if (reviewData) {
    deal.rating = { value: reviewData.aggregate.averageRating, count: reviewData.aggregate.approvedCount }
  }

  const breadcrumbs: BreadcrumbCrumb[] = resolveBreadcrumbs({
    menu: mainMenu,
    productCollectionHandles: (deal.collections ?? []).map(c => c.handle),
    productTitle: deal.seoTitle,
    productHandle: deal.handle,
  })

  // Add variantId so fbtProducts can be added to cart from the in-line
  // "Customers also buy" mini-module above the Add-to-cart form. Drop items
  // without a usable first variant — they can't be checked out anyway.
  // Also defensively exclude self in case a recommendation source ever lets
  // the current product through.
  const fbtProducts = fbtResolved
    .map(p => {
      const variantId = p.variants[0]?.id
      if (!variantId) return null
      if (variantId === deal.variantId) return null
      return {
        handle:         p.handle,
        title:          p.title,
        image:          p.images[0]?.url ?? null,
        price:          p.price,
        compareAtPrice: p.compareAtPrice ?? null,
        variantId,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  const pairsWithItems: PairsWithItem[] = hasPairing
    ? pairProducts
        .map(p => {
          const variantId = p.variants[0]?.id
          if (!variantId) return null
          const why = deal.pairingWhy?.[p.id]
          return {
            shopifyProductId: p.id,
            handle:           p.handle,
            title:            p.title,
            image:            p.images[0]?.url ?? null,
            price:            p.price,
            compareAtPrice:   p.compareAtPrice ?? null,
            variantId,
            hasMultipleVariants: p.variants.length > 1,
            ...(why ? { why } : {}),
          } satisfies PairsWithItem
        })
        .filter((x): x is PairsWithItem => x !== null)
        .slice(0, 3)
    : []

  // ── Emma contextual aside ─────────────────────────────────────────────────
  // SEO-visible static aside: deterministic, no Claude call. Either the admin-
  // generated emmaHero.aside (preferred — already brand-voiced and approved)
  // or the per-product hash-stable template fallback. Always present in the
  // initial server-rendered HTML so Googlebot, social crawlers, and JS-off
  // users see real Emma copy instead of a "loading…" placeholder.
  const emmaAsideStatic =
    deal.emmaHero?.aside?.trim() ||
    getFallbackAside({
      id: deal.id,
      ...(deal.productTypeDial ? { productTypeDial: deal.productTypeDial } : {}),
    })

  // Personalization (cart/browse-aware) only fires when there's something to
  // personalize on — otherwise the static aside is already the right answer
  // and we save a KV round-trip + potential Claude budget.
  const cartId = getCartIdFromCookie(request)
  const previousBrowseIds = parseBrowseCookie(request)
  const otherBrowseIds = previousBrowseIds.filter(id => id !== deal.shopifyProductId).slice(0, 4)
  // Crawlers are served the static aside above and nothing more. The browse
  // history that makes a visitor look personalizable comes from a cookie this
  // very loader sets, so a cookie-retaining crawler accumulates one and starts
  // qualifying: one overnight catalog walk on 2026-07-21 spent 3,566 Haiku
  // calls across 2,709 products, and this surface became roughly a quarter of
  // all metered API spend on a site seeing ~26 human sessions a week. Skipping
  // it costs a crawler nothing, since the stable static aside is the copy that
  // should be indexed anyway.
  //
  // Three independent gates, because each one alone is defeatable. The
  // user-agent check loses to a spoofed Chrome UA — and it did: the same
  // burst pattern continued after the UA gate deployed on 2026-07-29. The
  // browse-count threshold is 2, not 1, because a single retained cookie used
  // to qualify a client on its second page, which is exactly the shape of a
  // catalog walk. The IP rate limit is the same primitive every sibling Emma
  // surface already uses (api.emma-cart, api.emma-tagline, api.emma-discovery);
  // this loader was the one paid Emma surface with no IP gate at all.
  //
  // None of these is the guarantee. checkRateLimit fails open on a KV error and
  // no-ops entirely without KV configured, so the hard stop on the bill remains
  // DAILY_BUDGET_CEIL in emma-aside.server.ts.
  const wantsPersonalization = qualifiesForPaidAside({
    looksAutomated: isCrawlerRequest(request),
    hasCart:        !!cartId,
    browseCount:    otherBrowseIds.length,
    isLoggedIn:     customerGid !== null,
  })
  // Only spend a KV round-trip on requests that would otherwise generate.
  const withinRate = wantsPersonalization
    ? (await checkRateLimit(request, 'emma-aside', 12, 3600)).ok
    : false
  const hasPersonalization = wantsPersonalization && withinRate

  const emmaAsidePromise: Promise<EmmaAsideResult> | null = hasPersonalization
    ? (async (): Promise<EmmaAsideResult> => {
        try {
          const cartLines = cartId
            ? (await getCart(cartId).catch(() => null))?.lines?.map(l => ({
                title:    l.merchandise.title,
                quantity: l.quantity,
              })) ?? []
            : []
          const browseProducts = otherBrowseIds.length > 0
            ? (await getProductsByIds(otherBrowseIds)).map(p => ({ title: p.title }))
            : []
          return await getEmmaAside({
            product: {
              id:               deal.id,
              shopifyProductId: deal.shopifyProductId,
              seoTitle:         deal.seoTitle,
              brand:            deal.brand,
              tagline:          deal.tagline,
              ...(deal.productTypeDial ? { productTypeDial: deal.productTypeDial } : {}),
            },
            cartLines,
            browseProducts,
            pairsWithProducts: pairsWithItems.map(p => ({ title: p.title })),
            userGid:           customerGid,
          })
        } catch {
          return { text: emmaAsideStatic, source: 'fallback' }
        }
      })()
    : null

  // Map the carousel/rail product results (resolved in Batch B) back onto their
  // block keys. Both feed the same carouselProductMap the components read.
  const carouselProductMap: Record<string, Product[]> = {}
  carouselBlocks.forEach((b, i) => { carouselProductMap[b._key] = carouselResults[i] ?? [] })
  emmaRailBlocks.forEach((b, i) => { carouselProductMap[b._key] = railResults[i] ?? [] })

  const browseCookieHeader = buildBrowseCookie(deal.shopifyProductId, previousBrowseIds)

  // Generate dedup id shared with the browser pixel. ViewContent failure is non-fatal.
  // Crawlers, scrapers and hover-prefetches all run this loader, and each one
  // used to mint a conversion event. A null id suppresses BOTH sides: no CAPI
  // send here, and the client effect skips the browser pixel, so the dedup
  // contract holds either way.
  const viewContentEventId = isCapiEligible(request)
    ? fireCapiEvent(request, 'ViewContent', {
        contentIds: [deal.shopifyProductId],
        value:      deal.dealPrice,
      })
    : null

  return data(
    {
      type: 'product' as const,
      deal,
      swatches,
      pdpBlocks,
      carouselProductMap,
      fbtProducts,
      pairsWithItems,
      productVoteAggregate,
      customerProductVote,
      isLoggedIn,
      companionBundle,
      faqs,
      bundle: null,
      emmaAsideStatic,
      emmaAsidePromise,
      breadcrumbs,
      pdpTrustBar,
      viewContentEventId,
      reviewData,
      reviewPage,
      reviewSort,
      reviewFilter,
      notebookPosts,
    },
    { headers: { 'Set-Cookie': browseCookieHeader } },
  )
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

function preloadHeroImageTag(imageUrl: string | undefined | null) {
  if (!imageUrl) return null
  // Responsive preload — the gallery renders the first image at ~100vw on
  // mobile and ~50vw on desktop, so let the browser pick the right size from
  // a small srcset. `imagesrcset`/`imagesizes` are the lowercase HTML attrs
  // that the preload scanner reads during initial parse, before React boots.
  const sep = imageUrl.includes('?') ? '&' : '?'
  // AVIF-typed to match the gallery's <picture> AVIF source (same widths +
  // imagesizes → exact cache hit). Non-AVIF browsers skip it and use the
  // picture's webp/jpg source, so there's never a wasted preload.
  return {
    tagName: 'link',
    rel: 'preload',
    as: 'image',
    type: 'image/avif',
    href: `${imageUrl}${sep}width=1024&format=avif`,
    imagesrcset: [
      `${imageUrl}${sep}width=480&format=avif 480w`,
      `${imageUrl}${sep}width=768&format=avif 768w`,
      `${imageUrl}${sep}width=1024&format=avif 1024w`,
      `${imageUrl}${sep}width=1600&format=avif 1600w`,
    ].join(', '),
    imagesizes: '(max-width: 768px) 100vw, 50vw',
    fetchpriority: 'high',
  } as const
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: 'Product not found | xdipx' }]
  if (data.type === 'bundle' && data.bundle) {
    const { bundle } = data
    const title = `${bundle.title} — Bundle Deal | xdipx`
    const description = bundle.tagline || `${bundle.title} — save ${bundle.discountPct}% when you buy the bundle.`
    const url = `https://xdipx.com/products/${bundle.handle}`
    const heroPreload = preloadHeroImageTag(bundle.images[0]?.url)
    return [
      { title },
      { name: 'description', content: description },
      { tagName: 'link', rel: 'canonical', href: url },
      { tagName: 'link', rel: 'alternate', type: 'text/markdown', href: `${url}.md` },
      ...(heroPreload ? [heroPreload] : []),
      ...buildSocialMeta({
        title,
        description,
        url,
        image: bundle.images[0]?.url ?? null,
        type: 'product',
        imageAlt: bundle.title,
      }),
    ]
  }
  if (!data.deal) return [{ title: 'Product not found | xdipx' }]
  const { deal } = data
  const title = `${deal.seoTitle} | xdipx`
  const description = deal.metaDescription || `${deal.seoTitle} — ships discreet from xdipx.`
  const url = `https://xdipx.com/products/${deal.handle}`
  const heroPreload = preloadHeroImageTag(deal.images[0]?.url)
  return [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: url },
    { tagName: 'link', rel: 'alternate', type: 'text/markdown', href: `${url}.md` },
    ...(heroPreload ? [heroPreload] : []),
    ...buildSocialMeta({
      title,
      description,
      url,
      image: deal.images[0]?.url ?? null,
      type: 'product',
      imageAlt: deal.seoTitle,
    }),
  ]
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProductPageRoute() {
  const data = useLoaderData<typeof loader>()
  const { buyButtonText } = useOutletContext<{ buyButtonText: string }>()
  if (data.type === 'bundle' && data.bundle) {
    return (
      <>
        {data.bundle.moodImageUrl ? (
          <div className="relative overflow-hidden">
            <img
              src={data.bundle.moodImageUrl}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-cream/97 via-cream/90 to-cream/60" />
            <BundleHero bundle={data.bundle} buyButtonText={buyButtonText} />
          </div>
        ) : (
          <BundleHero bundle={data.bundle} buyButtonText={buyButtonText} />
        )}
      </>
    )
  }
  return <ProductPage />
}

function ProductPage() {
  const loaderData = useLoaderData<typeof loader>()
  const { buyButtonText } = useOutletContext<{ buyButtonText: string }>()
  // Bundle branch handled in ProductPageRoute — when we're here, deal is guaranteed.
  const deal = loaderData.deal!
  const pdpBlocks = loaderData.pdpBlocks
  const carouselProductMap = loaderData.carouselProductMap
  const fbtProducts = loaderData.fbtProducts
  const pairsWithItems = loaderData.pairsWithItems
  const notebookPosts = loaderData.notebookPosts

  // Internal linking: render BOTH cross-link rails when both have data. This
  // used to be either/or, which left most PDPs carrying only 3-4 internal
  // product links and starved the catalog of crawl paths. Pairs-with is Emma's
  // curated pairing so it keeps priority and wins the dedupe; "frequently
  // bought with" fills the remainder up to a combined cap so the page does not
  // sprawl. Both data sets are already in the loader payload, so this is a pure
  // derivation, no extra fetching.
  const pairedHandles = new Set(pairsWithItems.map(p => p.handle))
  const fbtCrossLinks = fbtProducts
    .filter(p => !pairedHandles.has(p.handle))
    .slice(0, Math.max(0, PDP_CROSSLINK_CAP - pairsWithItems.length))
  // When an editor has curated a relatedGuides block (with published picks),
  // that block renders the rail at its chosen position — suppress the automatic
  // fallback rail below to avoid two Notebook rails on one page.
  const hasCuratedGuides = pdpBlocks.some(
    b => b._type === 'relatedGuides' && b.guides.length > 0,
  )
  const productVoteAggregateLoaded = loaderData.productVoteAggregate
  const customerProductVoteLoaded  = loaderData.customerProductVote
  const isLoggedIn                 = loaderData.isLoggedIn
  const companionBundle = loaderData.companionBundle
  const swatches  = loaderData.swatches ?? {}
  const faqs        = loaderData.faqs ?? []
  const careFaqs    = faqs.filter(f => f.category === 'care')
  const nonCareFaqs = faqs.filter(f => f.category !== 'care')
  // Care card priority (mirrors ProductSummaryGrid): legacy careInstructions
  // bullets win when present, care productFaqs are the accordion fallback.
  // We only need to strip care from the main FAQ card when the accordion
  // path is active — otherwise the full FAQ list is visible there with no
  // duplicate-content risk.
  const careAccordionInCareCard = !(deal.careInstructions?.length) && careFaqs.length > 0
  const visibleFaqs = careAccordionInCareCard ? nonCareFaqs : faqs
  const emmaAsidePromise = loaderData.emmaAsidePromise
  const emmaAsideStatic  = loaderData.emmaAsideStatic ?? ''
  const pdpTrustBar      = loaderData.pdpTrustBar
  const layoutData = useRouteLoaderData<typeof layoutLoader>('routes/_layout')
  const emmaPersona = layoutData?.emmaPersona ?? null
  const fetcher = useFetcher()
  const isPending = fetcher.state !== 'idle'
  const voteFetcher = useFetcher<{
    ok: boolean
    aggregate?: ProductVoteAggregate
    loginUrl?: string
    error?: string
  }>()
  const [productVoteAggregate, setProductVoteAggregate] = useState<ProductVoteAggregate>(productVoteAggregateLoaded)
  const [customerVote, setCustomerVote] = useState<1 | -1 | null>(customerProductVoteLoaded)
  const [voteToast, setVoteToast] = useState<{ vote: 1 | -1; key: number } | null>(null)

  useEffect(() => {
    if (voteFetcher.state !== 'idle' || !voteFetcher.data) return
    if (voteFetcher.data.ok && voteFetcher.data.aggregate) {
      setProductVoteAggregate(voteFetcher.data.aggregate)
      setVoteToast({ vote: customerVote ?? 1, key: Date.now() })
      return
    }
    // Guest tried to vote — bounce through login with pendingVote so we can
    // replay after sign-in.
    if (!voteFetcher.data.ok && voteFetcher.data.loginUrl) {
      window.location.assign(voteFetcher.data.loginUrl)
    }
  }, [voteFetcher.state, voteFetcher.data, customerVote])

  const submitProductVote = useCallback((vote: 1 | -1) => {
    const fd = new FormData()
    fd.set('intent',           'product-vote')
    fd.set('shopifyProductId', deal.shopifyProductId)
    fd.set('handle',           deal.handle)
    fd.set('vote',             String(vote))
    voteFetcher.submit(fd, { method: 'post', action: '/api/pdp-vote' })
  }, [deal.shopifyProductId, deal.handle, voteFetcher])

  const handleAggregateVote = useCallback((vote: 1 | -1) => {
    setCustomerVote(vote) // optimistic sticky state; reverts if 401 redirects away
    submitProductVote(vote)
  }, [submitProductVote])

  const [searchParams, setSearchParams] = useSearchParams()

  // Replay a pending vote after guest sign-in: ?pendingVote=1|-1 is set by
  // api.pdp-vote's 401 loginUrl and preserved through the login redirect.
  const replayedRef = useRef(false)
  useEffect(() => {
    if (replayedRef.current || !isLoggedIn) return
    const pending = searchParams.get('pendingVote')
    if (pending !== '1' && pending !== '-1') return
    const vote = pending === '1' ? 1 : -1
    replayedRef.current = true
    setCustomerVote(vote)
    submitProductVote(vote)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('pendingVote')
      return next
    }, { replace: true })
  }, [isLoggedIn, searchParams, setSearchParams, submitProductVote])

  const variants     = deal.variants ?? []
  const options      = deal.options  ?? []
  const multiVariant = variants.length > 1

  // Seed the option selection only when the URL pins a specific variant
  // (share-links, post-add-to-cart returns). Otherwise leave color and size
  // unselected on landing so the shopper makes a deliberate choice — the
  // CTA reads "Pick a size and color" until they do.
  const urlVariantId = searchParams.get('variant')
  const urlVariant = urlVariantId ? variants.find(v => v.id === urlVariantId) : undefined
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {}
    if (urlVariant) {
      for (const opt of urlVariant.selectedOptions) seed[opt.name] = opt.value
      return seed
    }
    // Auto-preselect ONLY when the shopper has no real choice to make: a single
    // option axis on which exactly one value is actually buyable. Then seeding
    // it is not a guess, and the CTA is live on landing instead of a dead
    // control. Never when several values are available (picking the first would
    // ship a size nobody chose), and never on multi-axis products, where a
    // default risks adding the wrong combination to the cart.
    if (options.length === 1) {
      const axis = options[0]!.name
      const buyable = variants.filter(v => v.availableForSale)
      const values = new Set(
        buyable.map(v => v.selectedOptions.find(o => o.name === axis)?.value).filter(Boolean),
      )
      if (values.size === 1) {
        const [val] = [...values]
        if (val) seed[axis] = val
      }
    }
    return seed
  })
  const [quantity,   setQuantity]   = useState(1)
  const [activeImg,     setActiveImg]     = useState(0)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [showSticky,    setShowSticky]    = useState(false)
  // Guided-selection feedback for the buy CTA. `openReqNonce` bumps to ask the
  // target selector to open + scroll into view; `selectAlert` is the announced,
  // visible message shown under the buy row after a premature tap.
  const [openReqNonce, setOpenReqNonce] = useState(0)
  const [selectAlert, setSelectAlert] = useState<string | null>(null)
  const ctaRef = useRef<HTMLButtonElement>(null)

  // Build unified gallery: hero video (9:16) → first image → videos → remaining images
  const allMedia = useMemo<GalleryItem[]>(() => {
    const heroVideoItem: GalleryItem | null = deal.heroVideo
      ? {
          kind:       'video',
          previewUrl: deal.heroVideo.poster ?? deal.images[0]?.url ?? '',
          sources:    [{ url: deal.heroVideo.src, mimeType: 'video/mp4' }],
          aspect:     'portrait',
          duration:   deal.heroVideo.duration,
        }
      : null
    const videos = (deal.videos ?? []).map<GalleryItem>(v => ({
      kind:       'video',
      previewUrl: v.previewImageUrl,
      sources:    v.sources,
      ...(v.aspect ? { aspect: v.aspect } : {}),
    }))
    const images = deal.images.map<GalleryItem>(img => ({ kind: 'image', url: img.url, altText: img.altText || deal.seoTitle }))
    const [first, ...rest] = images
    const base = first ? [first, ...videos, ...rest] : [...videos]
    return heroVideoItem ? [heroVideoItem, ...base] : base
  }, [deal.videos, deal.images, deal.heroVideo])

  const optionNames = useMemo(() => options.map(o => o.name), [options])

  const handleSelectionChange = useCallback((next: Record<string, string>) => {
    setSelectedOptions(next)
    // Any deliberate choice clears a prior "choose a …" prompt so the standing
    // hint (recomputed for whatever axis is still missing) takes over.
    setSelectAlert(null)

    // For gallery preview, try exact match first; fall back to any variant that
    // matches the color axis (so picking Sage swaps the image even if size is
    // still unset).
    const exact = resolveVariant(variants, next, optionNames)
    let preview = exact
    if (!preview) {
      const colorName = optionNames.find(n => n.toLowerCase() === 'color' || n.toLowerCase() === 'colour')
      const colorVal = colorName ? next[colorName] : undefined
      if (colorName && colorVal) {
        preview = variants.find(v =>
          v.availableForSale &&
          v.selectedOptions.some(o => o.name === colorName && o.value === colorVal),
        ) ?? variants.find(v =>
          v.selectedOptions.some(o => o.name === colorName && o.value === colorVal),
        )
      }
    }
    if (preview?.image) {
      const idx = allMedia.findIndex(m => m.kind === 'image' && m.url === preview!.image!.url)
      if (idx >= 0) setActiveImg(idx)
    }

    // Stamp ?variant= when we've resolved a concrete variant; clear it when the
    // user has deselected an axis and no longer points at a single variant.
    setSearchParams(prev => {
      const nextParams = new URLSearchParams(prev)
      if (exact) nextParams.set('variant', exact.id)
      else nextParams.delete('variant')
      return nextParams
    }, { replace: true, preventScrollReset: true })
  }, [variants, optionNames, allMedia, setSearchParams])

  const selectedVariant = resolveVariant(variants, selectedOptions, optionNames) ?? (multiVariant ? undefined : variants[0])
  const basePrice = selectedVariant ? parseFloat(selectedVariant.price) : deal.dealPrice
  const activePlan = selectedPlanId
    ? deal.sellingPlanGroups?.flatMap(g => g.sellingPlans).find(p => p.id === selectedPlanId)
    : undefined
  const price    = activePlan ? getSubscriptionPrice(basePrice, activePlan) : basePrice
  const isDigital = deal.handle === 'egift-card'
  const needsSelection = multiVariant && !selectedVariant
  // Build "Pick a size and color" / "Pick a color" / "Pick a size" depending
  // on which axes still need a choice. Size always reads first.
  const pickLabel: string = (() => {
    const order = (n: string) => (n === 'size' ? 0 : (n === 'color' || n === 'colour') ? 1 : 2)
    const missing = options
      .filter(o => !selectedOptions[o.name])
      .map(o => o.name.toLowerCase())
      .sort((a, b) => order(a) - order(b))
    if (missing.length === 0) return 'Pick an option'
    return `Pick a ${missing.join(' and ')}`
  })()
  // First still-unselected circle axis (size before colour), used to target the
  // guided-open when a shopper taps the CTA before choosing.
  const firstMissingAxis: string | undefined = (() => {
    const rank = (n: string) =>
      /^(size|volume|capacity|length|fl\.?\s*oz)$/i.test(n) ? 0
      : /^colou?r$/i.test(n) ? 1 : 2
    return [...options]
      .filter(o => {
        const isCircle = /^colou?r$/i.test(o.name) || /^(size|volume|capacity|length|fl\.?\s*oz)$/i.test(o.name)
        return isCircle && !selectedOptions[o.name]
      })
      .sort((a, b) => rank(a.name) - rank(b.name))[0]?.name
  })()
  const inStock  = isDigital ? true : (selectedVariant?.availableForSale ?? (multiVariant ? false : deal.qty > 0))
  // Stock count for the StockIndicator trust signal. Prefer the selected
  // variant's real count over the stale deal-level qty on multi-variant
  // products; fall back to deal.qty only when no variant is resolved yet.
  const selectedQty = selectedVariant?.quantityAvailable ?? deal.qty
  // Drive the indicator off the SAME purchasability signal as the waitlist
  // path below, so the label can never contradict the CTA: an out-of-stock
  // variant reads "Sold out" (and the waitlist button wins below), and an
  // in-stock variant never reads "Sold out". A still-sellable variant with a
  // 0/untracked count reads "In stock", never a fabricated "Almost gone"
  // (the voice charter bans scarcity theater; a real thin count is a fair
  // trust signal). Values above 10 render as "In stock".
  const stockIndicatorQty = inStock ? (selectedQty > 0 ? selectedQty : 11) : 0
  const discount = deal.msrp > 0 && deal.msrp > price
    ? Math.round(((deal.msrp - price) / deal.msrp) * 100)
    : 0
  const subscriptionOffer = !selectedPlanId
    ? getBestSubscriptionOffer(deal.sellingPlanGroups, basePrice)
    : null

  // Phase 1 rebuild — `worksFor` and `WorksForBadge` were used by the legacy
  // "Works For" badges attached to the deprecated `worksForHim`/`worksForHer`
  // PDP tabs (see line 39 comment, ProductTabs removed). Both deleted with
  // the B3 drop in Phase 1.

  // Sticky mobile CTA — appears when main button scrolls out of view
  useEffect(() => {
    const el = ctaRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setShowSticky(!entry!.isIntersecting),
      { threshold: 0 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // ── GA4: view_item ────────────────────────────────────────────────────
  useEffect(() => {
    trackViewItem({
      item_id: deal.shopifyProductId,
      item_name: deal.seoTitle,
      item_brand: deal.brand,
      item_category: categoryToLegacyString(deal.category),
      price,
    }, price)
  }, [deal.handle])

  // ── Meta Pixel: ViewContent (fire-once side-effect, not data fetching) ───
  // viewContentEventId was generated server-side so the browser pixel and
  // server CAPI share the same id for Meta-side deduplication.
  const viewContentEventId = loaderData.type === 'product' ? loaderData.viewContentEventId : null
  useEffect(() => {
    if (!viewContentEventId) return
    trackFbViewContent(
      { content_ids: [deal.shopifyProductId], value: price, currency: 'USD' },
      viewContentEventId,
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.handle])

  // ── GA4: add_to_cart on fetcher success ────────────────────────────────
  const wasSubmittingPDP = useRef(false)
  useEffect(() => {
    if (fetcher.state === 'submitting') {
      wasSubmittingPDP.current = true
    } else if (fetcher.state === 'idle' && wasSubmittingPDP.current) {
      wasSubmittingPDP.current = false
      const data = fetcher.data as { ok?: boolean; addToCartEventId?: string } | undefined
      if (data?.ok) {
        // Opens CartDrawer (listener in Navbar.tsx) with the EmmaRecommends
        // upsell rail — same event PairsWith/VaultCard/etc dispatch on add.
        window.dispatchEvent(new CustomEvent('xdipx:cart-added'))
        trackAddToCart({
          item_id: deal.shopifyProductId,
          item_name: deal.seoTitle,
          item_brand: deal.brand,
          item_category: categoryToLegacyString(deal.category),
          price,
          quantity,
          ...(selectedVariant?.title ? { item_variant: selectedVariant.title } : {}),
        })
        // ── Meta Pixel: AddToCart (fire-once side-effect, not data fetching) ─
        // addToCartEventId comes from the api.cart action so browser + CAPI
        // share the same id for deduplication.
        if (data.addToCartEventId) {
          trackFbAddToCart(
            { content_ids: [deal.shopifyProductId], value: price, currency: 'USD' },
            data.addToCartEventId,
          )
        }
      }
    }
  }, [fetcher.state, fetcher.data])

  const heroContent = (
    <section className="max-w-6xl mx-auto px-4 pt-4 pb-8 relative">
      <BreadcrumbNav
        items={loaderData.breadcrumbs.map(c => ({
          label: c.label,
          ...(c.href ? { href: c.href } : {}),
        }))}
      />
      <div className="grid md:grid-cols-2 gap-8 lg:gap-12 items-start mt-4">

        {/* ── Left: Media gallery + Emma aside ─────────────────────────── */}
        <div className="space-y-4">
          <ProductImageGallery
            items={allMedia}
            alt={deal.seoTitle}
            activeIndex={activeImg}
            onSelectIndex={setActiveImg}
            shareOverlay={
              <ShareButtons
                url={`https://xdipx.com/products/${deal.handle}`}
                title={deal.seoTitle}
                image={deal.images[0]?.url ?? null}
                variant="overlay"
              />
            }
            heartOverlay={
              <HeartButton
                shopifyProductId={deal.shopifyProductId}
                handle={deal.handle}
                productTitle={deal.seoTitle}
                price={deal.dealPrice}
                variant="overlay"
                size="md"
              />
            }
          />
        </div>

        {/* ── Right: Product info ─────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Brand + title */}
          <div>
            <div className="text-ink/50 text-sm font-medium uppercase tracking-widest flex items-center gap-1.5 flex-wrap">
              <span>{deal.brand}</span>
              {deal.productTypeDial && (
                <>
                  <span aria-hidden="true">•</span>
                  <span>{deal.productTypeDial}</span>
                </>
              )}
            </div>
            <h1
              className="text-2xl md:text-3xl font-bold text-ink mt-1 leading-snug"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {deal.seoTitle}
            </h1>
            {deal.emmaHero?.headline ? (
              <h2
                className="text-lg md:text-xl text-ink mt-2 leading-snug"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {deal.emmaHero.headline}
              </h2>
            ) : deal.tagline ? (
              <p className="text-ink/70 mt-2 italic">{deal.tagline}</p>
            ) : null}
          </div>

          {/* Price */}
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className="text-4xl font-black text-ink"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              ${price.toFixed(2)}
            </span>
            {deal.msrp > price && (
              <>
                <span className="text-ink/40 text-xl line-through">
                  ${deal.msrp.toFixed(2)}
                </span>
                <span className="bg-coral text-white text-sm font-bold px-3 py-1 rounded-full">
                  {discount}% off
                </span>
              </>
            )}
            {!needsSelection && (
              <StockIndicator qty={stockIndicatorQty} isDigital={isDigital} />
            )}
          </div>

          {/* Subscription teaser */}
          {subscriptionOffer && (
            <p className="text-sm text-ink/70">
              or <span className="font-semibold text-ink">${subscriptionOffer.price.toFixed(2)}</span>{' '}
              with subscription ·{' '}
              <span className="text-plum font-semibold">save {subscriptionOffer.discountPct}%</span>{' '}
              <span className="text-sage" aria-hidden="true">♥</span>
            </p>
          )}

          {deal.productTypeDial && (deal.sensationDialV2?.items?.length || (deal.sensationDial && Object.keys(deal.sensationDial).length > 0)) && (
            <SensationDial
              type={deal.productTypeDial}
              {...(deal.sensationDial ? { values: deal.sensationDial } : {})}
              {...(deal.sensationDialV2 ? { valuesV2: deal.sensationDialV2 } : {})}
              aggregate={productVoteAggregate}
              customerVote={customerVote}
              onAggregateVote={handleAggregateVote}
              voting={voteFetcher.state !== 'idle'}
            />
          )}

          {/* Subscription pill */}
          {deal.sellingPlanGroups && deal.sellingPlanGroups.length > 0 && (
            <div className="flex flex-wrap items-start gap-2">
              <SubscriptionSelector
                sellingPlanGroups={deal.sellingPlanGroups}
                basePrice={basePrice}
                selectedPlanId={selectedPlanId}
                onPlanChange={setSelectedPlanId}
              />
            </div>
          )}

          {/* Qty + Add to cart (with inline color/size circles) — circles
              always render so users can still switch variants when the current
              one is out of stock and the waitlist UI is showing instead.
              max-w-md keeps this row aligned under the SensationDial above
              so the buy controls visually sit within the dial's width. */}
          <div className="flex items-end gap-2 max-w-md">
            {multiVariant && [...options].sort((a, b) => {
              const rank = (n: string) =>
                /^(size|volume|capacity|length|fl\.?\s*oz)$/i.test(n) ? 0
                : /^colou?r$/i.test(n) ? 1
                : 2
              return rank(a.name) - rank(b.name)
            }).map(opt => {
              const isColor = /^colou?r$/i.test(opt.name)
              const isSize  = /^(size|volume|capacity|length|fl\.?\s*oz)$/i.test(opt.name)
              if (!isColor && !isSize) return null
              return (
                <CircleOptionSelector
                  key={opt.name}
                  optionName={opt.name}
                  values={opt.values}
                  {...(selectedOptions[opt.name] ? { selected: selectedOptions[opt.name] } : {})}
                  {...(opt.name === firstMissingAxis ? { openRequestNonce: openReqNonce } : {})}
                  onSelect={(v) => handleSelectionChange({ ...selectedOptions, [opt.name]: v })}
                  onClear={() => {
                    const { [opt.name]: _drop, ...rest } = selectedOptions
                    void _drop
                    handleSelectionChange(rest)
                  }}
                  kind={isColor ? 'color' : 'size'}
                  swatches={swatches}
                  variants={variants}
                  selectedOptions={selectedOptions}
                />
              )
            })}

            {inStock || needsSelection ? (
              <fetcher.Form method="post" action="/api/cart" className="flex items-stretch gap-2 flex-1 min-w-0">
                <input type="hidden" name="intent"    value="add-item" />
                <input type="hidden" name="variantId" value={selectedVariant?.id ?? deal.variantId} />
                {selectedPlanId && <input type="hidden" name="sellingPlanId" value={selectedPlanId} />}

                <button
                  ref={ctaRef}
                  type="submit"
                  disabled={isPending}
                  onClick={(e) => {
                    // Live, not dead: before a choice is made the CTA no longer
                    // ships disabled (which fired no event and failed AA). It
                    // intercepts the submit, opens the first unpicked selector,
                    // and announces why, so a tap always produces feedback.
                    if (needsSelection) {
                      e.preventDefault()
                      setSelectAlert(
                        firstMissingAxis
                          ? `Choose a ${firstMissingAxis.toLowerCase()} to continue.`
                          : 'Choose an option to continue.',
                      )
                      setOpenReqNonce(n => n + 1)
                    }
                  }}
                  className="flex-1 py-4 rounded-full font-bold text-lg transition-all bg-coral text-white hover:opacity-90 hover:scale-[1.01] shadow-md shadow-coral/20 disabled:opacity-60 disabled:hover:scale-100"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {needsSelection
                    ? pickLabel
                    : isPending ? 'Adding...' : buyButtonText}
                </button>

                <div className="flex items-stretch border border-cream-2 rounded-full overflow-hidden bg-white shrink-0">
                  <button
                    type="button"
                    onClick={() => setQuantity(q => Math.max(1, q - 1))}
                    className="min-w-[44px] flex items-center justify-center text-ink/70 hover:bg-coral hover:text-white transition-colors text-lg"
                    aria-label="Decrease quantity"
                  >−</button>
                  <label htmlFor="qty" className="sr-only">Quantity</label>
                  <input id="qty" type="hidden" name="quantity" value={quantity} />
                  <span className="px-3 flex items-center text-sm font-semibold text-ink tabular-nums" aria-live="polite">{quantity}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity(q => Math.min(3, q + 1))}
                    className="min-w-[44px] flex items-center justify-center text-ink/70 hover:bg-coral hover:text-white transition-colors text-lg"
                    aria-label="Increase quantity"
                  >+</button>
                </div>
              </fetcher.Form>
            ) : (
              <div className="flex-1 min-w-0">
                <WaitlistButton productHandle={deal.handle} />
              </div>
            )}
          </div>

          {/* Selection hint, moved here from beside the price so it sits right
              under the control it refers to. `role="alert"` + the key swap make
              the message announce again when a premature CTA tap replaces the
              standing hint with the "choose a …" prompt. */}
          {needsSelection && (
            <p
              key={selectAlert ? 'alert' : 'hint'}
              role="alert"
              className={`text-[13px] ${selectAlert ? 'text-coral font-medium' : 'text-ink/70'}`}
              style={{ fontFamily: 'var(--font-body)' }}
            >
              {selectAlert ?? `${pickLabel} to see availability.`}
            </p>
          )}

          {/* Non-color/size axis fallback (rare): render legacy selector.
              Skip color/size/volume/etc — those already render as circles above. */}
          {multiVariant && options.some(o => {
            const isCircleOpt =
              /^colou?r$/i.test(o.name) ||
              /^(size|volume|capacity|length|fl\.?\s*oz)$/i.test(o.name)
            return !isCircleOpt
          }) && (
            <VariantSelector
              variants={variants}
              options={options.filter(o => {
                const isCircleOpt =
                  /^colou?r$/i.test(o.name) ||
                  /^(size|volume|capacity|length|fl\.?\s*oz)$/i.test(o.name)
                return !isCircleOpt
              })}
              selectedOptions={selectedOptions}
              onSelectionChange={handleSelectionChange}
              swatches={swatches}
            />
          )}

        </div>
      </div>

      {/* Keyword-rich summary grid — visible by default for SEO; cards anchor
          to the matching tab below for deeper detail. */}
      <ProductSummaryGrid
        productTitle={deal.seoTitle}
        {...(deal.productTypeDial ? { productType: deal.productTypeDial } : {})}
        {...(deal.brand ? { brand: deal.brand } : {})}
        descriptionHtml={deal.descriptionHtml ?? ''}
        boxContents={deal.boxContents ?? []}
        {...(deal.careInstructions?.length ? { careInstructions: deal.careInstructions } : {})}
        {...(careFaqs.length > 0 ? { careFaqs } : {})}
        {...(deal.specifications ? { specifications: deal.specifications } : {})}
        faqCount={visibleFaqs.length}
        {...(visibleFaqs.length > 0 ? { faqSlot: <ProductFaqList faqs={visibleFaqs} /> } : {})}
        emmaSlot={
          emmaAsidePromise ? (
            <Suspense
              fallback={
                <EmmaTakeBody
                  text={emmaAsideStatic}
                  {...(emmaPersona ? { persona: emmaPersona } : {})}
                />
              }
            >
              <Await
                resolve={emmaAsidePromise}
                errorElement={
                  <EmmaTakeBody
                    text={emmaAsideStatic}
                    {...(emmaPersona ? { persona: emmaPersona } : {})}
                  />
                }
              >
                {(result: EmmaAsideResult) => (
                  <EmmaTakeBody
                    text={result.text || emmaAsideStatic}
                    {...(emmaPersona ? { persona: emmaPersona } : {})}
                  />
                )}
              </Await>
            </Suspense>
          ) : (
            <EmmaTakeBody
              text={emmaAsideStatic}
              {...(emmaPersona ? { persona: emmaPersona } : {})}
            />
          )
        }
      />

      {/* Sitewide PDP trust bar — managed in Sanity at PDP Defaults. Sits
          below Emma's take, styled to match the summary-grid cards. */}
      {pdpTrustBar && pdpTrustBar.trustItems && pdpTrustBar.trustItems.length > 0 && (
        <div className="mt-3 bg-paper rounded-[var(--radius-lg)] border border-line py-3 px-4 overflow-hidden">
          <TrustBarBlock block={pdpTrustBar} frameless />
        </div>
      )}

    </section>
  )

  return (
    <>
      {/* Mood image background — matches DailyDealHero */}
      {deal.moodImageUrl ? (
        <div className="relative overflow-hidden">
          <img
            src={deal.moodImageUrl}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-cream/97 via-cream/90 to-cream/60" />
          {heroContent}
        </div>
      ) : heroContent}

      <div className="max-w-6xl mx-auto px-4">
        {/* Both rails render when both have data. Each component already
            returns null on an empty list. */}
        <PairsWith items={pairsWithItems} />
        <FrequentlyBoughtWith products={fbtCrossLinks} />
        <RecentlyBrowsed currentHandle={deal.handle} />
        {companionBundle && (
          <BundleSaveCard bundle={companionBundle} buyButtonText={buyButtonText} />
        )}
        {!hasCuratedGuides && (
          <NotebookRail posts={notebookPosts} heading="From the Notebook" />
        )}
      </div>

      {/* CMS content blocks configured in Sanity for this product */}
      {pdpBlocks.map(block => (
        <ContentBlockRenderer
          key={block._key}
          block={block}
          carouselProductMap={carouselProductMap}
        />
      ))}

      {/* Customer reviews — renders only when the reviews_pdp_enabled valve is
          on AND at least one real approved review exists (same condition that
          puts aggregateRating into the Product JSON-LD above). */}
      {loaderData.reviewData && (
        <div className="max-w-6xl mx-auto px-4">
          <ReviewList
            reviews={loaderData.reviewData.reviews}
            aggregate={loaderData.reviewData.aggregate}
            productId={deal.shopifyProductId}
            total={loaderData.reviewData.total}
            page={loaderData.reviewPage}
            sort={loaderData.reviewSort}
            filter={loaderData.reviewFilter}
          />
        </div>
      )}

      <EmailSubscribe />

      {/* Sticky mobile CTA — lifted above the MobileExploreMenu (56px tab bar
          + safe-area). When the buy CTA is visible, it sits between the page
          content and the persistent bottom menu, matching how desktop stacks
          its CTA above the footer chrome. */}
      {inStock && showSticky && (
        <div className="fixed bottom-[calc(56px+env(safe-area-inset-bottom))] left-0 right-0 z-[54] md:hidden bg-white border-t border-cream-2 px-4 py-3 flex items-center gap-3 shadow-lg shadow-ink/10">
          {deal.images[0] && (
            <img
              src={shopifyImageUrl(deal.images[0].url, 120)}
              alt=""
              aria-hidden="true"
              className="w-12 h-12 rounded-xl object-cover bg-cream-2 shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-ink/60 truncate">{deal.brand}</p>
            <p
              className="text-sm font-bold text-ink truncate"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              ${price.toFixed(2)}
              {deal.msrp > price && (
                <span className="text-ink/40 line-through ml-2 font-normal">
                  ${deal.msrp.toFixed(2)}
                </span>
              )}
            </p>
          </div>
          <fetcher.Form method="post" action="/api/cart">
            <input type="hidden" name="intent"    value="add-item" />
            <input type="hidden" name="variantId" value={selectedVariant?.id ?? deal.variantId} />
            <input type="hidden" name="quantity"  value={quantity} />
            {selectedPlanId && <input type="hidden" name="sellingPlanId" value={selectedPlanId} />}
            <button
              type="submit"
              disabled={isPending}
              className="bg-coral text-white font-bold text-sm px-5 py-2.5 rounded-full hover:opacity-90 transition-opacity shrink-0"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {isPending ? 'Adding...' : buyButtonText}
            </button>
          </fetcher.Form>
        </div>
      )}

      <ProductStructuredData deal={deal} />
      <VideoStructuredData deal={deal} />
      <BreadcrumbStructuredData
        items={loaderData.breadcrumbs
          .filter((c): c is typeof c & { url: string } => !!c.url)
          .map(c => ({ name: c.label, url: c.url }))}
      />
      {faqs.length > 0 && (
        <FAQStructuredData faqs={faqs.map(f => ({ question: f.question, answer: f.answer }))} />
      )}
      {careFaqs.length > 0 && (
        <HowToStructuredData
          name={`How to care for your ${deal.seoTitle}`}
          description={`Care instructions for the ${deal.seoTitle} by ${deal.brand}.`}
          url={`https://xdipx.com/products/${deal.handle}`}
          steps={careFaqs.map(f => ({ name: f.question, text: f.answer }))}
        />
      )}

      {voteToast && (
        <Toast
          key={voteToast.key}
          message={voteToast.vote === 1 ? 'Thanks — vote recorded ♥' : 'Got it — noted.'}
          onDismiss={() => setVoteToast(null)}
        />
      )}
    </>
  )
}

function EmmaTakeBody({
  text,
  persona,
}: {
  text:     string
  persona?: { avatarUrl: string | null; avatarAlt: string | null; displayName: string | null } | null
}) {
  return (
    <div className="flex items-start gap-3">
      {persona?.avatarUrl ? (
        <img
          src={persona.avatarUrl}
          alt={persona.avatarAlt || persona.displayName || 'Emma'}
          width={40}
          height={40}
          loading="lazy"
          className="shrink-0 w-10 h-10 rounded-full object-cover ring-1 ring-line"
        />
      ) : (
        <span
          aria-hidden="true"
          className="shrink-0 w-10 h-10 rounded-full bg-coral/10 text-coral flex items-center justify-center text-lg"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          ♥
        </span>
      )}
      <p className="text-sm text-ink/80 leading-relaxed pt-1">{text}</p>
    </div>
  )
}

