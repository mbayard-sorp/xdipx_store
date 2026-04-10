import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useOutletContext, useFetcher, useSearchParams } from 'react-router'
import { ProductImageGallery, type GalleryItem } from '~/components/store/ProductImageGallery'
import {
  getDealByHandle, getProductsByTag,
  getCollectionProducts, getProductsByHandles,
} from '~/lib/shopify.server'
import { getProductPageBlocks } from '~/lib/sanity.server'
import { getProductReviews, getProductAggregate } from '~/lib/reviews.server'
import { ProductStructuredData }  from '~/components/seo/ProductStructuredData'
import { ProductTabs }            from '~/components/store/ProductTabs'
import { SocialProofBar }         from '~/components/store/SocialProofBar'
import { StockIndicator }         from '~/components/store/StockIndicator'
import { WaitlistButton }         from '~/components/store/WaitlistButton'
import { SubscriptionSelector, getSubscriptionPrice } from '~/components/store/SubscriptionSelector'
import { EmailSubscribe }         from '~/components/store/EmailSubscribe'
import { ContentBlockRenderer }   from '~/components/cms/ContentBlockRenderer'
import type { Product } from '~/types'
import type { ProductCarouselBlock } from '~/types/cms'

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  const deal = await getDealByHandle(params['slug']!)
  if (!deal) throw new Response('Product not found', { status: 404 })

  const url          = new URL(request.url)
  const reviewPage   = parseInt(url.searchParams.get('reviewPage')   ?? '1', 10)
  const reviewSort   = url.searchParams.get('reviewSort')   ?? 'newest'
  const reviewFilter = url.searchParams.get('reviewFilter') ?? 'all'

  const [pdpBlocks, reviewData, aggregate] = await Promise.all([
    getProductPageBlocks(params['slug']!),
    getProductReviews(deal.shopifyProductId, { sort: reviewSort, filter: reviewFilter, page: reviewPage, perPage: 10 }),
    getProductAggregate(deal.shopifyProductId),
  ])

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

  return {
    deal,
    pdpBlocks,
    carouselProductMap,
    reviews:       reviewData.reviews,
    reviewTotal:   reviewData.total,
    reviewPage,
    reviewSort,
    reviewFilter,
    aggregate:     aggregate ?? null,
  }
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data?.deal) return [{ title: 'Product not found | xdipx' }]
  const { deal } = data
  const description = deal.metaDescription || `${deal.seoTitle} — ships discreet from xdipx.`
  return [
    { title: `${deal.seoTitle} | xdipx` },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: `https://xdipx.com/products/${deal.handle}` },
    { property: 'og:title', content: `${deal.seoTitle} | xdipx` },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'product' },
    { property: 'og:url', content: `https://xdipx.com/products/${deal.handle}` },
    { property: 'og:image', content: deal.images[0]?.url ?? '' },
  ]
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProductPage() {
  const {
    deal, pdpBlocks, carouselProductMap,
    reviews, reviewTotal, reviewPage, reviewSort, reviewFilter, aggregate,
  } = useLoaderData<typeof loader>()
  const { buyButtonText } = useOutletContext<{ buyButtonText: string }>()
  const fetcher = useFetcher()
  const isPending = fetcher.state !== 'idle'

  const [searchParams, setSearchParams] = useSearchParams()
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

  // Build unified gallery: first image → videos → remaining images
  const allMedia = useMemo<GalleryItem[]>(() => {
    const videos = (deal.videos ?? []).map(v => ({ kind: 'video' as const, previewUrl: v.previewImageUrl, sources: v.sources }))
    const images = deal.images.map(img => ({ kind: 'image' as const, url: img.url, altText: img.altText }))
    const [first, ...rest] = images
    return first ? [first, ...videos, ...rest] : [...videos]
  }, [deal.videos, deal.images])

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
  const inStock  = selectedVariant?.availableForSale ?? deal.qty > 0
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

  const heroContent = (
    <section className="max-w-6xl mx-auto px-4 py-8 relative">
      <div className="grid md:grid-cols-2 gap-8 lg:gap-12 items-start">

        {/* ── Left: Media gallery ─────────────────────────────────────── */}
        <ProductImageGallery
          items={allMedia}
          alt={deal.seoTitle}
          activeIndex={activeImg}
          onSelectIndex={setActiveImg}
          discountBadge={discount > 0 ? (
            <div className="absolute top-3 left-3 bg-brand-gradient text-white text-xs font-bold px-2.5 py-1 rounded-full">
              {discount}% OFF
            </div>
          ) : undefined}
        />

        {/* ── Right: Product info ─────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Brand + title */}
          <div>
            <p className="text-brand-charcoal/50 text-sm font-medium uppercase tracking-widest">
              {deal.brand}
            </p>
            <h1
              className="text-2xl md:text-3xl font-bold text-brand-charcoal mt-1 leading-snug"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {deal.seoTitle}
            </h1>
            {deal.tagline && (
              <p className="text-brand-charcoal/70 mt-2 italic">{deal.tagline}</p>
            )}
          </div>

          {/* Price */}
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className="text-4xl font-black text-brand-gradient"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              ${price.toFixed(2)}
            </span>
            {deal.msrp > price && (
              <>
                <span className="text-brand-charcoal/40 text-xl line-through">
                  ${deal.msrp.toFixed(2)}
                </span>
                <span className="bg-brand-gradient text-white text-sm font-bold px-3 py-1 rounded-full">
                  {discount}% off
                </span>
              </>
            )}
          </div>

          {/* Social proof */}
          <SocialProofBar />

          {/* Feature bullets */}
          {deal.featureBullets.length > 0 && (
            <ul className="space-y-1.5">
              {deal.featureBullets.map((bullet, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-brand-charcoal/80">
                  <span className="text-brand-purple mt-0.5 shrink-0" aria-hidden="true">♥</span>
                  {bullet}
                </li>
              ))}
            </ul>
          )}

          {/* Works for */}
          {(worksFor[0] || worksFor[1] || worksFor[2]) && (
            <div className="flex items-center gap-2 text-sm text-brand-charcoal/60 flex-wrap">
              <span>Works for:</span>
              {worksFor[0] && <WorksForBadge label="Him"     emoji="♂" />}
              {worksFor[1] && <WorksForBadge label="Her"     emoji="♀" />}
              {worksFor[2] && <WorksForBadge label="Couples" emoji="🫶" />}
            </div>
          )}

          {/* Variant selector */}
          {multiVariant && options.length > 0 && (
            <div className="space-y-3">
              {options.map(opt => (
                <div key={opt.name}>
                  <p className="text-sm font-semibold text-brand-charcoal mb-2" style={{ fontFamily: 'var(--font-display)' }}>
                    {opt.name}
                    {selectedVariant && (
                      <span className="font-normal text-brand-charcoal/50 ml-2">
                        {selectedVariant.selectedOptions.find(o => o.name === opt.name)?.value}
                      </span>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {opt.values.map(val => {
                      const match = variants.find(v =>
                        v.selectedOptions.some(o => o.name === opt.name && o.value === val),
                      )
                      const isSelected  = match?.id === selectedId
                      const isAvailable = match?.availableForSale ?? false
                      return (
                        <button
                          key={val}
                          type="button"
                          onClick={() => match && handleVariantSelect(match.id)}
                          disabled={!isAvailable}
                          className={[
                            'px-4 py-2 rounded-full text-sm font-medium border-2 transition-all',
                            isSelected
                              ? 'border-brand-coral bg-brand-coral/10 text-brand-coral font-semibold'
                              : isAvailable
                                ? 'border-brand-mist text-brand-charcoal hover:border-brand-coral/40'
                                : 'border-brand-mist text-brand-charcoal/30 cursor-not-allowed line-through',
                          ].join(' ')}
                          style={{ fontFamily: 'var(--font-display)' }}
                        >
                          {val}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
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
                <label className="text-sm font-medium text-brand-charcoal/70" htmlFor="qty">Qty</label>
                <div className="flex items-center border border-brand-mist rounded-full overflow-hidden bg-white">
                  <button
                    type="button"
                    onClick={() => setQuantity(q => Math.max(1, q - 1))}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center text-brand-charcoal hover:bg-brand-mist transition-colors text-lg"
                    aria-label="Decrease quantity"
                  >−</button>
                  <input id="qty" type="hidden" name="quantity" value={quantity} />
                  <span className="px-4 text-sm font-semibold text-brand-charcoal tabular-nums">{quantity}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity(q => Math.min(3, q + 1))}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center text-brand-charcoal hover:bg-brand-mist transition-colors text-lg"
                    aria-label="Increase quantity"
                  >+</button>
                </div>
                <span className="text-xs text-brand-charcoal/40">Max 3</span>
              </div>

              <button
                ref={ctaRef}
                type="submit"
                disabled={isPending}
                className="w-full py-4 rounded-full font-bold text-lg bg-brand-gradient text-white hover:opacity-90 hover:scale-[1.01] shadow-md shadow-brand-coral/20 transition-all"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {isPending ? 'Adding...' : buyButtonText}
              </button>
            </fetcher.Form>
          ) : (
            <WaitlistButton productHandle={deal.handle} />
          )}

          {/* Stock + Trust badges */}
          <StockIndicator qty={qty} />

          <div className="flex flex-wrap gap-2 pt-1">
            {[
              { label: 'Secure checkout', Icon: LockIcon },
              { label: 'Ships discreetly', Icon: BoxIcon },
              { label: '14-day returns', Icon: ReturnIcon },
            ].map(({ label, Icon }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 text-xs text-brand-charcoal/60 bg-brand-mist px-3 py-1.5 rounded-full"
              >
                <Icon />
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Tabbed content */}
      <ProductTabs
        fullStory={deal.fullStory}
        boxContents={deal.boxContents ?? []}
        forHim={deal.worksForHim}
        forHer={deal.worksForHer}
        specifications={deal.specifications}
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
          <div className="absolute inset-0 bg-gradient-to-r from-brand-cream/97 via-brand-cream/90 to-brand-cream/60" />
          {heroContent}
        </div>
      ) : heroContent}

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
        <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white border-t border-brand-mist px-4 py-3 flex items-center gap-3 shadow-lg shadow-brand-charcoal/10">
          {deal.images[0] && (
            <img
              src={deal.images[0].url}
              alt=""
              aria-hidden="true"
              className="w-12 h-12 rounded-xl object-cover bg-brand-mist shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-brand-charcoal/60 truncate">{deal.brand}</p>
            <p
              className="text-sm font-bold text-brand-charcoal truncate"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              ${price.toFixed(2)}
              {deal.msrp > price && (
                <span className="text-brand-charcoal/40 line-through ml-2 font-normal">
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
              className="bg-brand-gradient text-white font-bold text-sm px-5 py-2.5 rounded-full hover:opacity-90 transition-opacity shrink-0"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {isPending ? 'Adding...' : buyButtonText}
            </button>
          </fetcher.Form>
        </div>
      )}

      <ProductStructuredData deal={deal} />
    </>
  )
}

function WorksForBadge({ label, emoji }: { label: string; emoji: string }) {
  return (
    <span className="inline-flex items-center gap-1 bg-brand-mist px-2.5 py-0.5 rounded-full text-xs font-medium text-brand-charcoal/70">
      <span aria-hidden="true">{emoji}</span>
      {label}
    </span>
  )
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}
function BoxIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  )
}
function ReturnIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 .49-3.49" />
    </svg>
  )
}
