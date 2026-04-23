import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useOutletContext, useFetcher, useSearchParams } from 'react-router'
import { ProductImageGallery, type GalleryItem } from '~/components/store/ProductImageGallery'
import {
  getDealByHandle, getProductsByTag,
  getCollectionProducts, getProductsByHandles,
  getProductsByIds,
} from '~/lib/shopify.server'
import { getProductPageBlocks } from '~/lib/sanity.server'
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
import BundleHero from '~/components/store/BundleHero'
import BundleSaveCard from '~/components/store/BundleSaveCard'
import { ProductStructuredData }  from '~/components/seo/ProductStructuredData'
import { BreadcrumbStructuredData } from '~/components/seo/BreadcrumbStructuredData'
import { ProductTabs }            from '~/components/store/ProductTabs'
import RecentlyBrowsed            from '~/components/store/RecentlyBrowsed'
import FrequentlyBoughtWith       from '~/components/store/FrequentlyBoughtWith'
import { SensationDial }          from '~/components/store/SensationDial'
import { PairsWith, type PairsWithItem } from '~/components/store/PairsWith'
import { VariantSelector }        from '~/components/store/VariantSelector'
import { SocialProofBar }         from '~/components/store/SocialProofBar'
import { StockIndicator }         from '~/components/store/StockIndicator'
import { WaitlistButton }         from '~/components/store/WaitlistButton'
import { SubscriptionSelector, getSubscriptionPrice } from '~/components/store/SubscriptionSelector'
import { EmailSubscribe }         from '~/components/store/EmailSubscribe'
import { ContentBlockRenderer }   from '~/components/cms/ContentBlockRenderer'
import type { Product } from '~/types'
import type { ProductCarouselBlock } from '~/types/cms'
import { trackViewItem, trackAddToCart } from '~/lib/analytics.client'
import { ShareButtons } from '~/components/common/ShareButtons'
import { HeartButton } from '~/components/store/HeartButton'
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
    }
  }

  const deal = await getDealByHandle(slug)
  if (!deal) throw new Response('Product not found', { status: 404 })

  const url          = new URL(request.url)
  const reviewPage   = parseInt(url.searchParams.get('reviewPage')   ?? '1', 10)
  const reviewSort   = url.searchParams.get('reviewSort')   ?? 'newest'
  const reviewFilter = url.searchParams.get('reviewFilter') ?? 'all'

  const hasDial = !!(deal.sensationDial && deal.productTypeDial)
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

  const [pdpBlocks, reviewData, aggregate, fbtHandles, companionBundle, productVoteAggregate, customerProductVote, pairProducts] = await Promise.all([
    getProductPageBlocks(slug),
    getProductReviews(deal.shopifyProductId, { sort: reviewSort, filter: reviewFilter, page: reviewPage, perPage: 10 }),
    getProductAggregate(deal.shopifyProductId),
    getFrequentlyBoughtWith(slug, 4),
    getBundleCompanionFor(slug),
    hasDial
      ? getProductVoteAggregate(deal.shopifyProductId)
      : Promise.resolve({ agrees: 0, disagrees: 0, agreePct: 0 } as ProductVoteAggregate),
    hasDial && customerGid
      ? getCustomerProductVote(deal.shopifyProductId, customerGid)
      : Promise.resolve(null as (1 | -1 | null)),
    hasPairing ? getProductsByIds(deal.accessoryProductIds) : Promise.resolve([]),
  ])

  const fbtProducts = fbtHandles.length > 0
    ? (await getProductsByHandles(fbtHandles)).map(p => ({
        handle: p.handle,
        title:  p.title,
        image:  p.images[0]?.url ?? null,
        price:  p.price,
        compareAtPrice: p.compareAtPrice ?? null,
      }))
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

  return {
    type: 'product' as const,
    deal,
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
    bundle: null,
  }
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: 'Product not found | xdipx' }]
  if (data.type === 'bundle' && data.bundle) {
    const { bundle } = data
    const title = `${bundle.title} — Bundle Deal | xdipx`
    const description = bundle.tagline || `${bundle.title} — save ${bundle.discountPct}% when you buy the bundle.`
    const url = `https://xdipx.com/products/${bundle.handle}`
    return [
      { title },
      { name: 'description', content: description },
      { tagName: 'link', rel: 'canonical', href: url },
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
  return [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: url },
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
  const reviews = loaderData.reviews
  const reviewTotal = loaderData.reviewTotal
  const reviewPage = loaderData.reviewPage
  const reviewSort = loaderData.reviewSort
  const reviewFilter = loaderData.reviewFilter
  const aggregate = loaderData.aggregate
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

  useEffect(() => {
    if (voteFetcher.state !== 'idle' || !voteFetcher.data) return
    if (voteFetcher.data.ok && voteFetcher.data.aggregate) {
      setProductVoteAggregate(voteFetcher.data.aggregate)
      return
    }
    // Guest tried to vote — bounce through login with pendingVote so we can
    // replay after sign-in.
    if (!voteFetcher.data.ok && voteFetcher.data.loginUrl) {
      window.location.assign(voteFetcher.data.loginUrl)
    }
  }, [voteFetcher.state, voteFetcher.data])

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
  const [selectedId, setSelectedId] = useState(initialVariant?.id ?? deal.variantId)
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
    const images = deal.images.map<GalleryItem>(img => ({ kind: 'image', url: img.url, altText: img.altText }))
    const [first, ...rest] = images
    const base = first ? [first, ...videos, ...rest] : [...videos]
    return heroVideoItem ? [heroVideoItem, ...base] : base
  }, [deal.videos, deal.images, deal.heroVideo])

  // When a variant is selected, jump to its image and update URL
  const handleVariantSelect = useCallback((variantId: string) => {
    setSelectedId(variantId)
    // Update URL param for shareable links (replace, don't push)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('variant', variantId)
      return next
    }, { replace: true })
    // Jump gallery to variant's image
    const v = variants.find(vr => vr.id === variantId)
    if (v?.image) {
      const idx = allMedia.findIndex(
        m => m.kind === 'image' && m.url === v.image!.url,
      )
      if (idx >= 0) {
        setActiveImg(idx)
      }
    }
  }, [variants, allMedia, setSearchParams])

  const selectedVariant = variants.find(v => v.id === selectedId) ?? variants[0]
  const basePrice = selectedVariant ? parseFloat(selectedVariant.price) : deal.dealPrice
  const activePlan = selectedPlanId
    ? deal.sellingPlanGroups?.flatMap(g => g.sellingPlans).find(p => p.id === selectedPlanId)
    : undefined
  const price    = activePlan ? getSubscriptionPrice(basePrice, activePlan) : basePrice
  const isDigital = deal.handle === 'egift-card'
  const inStock  = isDigital ? true : (selectedVariant?.availableForSale ?? deal.qty > 0)
  const qty      = selectedVariant?.quantityAvailable ?? deal.qty
  const discount = deal.msrp > 0 && deal.msrp > price
    ? Math.round(((deal.msrp - price) / deal.msrp) * 100)
    : 0

  const worksFor: [boolean, boolean, boolean] = [
    deal.category === 'for-him'  || deal.category === 'both' || deal.category === 'couples',
    deal.category === 'for-her'  || deal.category === 'both' || deal.category === 'couples',
    deal.category === 'couples',
  ]

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
      item_category: deal.category,
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
          item_category: deal.category,
          price,
          quantity,
          ...(selectedVariant?.title ? { item_variant: selectedVariant.title } : {}),
        })
      }
    }
  }, [fetcher.state, fetcher.data])

  const heroContent = (
    <section className="max-w-6xl mx-auto px-4 py-8 relative">
      <div className="grid md:grid-cols-2 gap-8 lg:gap-12 items-start">

        {/* ── Left: Media gallery ─────────────────────────────────────── */}
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

        {/* ── Right: Product info ─────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Brand + title */}
          <div>
            <p className="text-ink/50 text-sm font-medium uppercase tracking-widest">
              {deal.brand}
            </p>
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
            <StockIndicator qty={qty} isDigital={isDigital} />
          </div>

          {/* How it feels — sensation dial + aggregate vote */}
          {deal.productTypeDial && deal.sensationDial && (
            <SensationDial
              type={deal.productTypeDial}
              values={deal.sensationDial}
              aggregate={productVoteAggregate}
              customerVote={customerVote}
              onAggregateVote={handleAggregateVote}
              voting={voteFetcher.state !== 'idle'}
            />
          )}

          {/* Social proof */}
          <SocialProofBar />

          {/* Works for */}
          {(worksFor[0] || worksFor[1] || worksFor[2]) && (
            <div className="flex items-center gap-2 text-sm text-ink/60 flex-wrap">
              <span>Works for:</span>
              {worksFor[0] && <WorksForBadge label="Him"     emoji="♂" />}
              {worksFor[1] && <WorksForBadge label="Her"     emoji="♀" />}
              {worksFor[2] && <WorksForBadge label="Couples" emoji="🫶" />}
            </div>
          )}

          {/* Variant selector */}
          {multiVariant && (
            <VariantSelector
              variants={variants}
              options={options}
              selectedVariantId={selectedId}
              onVariantSelect={handleVariantSelect}
            />
          )}

          {/* Subscription selector */}
          {deal.sellingPlanGroups && deal.sellingPlanGroups.length > 0 && (
            <SubscriptionSelector
              sellingPlanGroups={deal.sellingPlanGroups}
              basePrice={basePrice}
              selectedPlanId={selectedPlanId}
              onPlanChange={setSelectedPlanId}
            />
          )}

          {/* Qty + Add to cart */}
          {inStock ? (
            <fetcher.Form method="post" action="/api/cart" className="space-y-3">
              <input type="hidden" name="intent"    value="add-item" />
              <input type="hidden" name="variantId" value={selectedVariant?.id ?? deal.variantId} />
              {selectedPlanId && <input type="hidden" name="sellingPlanId" value={selectedPlanId} />}

              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-ink/70" htmlFor="qty">Qty</label>
                <div className="flex items-center border border-cream-2 rounded-full overflow-hidden bg-white">
                  <button
                    type="button"
                    onClick={() => setQuantity(q => Math.max(1, q - 1))}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink hover:bg-cream-2 transition-colors text-lg"
                    aria-label="Decrease quantity"
                  >−</button>
                  <input id="qty" type="hidden" name="quantity" value={quantity} />
                  <span className="px-4 text-sm font-semibold text-ink tabular-nums">{quantity}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity(q => Math.min(3, q + 1))}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink hover:bg-cream-2 transition-colors text-lg"
                    aria-label="Increase quantity"
                  >+</button>
                </div>
                <span className="text-xs text-ink/40">Max 3</span>
              </div>

              <button
                ref={ctaRef}
                type="submit"
                disabled={isPending}
                className="w-full py-4 rounded-full font-bold text-lg bg-coral text-white hover:opacity-90 hover:scale-[1.01] shadow-md shadow-coral/20 transition-all"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {isPending ? 'Adding...' : buyButtonText}
              </button>
            </fetcher.Form>
          ) : (
            <WaitlistButton productHandle={deal.handle} />
          )}

        </div>
      </div>

      {/* Tabbed content */}
      <ProductTabs
        fullStory={deal.fullStory}
        boxContents={deal.boxContents ?? []}
        forHim={deal.worksForHim}
        forHer={deal.worksForHer}
        {...(deal.specifications ? { specifications: deal.specifications } : {})}
        productId={deal.shopifyProductId}
        reviews={reviews}
        reviewTotal={reviewTotal}
        aggregate={aggregate}
        reviewPage={reviewPage}
        reviewSort={reviewSort}
        reviewFilter={reviewFilter}
      />
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
      <BreadcrumbStructuredData items={[
        { name: 'Home',          url: 'https://xdipx.com/' },
        ...(deal.category === 'for-him' ? [{ name: 'For Him', url: 'https://xdipx.com/for-him' }] : []),
        ...(deal.category === 'for-her' ? [{ name: 'For Her', url: 'https://xdipx.com/for-her' }] : []),
        { name: deal.seoTitle,   url: `https://xdipx.com/products/${deal.handle}` },
      ]} />
    </>
  )
}

function WorksForBadge({ label, emoji }: { label: string; emoji: string }) {
  return (
    <span className="inline-flex items-center gap-1 bg-cream-2 px-2.5 py-0.5 rounded-full text-xs font-medium text-ink/70">
      <span aria-hidden="true">{emoji}</span>
      {label}
    </span>
  )
}

