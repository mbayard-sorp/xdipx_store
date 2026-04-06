import { useState, useRef, useEffect } from 'react'
import { useFetcher } from 'react-router'
import type { Deal, ProductVideo, ProductVariant } from '~/types'
import type { Review, ReviewAggregate } from '~/types/reviews'
import { StockIndicator }   from './StockIndicator'
import { SocialProofBar }   from './SocialProofBar'
import { ProductTabs }      from './ProductTabs'
import { InlineCountdown }  from './CountdownTimer'

// ─── Gallery media types ──────────────────────────────────────────────────────

type GalleryItem =
  | { kind: 'image'; url: string; altText: string }
  | { kind: 'video'; previewUrl: string; sources: ProductVideo['sources'] }

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
  deal:         Deal
  cartId?:      string
  viewers?:     number
  soldToday?:   number
  reviews?:     Review[]
  reviewTotal?: number
  aggregate?:   ReviewAggregate | null
}

export function DailyDealHero({ deal, cartId, viewers = 0, soldToday = 0, reviews = [], reviewTotal = 0, aggregate = null }: DailyDealHeroProps) {
  const [activeImg,   setActiveImg]   = useState(0)
  const [quantity,    setQuantity]    = useState(1)
  const [showSticky,  setShowSticky]  = useState(false)
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
  const variantPrice = selectedVariant ? parseFloat(selectedVariant.price) : deal.dealPrice
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
    }
  }, [fetcher.state])

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
            variantInStock={variantInStock}
            variantQty={variantQty}
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
          variantInStock={variantInStock}
          variantQty={variantQty}
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
          <fetcher.Form method="post" action="/checkout-extras">
            <input type="hidden" name="intent"    value="add-to-cart" />
            <input type="hidden" name="variantId" value={selectedVariant?.id ?? deal.variantId} />
            <input type="hidden" name="quantity"  value={quantity} />
            {cartId && <input type="hidden" name="cartId" value={cartId} />}
            <button
              type="submit"
              disabled={isPending}
              className="bg-brand-gradient text-white font-bold text-sm px-5 py-2.5 rounded-full hover:opacity-90 transition-opacity shrink-0"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {isPending ? 'Adding...' : 'Dip In ♥'}
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
  variantInStock: boolean
  variantQty: number
}

function HeroContent({
  deal, discount, worksFor, activeImg, setActiveImg,
  quantity, setQuantity, cartId, viewers, soldToday,
  isPending, fetcher, ctaRef, relative,
  reviews, reviewTotal, aggregate,
  multiVariant, variants, options, selectedId, setSelectedId,
  selectedVariant, variantPrice, variantInStock, variantQty,
}: HeroContentProps) {
  const allMedia = buildGallery(deal)
  const [isPlaying, setIsPlaying] = useState(false)

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
        setIsPlaying(false)
      }
    }
  }

  const activeItem = allMedia[activeImg]

  function selectMedia(i: number) {
    setActiveImg(i)
    setIsPlaying(false)
  }

  return (
    <section className={`max-w-6xl mx-auto px-4 py-8 ${relative ? 'relative' : ''}`}>
      <div className="grid md:grid-cols-2 gap-8 lg:gap-12 items-start">

        {/* ── Left: Media gallery ──────────────────────────────────── */}
        <div className="space-y-3">
          <div className="relative aspect-square rounded-2xl overflow-hidden bg-brand-mist shadow-sm">
            {activeItem?.kind === 'video' && isPlaying ? (
              <video
                key={activeItem.sources[0]?.url}
                controls
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              >
                {activeItem.sources.map(s => (
                  <source key={s.url} src={s.url} type={s.mimeType} />
                ))}
              </video>
            ) : activeItem?.kind === 'video' ? (
              <>
                <img
                  src={activeItem.previewUrl}
                  alt={deal.seoTitle}
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={() => setIsPlaying(true)}
                  className="absolute inset-0 flex items-center justify-center group"
                  aria-label="Play video"
                >
                  <div className="w-16 h-16 rounded-full bg-white/90 shadow-lg flex items-center justify-center transition-transform group-hover:scale-110">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <polygon points="8,5 20,12 8,19" fill="#1E1A2E" />
                    </svg>
                  </div>
                </button>
              </>
            ) : activeItem?.kind === 'image' ? (
              <img
                src={activeItem.url}
                alt={activeItem.altText || deal.seoTitle}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-brand-charcoal/20 text-6xl">
                ♥
              </div>
            )}
          </div>

          {allMedia.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {allMedia.slice(0, 8).map((item, i) => (
                <button
                  key={i}
                  onClick={() => selectMedia(i)}
                  className={[
                    'relative shrink-0 w-16 h-16 rounded-xl overflow-hidden border-2 transition-all',
                    i === activeImg
                      ? 'border-brand-coral'
                      : 'border-transparent opacity-60 hover:opacity-100',
                  ].join(' ')}
                  aria-label={item.kind === 'video' ? `Play video ${i + 1}` : `View image ${i + 1}`}
                >
                  <img
                    src={item.kind === 'video' ? item.previewUrl : item.url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                  {item.kind === 'video' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-brand-charcoal/30">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                        <polygon points="5,3 19,12 5,21" />
                      </svg>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

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

          {/* Quantity + Add to cart */}
          <fetcher.Form method="post" action="/checkout-extras" className="space-y-3">
            <input type="hidden" name="intent"    value="add-to-cart" />
            <input type="hidden" name="variantId" value={selectedVariant?.id ?? deal.variantId} />
            {cartId && <input type="hidden" name="cartId" value={cartId} />}

            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-brand-charcoal/70" htmlFor="qty">Qty</label>
              <div className="flex items-center border border-brand-mist rounded-full overflow-hidden bg-white">
                <button
                  type="button"
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center text-brand-charcoal hover:bg-brand-mist transition-colors text-lg"
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <input id="qty" type="hidden" name="quantity" value={quantity} />
                <span className="px-4 text-sm font-semibold text-brand-charcoal tabular-nums">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity(q => Math.min(3, q + 1))}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center text-brand-charcoal hover:bg-brand-mist transition-colors text-lg"
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
              <span className="text-xs text-brand-charcoal/40">Max 3</span>
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
              {!variantInStock ? 'Sold Out' : isPending ? 'Adding...' : 'Dip In ♥'}
            </button>

            <InlineCountdown />
          </fetcher.Form>

          {/* Stock + Trust badges */}
          <StockIndicator qty={variantQty} />

          <div className="flex flex-wrap gap-2 pt-2">
            {[
              { label: 'Secure checkout', icon: <LockIcon /> },
              { label: 'Ships discreetly', icon: <BoxIcon /> },
              { label: '14-day returns', icon: <ReturnIcon /> },
            ].map(({ label, icon }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 text-xs text-brand-charcoal/60 bg-brand-mist px-3 py-1.5 rounded-full"
              >
                {icon}
                {label}
              </span>
            ))}
          </div>
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
