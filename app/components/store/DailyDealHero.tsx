import { useState, useRef, useEffect } from 'react'
import { useFetcher } from 'react-router'
import type { Deal, ProductVariant } from '~/types'
import { trackAddToCart, trackCountdownUrgency } from '~/lib/analytics.client'
import type { Review, ReviewAggregate } from '~/types/reviews'
import { ProductImageGallery, type GalleryItem } from './ProductImageGallery'
import { StockIndicator }   from './StockIndicator'
import { SocialProofBar }   from './SocialProofBar'
import { ProductTabs }      from './ProductTabs'
import { SubscriptionSelector, getSubscriptionPrice } from './SubscriptionSelector'
import { ShareButtons } from '../common/ShareButtons'
import { HeartButton } from './HeartButton'

// ─── Gallery media types ──────────────────────────────────────────────────────

function buildGallery(deal: Deal): GalleryItem[] {
  const videos: GalleryItem[] = (deal.videos ?? []).map(v => ({
    kind: 'video',
    previewUrl: v.previewImageUrl,
    sources: v.sources,
  }))
  const images: GalleryItem[] = deal.images.map(img => ({
    kind: 'image',
    url: img.url,
    altText: img.altText,
  }))
  // First image → videos → remaining images
  const [first, ...rest] = images
  return first ? [first, ...videos, ...rest] : [...videos]
}

interface DailyDealHeroProps {
  deal:           Deal
  cartId?:        string
  viewers?:       number
  soldToday?:     number
  reviews?:       Review[]
  reviewTotal?:   number
  aggregate?:     ReviewAggregate | null
  buyButtonText?: string
  shareUrl?:      string
  shareTitle?:    string
  shareImage?:    string | null
}

export function DailyDealHero({ deal, cartId, viewers = 0, soldToday = 0, reviews = [], reviewTotal = 0, aggregate = null, buyButtonText = 'I Want It ❤️', shareUrl, shareTitle, shareImage }: DailyDealHeroProps) {
  const [activeImg,      setActiveImg]      = useState(0)
  const [quantity,       setQuantity]       = useState(1)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [showSticky,     setShowSticky]     = useState(false)
  const ctaRef        = useRef<HTMLButtonElement>(null)
  const wasSubmitting = useRef(false)
  const fetcher       = useFetcher()
  const isPending     = fetcher.state !== 'idle'

  // ── Variant state ──────────────────────────────────────────────────────
  const variants     = deal.variants ?? []
  const options      = deal.options  ?? []
  const multiVariant = variants.length > 1
  const firstAvailable = variants.find(v => v.availableForSale) ?? variants[0]
  const [selectedId, setSelectedId] = useState(firstAvailable?.id ?? deal.variantId)
  const selectedVariant = variants.find(v => v.id === selectedId) ?? variants[0]
  const basePrice = selectedVariant ? parseFloat(selectedVariant.price) : deal.dealPrice
  const activePlan = selectedPlanId
    ? deal.sellingPlanGroups?.flatMap(g => g.sellingPlans).find(p => p.id === selectedPlanId)
    : undefined
  const variantPrice = activePlan ? getSubscriptionPrice(basePrice, activePlan) : basePrice
  const variantInStock = selectedVariant?.availableForSale ?? deal.qty > 0
  const variantQty = selectedVariant?.quantityAvailable ?? deal.qty

  // Fire a custom event when the add-to-cart fetcher completes so the
  // cart drawer can open without prop-drilling or context.
  useEffect(() => {
    if (fetcher.state === 'submitting') {
      wasSubmitting.current = true
    } else if (fetcher.state === 'idle' && wasSubmitting.current) {
      wasSubmitting.current = false
      window.dispatchEvent(new CustomEvent('xdipx:cart-added'))
      // GA4: add_to_cart
      trackAddToCart({
        item_id: deal.shopifyProductId,
        item_name: deal.seoTitle,
        item_brand: deal.brand,
        item_category: deal.category,
        price: variantPrice,
        quantity,
        ...(selectedVariant?.title ? { item_variant: selectedVariant.title } : {}),
      })
    }
  }, [fetcher.state])

  // GA4: countdown urgency — fire once per session when < 2 hours remain
  const urgencyFired = useRef(false)
  useEffect(() => {
    if (urgencyFired.current) return
    const now = new Date()
    const midnight = new Date(now)
    midnight.setHours(24, 0, 0, 0)
    const hoursRemaining = (midnight.getTime() - now.getTime()) / (1000 * 60 * 60)
    if (hoursRemaining < 2) {
      urgencyFired.current = true
      trackCountdownUrgency(Math.round(hoursRemaining * 10) / 10)
    }
  }, [])

  const discount = deal.msrp > 0 && deal.msrp > variantPrice
    ? Math.round(((deal.msrp - variantPrice) / deal.msrp) * 100)
    : 0

  const worksFor: [boolean, boolean, boolean] = [
    deal.category === 'for-him'  || deal.category === 'both' || deal.category === 'couples',
    deal.category === 'for-her'  || deal.category === 'both' || deal.category === 'couples',
    deal.category === 'couples',
  ]

  // Sticky mobile CTA — appears when the main CTA button scrolls out of view
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

  return (
    <>
      {/* ── Mood image background ──────────────────────────────────────── */}
      {deal.moodImageUrl && (
        <div className="relative overflow-hidden">
          <img
            src={deal.moodImageUrl}
            alt=""
            aria-hidden="true"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-brand-cream/97 via-brand-cream/90 to-brand-cream/60" />
          <HeroContent
            deal={deal}
            discount={discount}
            worksFor={worksFor}
            activeImg={activeImg}
            setActiveImg={setActiveImg}
            quantity={quantity}
            setQuantity={setQuantity}
            cartId={cartId}
            viewers={viewers}
            soldToday={soldToday}
            isPending={isPending}
            fetcher={fetcher}
            ctaRef={ctaRef}
            reviews={reviews}
            reviewTotal={reviewTotal}
            aggregate={aggregate}
            relative
            multiVariant={multiVariant}
            variants={variants}
            options={options}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            selectedVariant={selectedVariant}
            variantPrice={variantPrice}
            basePrice={basePrice}
            variantInStock={variantInStock}
            variantQty={variantQty}
            selectedPlanId={selectedPlanId}
            setSelectedPlanId={setSelectedPlanId}
            buyButtonText={buyButtonText}
            {...(shareUrl   !== undefined ? { shareUrl }   : {})}
            {...(shareTitle !== undefined ? { shareTitle } : {})}
            {...(shareImage !== undefined ? { shareImage } : {})}
          />
        </div>
      )}

      {/* ── No mood image: plain section ──────────────────────────────── */}
      {!deal.moodImageUrl && (
        <HeroContent
          deal={deal}
          discount={discount}
          worksFor={worksFor}
          activeImg={activeImg}
          setActiveImg={setActiveImg}
          quantity={quantity}
          setQuantity={setQuantity}
          cartId={cartId}
          viewers={viewers}
          soldToday={soldToday}
          isPending={isPending}
          fetcher={fetcher}
          ctaRef={ctaRef}
          reviews={reviews}
          reviewTotal={reviewTotal}
          aggregate={aggregate}
          relative={false}
          multiVariant={multiVariant}
          variants={variants}
          options={options}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          selectedVariant={selectedVariant}
          variantPrice={variantPrice}
          basePrice={basePrice}
          variantInStock={variantInStock}
          variantQty={variantQty}
          selectedPlanId={selectedPlanId}
          setSelectedPlanId={setSelectedPlanId}
          buyButtonText={buyButtonText}
          {...(shareUrl   !== undefined ? { shareUrl }   : {})}
          {...(shareTitle !== undefined ? { shareTitle } : {})}
          {...(shareImage !== undefined ? { shareImage } : {})}
        />
      )}

      {/* ── Sticky mobile CTA ─────────────────────────────────────────── */}
      {variantInStock && showSticky && (
        <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white border-t border-brand-mist px-4 py-3 flex items-center gap-3 shadow-lg shadow-brand-charcoal/10">
          {deal.images[0] && (
            <img
              src={deal.images[0].url}
              alt=""
              aria-hidden="true"
              width={48}
              height={48}
              loading="lazy"
              decoding="async"
              className="w-12 h-12 rounded-xl object-cover bg-brand-mist shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-brand-charcoal/60 truncate">{deal.brand}</p>
            <p
              className="text-sm font-bold text-brand-charcoal truncate"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              ${variantPrice.toFixed(2)}
              {deal.msrp > variantPrice && (
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
            {cartId && <input type="hidden" name="cartId" value={cartId} />}
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
    </>
  )
}

// ─── Inner hero layout (shared between mood-image and plain variants) ──────

interface HeroContentProps {
  deal: Deal
  discount: number
  worksFor: [boolean, boolean, boolean]
  activeImg: number
  setActiveImg: (i: number) => void
  quantity: number
  setQuantity: React.Dispatch<React.SetStateAction<number>>
  cartId: string | undefined
  viewers: number
  soldToday: number
  isPending: boolean
  fetcher: ReturnType<typeof useFetcher>
  ctaRef: React.RefObject<HTMLButtonElement | null>
  relative: boolean
  reviews: Review[]
  reviewTotal: number
  aggregate: ReviewAggregate | null
  multiVariant: boolean
  variants: ProductVariant[]
  options: { name: string; values: string[] }[]
  selectedId: string
  setSelectedId: (id: string) => void
  selectedVariant: ProductVariant | undefined
  variantPrice: number
  basePrice: number
  variantInStock: boolean
  variantQty: number
  selectedPlanId: string | null
  setSelectedPlanId: (id: string | null) => void
  buyButtonText: string
  shareUrl?: string
  shareTitle?: string
  shareImage?: string | null
}

function HeroContent({
  deal, discount, worksFor, activeImg, setActiveImg,
  quantity, setQuantity, cartId, viewers, soldToday,
  isPending, fetcher, ctaRef, relative,
  reviews, reviewTotal, aggregate,
  multiVariant, variants, options, selectedId, setSelectedId,
  selectedVariant, variantPrice, basePrice, variantInStock, variantQty,
  selectedPlanId, setSelectedPlanId, buyButtonText,
  shareUrl, shareTitle, shareImage,
}: HeroContentProps) {
  const allMedia = buildGallery(deal)

  // When a color variant is selected, jump to its image in the gallery
  function handleVariantSelect(variantId: string) {
    setSelectedId(variantId)
    const v = variants.find(vr => vr.id === variantId)
    if (v?.image) {
      const idx = allMedia.findIndex(
        m => m.kind === 'image' && m.url === v.image!.url,
      )
      if (idx >= 0) {
        setActiveImg(idx)
      }
    }
  }

  return (
    <section className={`max-w-6xl mx-auto px-4 py-8 ${relative ? 'relative' : ''}`}>
      <div className="grid md:grid-cols-2 gap-8 lg:gap-12 items-start">

        {/* ── Left: Media gallery ──────────────────────────────────── */}
        <ProductImageGallery
          items={allMedia}
          alt={deal.seoTitle}
          activeIndex={activeImg}
          onSelectIndex={setActiveImg}
          shareOverlay={
            shareUrl && shareTitle ? (
              <ShareButtons
                url={shareUrl}
                title={shareTitle}
                image={shareImage ?? null}
                variant="overlay"
              />
            ) : null
          }
          heartOverlay={
            <HeartButton
              shopifyProductId={deal.shopifyProductId}
              handle={deal.handle}
              productTitle={deal.seoTitle}
              price={variantPrice}
              variant="overlay"
              size="md"
            />
          }
        />

        {/* ── Right: Product info ─────────────────────────────────── */}
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
              ${variantPrice.toFixed(2)}
            </span>
            {deal.msrp > variantPrice && (
              <>
                <span className="text-brand-charcoal/40 text-xl line-through">
                  ${deal.msrp.toFixed(2)}
                </span>
                <span className="bg-brand-gradient text-white text-sm font-bold px-3 py-1 rounded-full">
                  {discount}% off
                </span>
              </>
            )}
            <StockIndicator qty={variantQty} />
          </div>

          {/* Social proof */}
          <SocialProofBar viewers={viewers} soldToday={soldToday} />

          {/* Feature bullets */}
          {deal.featureBullets.length > 0 && (
            <ul className="space-y-2">
              {deal.featureBullets.map((bullet, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed text-brand-charcoal/80">
                  <span className="text-brand-purple text-base mt-0.5 shrink-0 leading-none" aria-hidden="true">♥</span>
                  {bullet}
                </li>
              ))}
            </ul>
          )}

          {/* Works for */}
          <div className="flex items-center gap-2 text-sm text-brand-charcoal/60 flex-wrap">
            <span>Works for:</span>
            {worksFor[0] && <WorksForBadge label="Him"     emoji="♂" />}
            {worksFor[1] && <WorksForBadge label="Her"     emoji="♀" />}
            {worksFor[2] && <WorksForBadge label="Couples" emoji="🫶" />}
          </div>

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

          {/* Quantity + Add to cart */}
          <fetcher.Form method="post" action="/api/cart" className="space-y-3">
            <input type="hidden" name="intent"    value="add-item" />
            <input type="hidden" name="variantId" value={selectedVariant?.id ?? deal.variantId} />
            {selectedPlanId && <input type="hidden" name="sellingPlanId" value={selectedPlanId} />}
            {cartId && <input type="hidden" name="cartId" value={cartId} />}

            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-brand-charcoal/70">Qty</span>
              <div className="flex items-center border border-brand-mist rounded-full overflow-hidden bg-white" role="group" aria-label="Quantity">
                <button
                  type="button"
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center text-brand-charcoal hover:bg-brand-mist transition-colors text-lg"
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <input type="hidden" name="quantity" value={quantity} />
                <span className="px-4 text-sm font-semibold text-brand-charcoal tabular-nums" role="status" aria-live="polite" aria-label={`Quantity: ${quantity}`}>{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity(q => Math.min(3, q + 1))}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center text-brand-charcoal hover:bg-brand-mist transition-colors text-lg"
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
            </div>

            <button
              ref={ctaRef}
              type="submit"
              disabled={isPending || !variantInStock}
              className={[
                'w-full py-4 rounded-full font-bold text-lg transition-all',
                variantInStock
                  ? 'bg-brand-gradient text-white hover:opacity-90 hover:scale-[1.01] shadow-md shadow-brand-coral/20'
                  : 'bg-brand-charcoal/10 text-brand-charcoal/40 cursor-not-allowed',
              ].join(' ')}
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {!variantInStock ? 'Sold Out' : isPending ? 'Adding...' : buyButtonText}
            </button>
          </fetcher.Form>
        </div>
      </div>

      {/* Tabbed content */}
      <ProductTabs
        fullStory={deal.fullStory}
        boxContents={deal.boxContents}
        forHim={deal.worksForHim}
        forHer={deal.worksForHer}
        specifications={deal.specifications}
        productId={deal.shopifyProductId}
        reviews={reviews}
        reviewTotal={reviewTotal}
        aggregate={aggregate}
      />
    </section>
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

