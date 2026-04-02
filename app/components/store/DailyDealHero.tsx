import { useState, useRef, useEffect } from 'react'
import { useFetcher } from 'react-router'
import type { Deal } from '~/types'
import { StockIndicator }  from './StockIndicator'
import { SocialProofBar }  from './SocialProofBar'
import { ProductTabs }     from './ProductTabs'

interface DailyDealHeroProps {
  deal:       Deal
  cartId?:    string
  viewers?:   number
  soldToday?: number
}

export function DailyDealHero({ deal, cartId, viewers = 0, soldToday = 0 }: DailyDealHeroProps) {
  const [activeImg,   setActiveImg]   = useState(0)
  const [quantity,    setQuantity]    = useState(1)
  const [showSticky,  setShowSticky]  = useState(false)
  const ctaRef  = useRef<HTMLButtonElement>(null)
  const fetcher = useFetcher()
  const isPending = fetcher.state !== 'idle'

  const discount = deal.msrp > 0
    ? Math.round(((deal.msrp - deal.dealPrice) / deal.msrp) * 100)
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
            relative
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
          relative={false}
        />
      )}

      {/* ── Sticky mobile CTA ─────────────────────────────────────────── */}
      {deal.qty > 0 && showSticky && (
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
              ${deal.dealPrice.toFixed(2)}
              {deal.msrp > deal.dealPrice && (
                <span className="text-brand-charcoal/40 line-through ml-2 font-normal">
                  ${deal.msrp.toFixed(2)}
                </span>
              )}
            </p>
          </div>
          <fetcher.Form method="post" action="/checkout-extras">
            <input type="hidden" name="intent"    value="add-to-cart" />
            <input type="hidden" name="variantId" value={deal.variantId} />
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
}

function HeroContent({
  deal, discount, worksFor, activeImg, setActiveImg,
  quantity, setQuantity, cartId, viewers, soldToday,
  isPending, fetcher, ctaRef, relative,
}: HeroContentProps) {
  return (
    <section className={`max-w-6xl mx-auto px-4 py-8 ${relative ? 'relative' : ''}`}>
      <div className="grid md:grid-cols-2 gap-8 lg:gap-12 items-start">

        {/* ── Left: Image gallery ─────────────────────────────────── */}
        <div className="space-y-3">
          <div className="aspect-square rounded-2xl overflow-hidden bg-brand-mist shadow-sm">
            {deal.images[activeImg] ? (
              <img
                src={deal.images[activeImg]!.url}
                alt={deal.images[activeImg]!.altText || deal.seoTitle}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-brand-charcoal/20 text-6xl">
                ♥
              </div>
            )}
          </div>

          {deal.images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide">
              {deal.images.slice(0, 8).map((img, i) => (
                <button
                  key={i}
                  onClick={() => setActiveImg(i)}
                  className={[
                    'shrink-0 w-16 h-16 rounded-xl overflow-hidden border-2 transition-all',
                    i === activeImg
                      ? 'border-brand-coral'
                      : 'border-transparent opacity-60 hover:opacity-100',
                  ].join(' ')}
                  aria-label={`View image ${i + 1}`}
                >
                  <img src={img.url} alt="" className="w-full h-full object-cover" />
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
              ${deal.dealPrice.toFixed(2)}
            </span>
            {deal.msrp > deal.dealPrice && (
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
          <div className="flex items-center gap-2 text-sm text-brand-charcoal/60 flex-wrap">
            <span>Works for:</span>
            {worksFor[0] && <WorksForBadge label="Him"     emoji="♂" />}
            {worksFor[1] && <WorksForBadge label="Her"     emoji="♀" />}
            {worksFor[2] && <WorksForBadge label="Couples" emoji="🫶" />}
          </div>

          {/* Quantity + Add to cart */}
          <fetcher.Form method="post" action="/checkout-extras" className="space-y-3">
            <input type="hidden" name="intent"    value="add-to-cart" />
            <input type="hidden" name="variantId" value={deal.variantId} />
            {cartId && <input type="hidden" name="cartId" value={cartId} />}

            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-brand-charcoal/70" htmlFor="qty">Qty</label>
              <div className="flex items-center border border-brand-mist rounded-full overflow-hidden bg-white">
                <button
                  type="button"
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  className="px-3 py-2 text-brand-charcoal hover:bg-brand-mist transition-colors"
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <input id="qty" type="hidden" name="quantity" value={quantity} />
                <span className="px-4 text-sm font-semibold text-brand-charcoal">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity(q => Math.min(3, q + 1))}
                  className="px-3 py-2 text-brand-charcoal hover:bg-brand-mist transition-colors"
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
              disabled={isPending || deal.qty <= 0}
              className={[
                'w-full py-4 rounded-full font-bold text-lg transition-all',
                deal.qty > 0
                  ? 'bg-brand-gradient text-white hover:opacity-90 hover:scale-[1.01] shadow-md shadow-brand-coral/20'
                  : 'bg-brand-charcoal/10 text-brand-charcoal/40 cursor-not-allowed',
              ].join(' ')}
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {deal.qty <= 0 ? 'Sold Out' : isPending ? 'Adding...' : 'Dip In ♥'}
            </button>
          </fetcher.Form>

          {/* Stock + Trust badges */}
          <StockIndicator qty={deal.qty} />

          <div className="flex flex-wrap gap-3 pt-2">
            {['🔒 Secure checkout', '📦 Ships discreetly', '↩️ 14-day returns'].map(badge => (
              <span
                key={badge}
                className="text-xs text-brand-charcoal/50 bg-brand-mist px-3 py-1 rounded-full"
              >
                {badge}
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
