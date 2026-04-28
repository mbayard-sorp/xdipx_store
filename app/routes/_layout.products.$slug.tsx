import { Suspense, useState, useRef, useEffect, useMemo, useCallback } from 'react'
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Await, data, useLoaderData, useOutletContext, useFetcher, useSearchParams, useRouteLoaderData } from 'react-router'
import type { loader as layoutLoader } from '~/routes/_layout'
import { ProductImageGallery, type GalleryItem } from '~/components/store/ProductImageGallery'
// import { StarRating } from '~/components/reviews/StarRating'  // hidden — restore with star rating block
import {
  getDealByHandle, getProductsByTag,
  getCollectionProducts, getProductsByHandles,
  getProductsByIds, getMainMenu,
} from '~/lib/shopify.server'
import { resolveBreadcrumbs, type BreadcrumbCrumb } from '~/lib/breadcrumbs.server'
import { getProductPageBlocks, getProductFaqs, getPdpTrustBar } from '~/lib/sanity.server'
import { getBundleByHandle, getBundleCompanionFor } from '~/lib/bundles.server'
import { getProductReviews, getProductAggregate } from '~/lib/reviews.server'
import { getFrequentlyBoughtWith } from '~/lib/recommendations.server'
import {
  getProductVoteAggregate,
  getCustomerProductVote,
  type ProductVoteAggregate,
} from '~/lib/dial-votes.server'
import { getCustomerToken } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import { getCartIdFromCookie } from '~/lib/cart.server'
import { getCart } from '~/lib/shopify.server'
import { getEmmaAside, type EmmaAsideResult } from '~/lib/emma-aside.server'
import { parseBrowseCookie, buildBrowseCookie } from '~/lib/browse-history.server'
// EmmaContextualAside / Skeleton no longer used — Emma's take now lives inside
// the SEO summary grid via EmmaTakeBody (defined below).
import { getFallbackAside } from '~/lib/emma-aside-templates'
import BundleHero from '~/components/store/BundleHero'
import BundleSaveCard from '~/components/store/BundleSaveCard'
import { ProductStructuredData }  from '~/components/seo/ProductStructuredData'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { FAQStructuredData }      from '~/components/seo/FAQStructuredData'
import { VideoStructuredData }    from '~/components/seo/VideoStructuredData'
import { ProductFaqList }         from '~/components/store/ProductFaqList'
import { BreadcrumbNav } from '~/components/blog/BreadcrumbNav'
// ProductTabs removed — content now lives in the SEO summary grid above.
import RecentlyBrowsed            from '~/components/store/RecentlyBrowsed'
import FrequentlyBoughtWith       from '~/components/store/FrequentlyBoughtWith'
import { SensationDial }          from '~/components/store/SensationDial'
import { PairsWith, type PairsWithItem } from '~/components/store/PairsWith'
import { AlsoBuyMini }                from '~/components/store/AlsoBuyMini'
import { VariantSelector, resolveVariant } from '~/components/store/VariantSelector'
import { CircleOptionSelector } from '~/components/store/CircleOptionSelector'
import { ProductSummaryGrid } from '~/components/store/ProductSummaryGrid'
import { getSwatchMap } from '~/lib/swatches.server'
import { SocialProofBar }         from '~/components/store/SocialProofBar'
// import { StockIndicator } from '~/components/store/StockIndicator'  // hidden — restore with stock indicator block
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
import { ShareButtons } from '~/components/common/ShareButtons'
import { HeartButton } from '~/components/store/HeartButton'
import { Toast } from '~/components/account/Toast'
import { buildSocialMeta } from '~/lib/social-meta'

// ─── Loader ───────────────────────────────────────────────────────────────────

export function headers() {
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
  }
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const slug = params['slug']!

  // Bundle fast-path: if Sanity has a bundle doc for this handle, render the
  // BundleHero instead of the normal PDP. Shopify product still needs to exist
  // (for the handle), but we skip the heavy PDP data fetches.
  const bundle = await getBundleByHandle(slug)
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
      reviews: [],
      reviewTotal: 0,
      reviewPage: 1,
      reviewSort: 'newest',
      reviewFilter: 'all',
      aggregate: null,
      faqs: [] as ProductFaq[],
      emmaAsideStatic: '',
      emmaAsidePromise: null as Promise<EmmaAsideResult> | null,
      breadcrumbs: [
        { label: 'Home', url: 'https://xdipx.com/', href: '/' },
        { label: bundle.title, url: `https://xdipx.com/products/${bundle.handle}`, href: `/products/${bundle.handle}` },
      ] as BreadcrumbCrumb[],
      pdpTrustBar: null as TrustBarBlockType | null,
    }
  }

  const deal = await getDealByHandle(slug)
  if (!deal) throw new Response('Product not found', { status: 404 })

  // Archived products return 410 Gone — a stronger crawl signal than 404
  // that this URL was deliberately removed (vs. accidentally missing) so
  // Google drops it from the index faster.
  if (deal.dealStatus === 'archived') {
    throw new Response(null, {
      status: 410,
      statusText: 'Gone',
      headers: { 'Cache-Control': 'public, max-age=300' },
    })
  }

  const url          = new URL(request.url)
  const reviewPage   = parseInt(url.searchParams.get('reviewPage')   ?? '1', 10)
  const reviewSort   = url.searchParams.get('reviewSort')   ?? 'newest'
  const reviewFilter = url.searchParams.get('reviewFilter') ?? 'all'

  const hasDial = !!(deal.productTypeDial && (deal.sensationDialV2?.items?.length || (deal.sensationDial && Object.keys(deal.sensationDial).length > 0)))
  const hasPairing = !!(deal.pairingWhy && Object.keys(deal.pairingWhy).length > 0 && deal.accessoryProductIds.length > 0)

  // Resolve current customer (for sticky vote state + gating). Failures here
  // are non-fatal — PDP still renders for anonymous users.
  const customerToken = await getCustomerToken(request)
  let customerGid: string | null = null
  if (customerToken) {
    try {
      const profile = await customerAPI(customerToken).getProfile()
      customerGid = profile?.id ?? null
    } catch { /* treat as anonymous */ }
  }
  const isLoggedIn = !!customerGid

  const colorLabels = (deal.options ?? [])
    .filter(o => o.name.toLowerCase() === 'color' || o.name.toLowerCase() === 'colour')
    .flatMap(o => o.values)

  // HIDDEN — Reviews UI: paused until we have orders. Restore the two
  // commented-out fetches and the JSX block at line ~707 when bringing the
  // user-review system back online.
  const [pdpBlocks, reviewData, aggregate, fbtHandles, companionBundle, productVoteAggregate, customerProductVote, pairProducts, swatches, faqs, mainMenu, pdpTrustBar] = await Promise.all([
    getProductPageBlocks(slug),
    // getProductReviews(deal.shopifyProductId, { sort: reviewSort, filter: reviewFilter, page: reviewPage, perPage: 10 }),
    // getProductAggregate(deal.shopifyProductId),
    Promise.resolve({ reviews: [], total: 0 } as Awaited<ReturnType<typeof getProductReviews>>),
    Promise.resolve(null as Awaited<ReturnType<typeof getProductAggregate>>),
    getFrequentlyBoughtWith(slug, 4),
    getBundleCompanionFor(slug),
    hasDial
      ? getProductVoteAggregate(deal.shopifyProductId)
      : Promise.resolve({ agrees: 0, disagrees: 0, agreePct: 0 } as ProductVoteAggregate),
    hasDial && customerGid
      ? getCustomerProductVote(deal.shopifyProductId, customerGid)
      : Promise.resolve(null as (1 | -1 | null)),
    hasPairing ? getProductsByIds(deal.accessoryProductIds) : Promise.resolve([]),
    colorLabels.length > 0 ? getSwatchMap(colorLabels) : Promise.resolve({} as Record<string, string>),
    getProductFaqs(slug),
    getMainMenu(),
    getPdpTrustBar(),
  ])

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
  const fbtProducts = fbtHandles.length > 0
    ? (await getProductsByHandles(fbtHandles))
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
    : []

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
  const hasPersonalization = !!cartId || otherBrowseIds.length > 0 || customerGid !== null

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

  // Resolve Shopify products for any productCarousel blocks
  const carouselBlocks = pdpBlocks.filter(
    (b): b is ProductCarouselBlock => b._type === 'productCarousel',
  )
  const carouselProductMap: Record<string, Product[]> = {}
  if (carouselBlocks.length > 0) {
    const results = await Promise.all(
      carouselBlocks.map(b => {
        const limit = b.productLimit ?? 8
        const source = b.source ?? 'tag'
        if (source === 'collection' && b.collectionHandle) {
          return getCollectionProducts(b.collectionHandle, limit)
        }
        if (source === 'manual' && b.productHandles?.length) {
          return getProductsByHandles(b.productHandles.map(p => p.handle))
        }
        return b.shopifyTag ? getProductsByTag(b.shopifyTag, limit) : Promise.resolve([])
      }),
    )
    carouselBlocks.forEach((b, i) => { carouselProductMap[b._key] = results[i] ?? [] })
  }

  // Resolve Shopify products for any emmaCuratedRail blocks (manual handles only)
  const emmaRailBlocks = pdpBlocks.filter(
    (b): b is import('~/types/cms').EmmaCuratedRailBlock => b._type === 'emmaCuratedRail',
  )
  if (emmaRailBlocks.length > 0) {
    const results = await Promise.all(
      emmaRailBlocks.map(b =>
        b.productHandles?.length
          ? getProductsByHandles(b.productHandles.map(p => p.handle))
          : Promise.resolve([] as Product[]),
      ),
    )
    emmaRailBlocks.forEach((b, i) => { carouselProductMap[b._key] = results[i] ?? [] })
  }

  const browseCookieHeader = buildBrowseCookie(deal.shopifyProductId, previousBrowseIds)

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
      reviews:       reviewData.reviews,
      reviewTotal:   reviewData.total,
      reviewPage,
      reviewSort,
      reviewFilter,
      aggregate:     aggregate ?? null,
      faqs,
      bundle: null,
      emmaAsideStatic,
      emmaAsidePromise,
      breadcrumbs,
      pdpTrustBar,
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
  return {
    tagName: 'link',
    rel: 'preload',
    as: 'image',
    href: `${imageUrl}${sep}width=1024`,
    imagesrcset: [
      `${imageUrl}${sep}width=480 480w`,
      `${imageUrl}${sep}width=768 768w`,
      `${imageUrl}${sep}width=1024 1024w`,
      `${imageUrl}${sep}width=1600 1600w`,
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
  const productVoteAggregateLoaded = loaderData.productVoteAggregate
  const customerProductVoteLoaded  = loaderData.customerProductVote
  const isLoggedIn                 = loaderData.isLoggedIn
  const companionBundle = loaderData.companionBundle
  // Review fields kept on loader for SEO JSON-LD / future restore of Reviews UI.
  void loaderData.reviews
  void loaderData.reviewTotal
  void loaderData.reviewPage
  void loaderData.reviewSort
  void loaderData.reviewFilter
  void loaderData.aggregate
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
  // Variant ids of "Customers also buy" thumbs the shopper has ticked. The
  // Add-to-cart form below reads this set and switches its payload to
  // intent=addMany when non-empty so the main + extras land in cart in one
  // round trip via /api/cart's existing handler.
  const [extraVariantIds, setExtraVariantIds] = useState<Set<string>>(new Set())
  const toggleExtra = useCallback((variantId: string) => {
    setExtraVariantIds(prev => {
      const next = new Set(prev)
      if (next.has(variantId)) next.delete(variantId)
      else next.add(variantId)
      return next
    })
  }, [])

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

  // Resolve initial variant from URL ?variant= param or first available
  const urlVariantId = searchParams.get('variant')
  const urlVariant = urlVariantId ? variants.find(v => v.id === urlVariantId) : undefined
  const initialVariant = urlVariant
    ?? variants.find(v => v.availableForSale) ?? variants[0]
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {}
    for (const opt of initialVariant?.selectedOptions ?? []) seed[opt.name] = opt.value
    return seed
  })
  const [quantity,   setQuantity]   = useState(1)
  const [activeImg,     setActiveImg]     = useState(0)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [showSticky,    setShowSticky]    = useState(false)
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
  const inStock  = isDigital ? true : (selectedVariant?.availableForSale ?? (multiVariant ? false : deal.qty > 0))
  void (selectedVariant?.quantityAvailable ?? deal.qty)  // qty kept for hidden StockIndicator restore
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

  // ── GA4: add_to_cart on fetcher success ────────────────────────────────
  const wasSubmittingPDP = useRef(false)
  useEffect(() => {
    if (fetcher.state === 'submitting') {
      wasSubmittingPDP.current = true
    } else if (fetcher.state === 'idle' && wasSubmittingPDP.current) {
      wasSubmittingPDP.current = false
      const data = fetcher.data as { ok?: boolean } | undefined
      if (data?.ok) {
        trackAddToCart({
          item_id: deal.shopifyProductId,
          item_name: deal.seoTitle,
          item_brand: deal.brand,
          item_category: categoryToLegacyString(deal.category),
          price,
          quantity,
          ...(selectedVariant?.title ? { item_variant: selectedVariant.title } : {}),
        })
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
              {/* Star rating hidden — uncomment to restore.
              {aggregate && aggregate.approvedCount > 0 && (
                <>
                  <span aria-hidden="true">•</span>
                  <span className="inline-flex items-center gap-1 normal-case tracking-normal">
                    <StarRating value={Math.round(aggregate.averageRating)} size="sm" readonly />
                    <span className="text-ink/60">({aggregate.approvedCount})</span>
                  </span>
                </>
              )}
              */}
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
              className="text-4xl font-black text-coral"
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
            {needsSelection && (
              <span className="text-[13px] text-muted italic">Pick a size to see availability</span>
            )}
            {/* Stock indicator hidden — uncomment to restore.
            {!needsSelection && <StockIndicator qty={qty} isDigital={isDigital} />}
            */}
          </div>

          {/* Subscription teaser */}
          {subscriptionOffer && (
            <p className="text-sm text-ink/70">
              or <span className="font-semibold text-ink">${subscriptionOffer.price.toFixed(2)}</span>{' '}
              with subscription ·{' '}
              <span className="text-coral font-semibold">save {subscriptionOffer.discountPct}%</span>{' '}
              <span className="text-sage" aria-hidden="true">♥</span>
            </p>
          )}

          {/* Sensation dial (left) + Customers also buy (right).
              Side-by-side at lg+ so the dial bars run shorter and the
              impulse cross-sell sits at eye level next to it. Stacks
              vertically below lg where the buy column is too narrow to
              split. Either side may render alone if its data is empty. */}
          {(() => {
            const hasDial = !!deal.productTypeDial && !!(deal.sensationDialV2?.items?.length || (deal.sensationDial && Object.keys(deal.sensationDial).length > 0))
            const alsoBuyItems = (loaderData.fbtProducts ?? []).slice(0, 2)
            const hasAlsoBuy = alsoBuyItems.length > 0
            if (!hasDial && !hasAlsoBuy) return null
            const dialNode = hasDial && deal.productTypeDial ? (
              <SensationDial
                type={deal.productTypeDial}
                {...(deal.sensationDial ? { values: deal.sensationDial } : {})}
                {...(deal.sensationDialV2 ? { valuesV2: deal.sensationDialV2 } : {})}
                aggregate={productVoteAggregate}
                customerVote={customerVote}
                onAggregateVote={handleAggregateVote}
                voting={voteFetcher.state !== 'idle'}
              />
            ) : null
            const alsoBuyNode = hasAlsoBuy ? (
              <AlsoBuyMini
                items={alsoBuyItems}
                checked={extraVariantIds}
                onToggle={toggleExtra}
              />
            ) : null
            if (hasDial && hasAlsoBuy) {
              return (
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-start">
                  {dialNode}
                  {alsoBuyNode}
                </div>
              )
            }
            return dialNode ?? alsoBuyNode
          })()}

          {/* Social proof */}
          <SocialProofBar />

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
              one is out of stock and the waitlist UI is showing instead. */}
          <div className="flex items-stretch gap-2">
            {multiVariant && options.map(opt => {
              const lower = opt.name.toLowerCase()
              const isColor = lower === 'color' || lower === 'colour'
              const isSize  = lower === 'size'
              if (!isColor && !isSize) return null
              return (
                <CircleOptionSelector
                  key={opt.name}
                  optionName={opt.name}
                  values={opt.values}
                  {...(selectedOptions[opt.name] ? { selected: selectedOptions[opt.name] } : {})}
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
                {extraVariantIds.size === 0 ? (
                  // Default single-add path — unchanged from pre-AlsoBuyMini.
                  <>
                    <input type="hidden" name="intent"    value="add-item" />
                    <input type="hidden" name="variantId" value={selectedVariant?.id ?? deal.variantId} />
                    {selectedPlanId && <input type="hidden" name="sellingPlanId" value={selectedPlanId} />}
                  </>
                ) : (
                  // Cross-sell extras checked → switch to /api/cart's
                  // addMany handler so main + extras land in cart in one
                  // round trip. Per-line subscription (sellingPlanId) is
                  // not honored by addMany today; if a plan is selected it
                  // is dropped here and the main goes in at one-time price.
                  <>
                    <input type="hidden" name="intent"      value="addMany" />
                    <input type="hidden" name="variantId_0" value={selectedVariant?.id ?? deal.variantId} />
                    <input type="hidden" name="quantity_0"  value={quantity} />
                    {Array.from(extraVariantIds).flatMap((vid, i) => [
                      <input key={`v-${vid}`} type="hidden" name={`variantId_${i + 1}`} value={vid} />,
                      <input key={`q-${vid}`} type="hidden" name={`quantity_${i + 1}`}  value="1" />,
                    ])}
                  </>
                )}

                <button
                  ref={ctaRef}
                  type="submit"
                  disabled={isPending || needsSelection}
                  className={[
                    'flex-1 py-4 rounded-full font-bold text-lg transition-all',
                    needsSelection
                      ? 'bg-ink/10 text-ink/50 cursor-not-allowed'
                      : 'bg-coral text-white hover:opacity-90 hover:scale-[1.01] shadow-md shadow-coral/20',
                  ].join(' ')}
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

          {/* Non-color/size axis fallback (rare): render legacy selector */}
          {multiVariant && options.some(o => {
            const l = o.name.toLowerCase()
            return l !== 'color' && l !== 'colour' && l !== 'size'
          }) && (
            <VariantSelector
              variants={variants}
              options={options.filter(o => {
                const l = o.name.toLowerCase()
                return l !== 'color' && l !== 'colour' && l !== 'size'
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
        {pairsWithItems.length > 0
          ? <PairsWith items={pairsWithItems} />
          : <FrequentlyBoughtWith products={fbtProducts} />
        }
        <RecentlyBrowsed currentHandle={deal.handle} />
        {companionBundle && (
          <BundleSaveCard bundle={companionBundle} buyButtonText={buyButtonText} />
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

      <EmailSubscribe />

      {/* Sticky mobile CTA */}
      {inStock && showSticky && (
        <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white border-t border-cream-2 px-4 py-3 flex items-center gap-3 shadow-lg shadow-ink/10">
          {deal.images[0] && (
            <img
              src={deal.images[0].url}
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

