import { useEffect, useRef, useState } from 'react'
import { Link, useFetcher } from 'react-router'
import type { VaultDeal } from '~/types'
import { HeartButton } from './HeartButton'
import { CardMediaCarousel } from './CardMediaCarousel'
import { abbreviate, buildPieGradient } from './CircleOptionSelector'

interface VaultCardProps {
  deal: VaultDeal
  starred?: { reason: string }
}

export function VaultCard({ deal, starred }: VaultCardProps) {
  const discount = deal.msrp > 0
    ? Math.round(((deal.msrp - deal.dealPrice) / deal.msrp) * 100)
    : 0

  const addToCart = useFetcher<{ ok: boolean }>()
  const [justAdded, setJustAdded] = useState(false)
  const wasSubmitting = useRef(false)

  useEffect(() => {
    if (addToCart.state === 'submitting') wasSubmitting.current = true
    else if (addToCart.state === 'idle' && wasSubmitting.current) {
      wasSubmitting.current = false
      if (addToCart.data?.ok) {
        setJustAdded(true)
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('xdipx:cart-added'))
        }
        const t = setTimeout(() => setJustAdded(false), 1200)
        return () => clearTimeout(t)
      }
    }
  }, [addToCart.state, addToCart.data])

  const canAtc = deal.qty > 0 && !deal.hasMultipleVariants && !!deal.defaultVariantId

  function handleAtcClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (!canAtc || !deal.defaultVariantId) return
    e.preventDefault()
    e.stopPropagation()
    const form = new FormData()
    form.set('intent',    'add-item')
    form.set('variantId', deal.defaultVariantId)
    form.set('quantity',  '1')
    addToCart.submit(form, { method: 'post', action: '/api/cart' })
  }

  return (
    <article className="bg-white rounded-2xl overflow-hidden shadow-sm card-lift group relative h-full flex flex-col">
      {starred && (
        <div className="absolute top-2 left-2 z-10 group/starred">
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-coral text-paper text-[11px] font-semibold shadow-sm"
            style={{ fontFamily: 'var(--font-display)' }}
            aria-label={`Emma's pick: ${starred.reason}`}
          >
            ★ Emma
          </span>
          <span
            className="hidden group-hover/starred:block absolute top-full left-0 mt-1 w-44 p-2 rounded-md bg-ink text-paper text-[11px] leading-snug shadow-lg z-20"
            role="tooltip"
          >
            {starred.reason}
          </span>
        </div>
      )}
      <HeartButton
        shopifyProductId={deal.id}
        handle={deal.handle}
        productTitle={deal.seoTitle}
        price={deal.dealPrice}
        variant="overlay"
        size="sm"
      />
      <Link to={`/products/${deal.handle}`} prefetch="intent" className="flex flex-col flex-1">
        <div className="aspect-[4/5] overflow-hidden bg-cream-2 relative">
          <CardMediaCarousel
            cardId={deal.id}
            title={deal.seoTitle}
            {...(deal.heroVideo ? { heroVideo: deal.heroVideo } : {})}
            images={deal.images}
          />

          {canAtc && (
            <button
              type="button"
              onClick={handleAtcClick}
              disabled={addToCart.state !== 'idle'}
              aria-label={`Add ${deal.seoTitle} to cart`}
              className={[
                'absolute bottom-2 right-2 z-10 inline-flex items-center gap-1.5 rounded-full pl-2.5 pr-3 py-1.5 text-white text-xs font-bold shadow-md transition-all',
                justAdded ? 'bg-sage scale-105' : 'bg-coral hover:bg-coral/90 hover:scale-105',
                addToCart.state !== 'idle' ? 'opacity-70' : '',
              ].join(' ')}
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {justAdded ? (
                <>
                  <span aria-hidden="true">♥</span>
                  <span>Added</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <path d="M16 10a4 4 0 01-8 0" />
                  </svg>
                  <span>+ Add</span>
                </>
              )}
            </button>
          )}

        </div>

        <div className="p-4 flex flex-col flex-1">
          <p className="text-ink/50 text-xs uppercase tracking-wide mb-1">{deal.brand}</p>
          <h3
            className="font-semibold text-ink text-sm leading-snug line-clamp-2 group-hover:text-coral transition-colors"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {deal.seoTitle}
          </h3>

          <div className="flex items-center gap-2 mt-auto pt-2">
            <span className="text-coral font-bold">
              {deal.priceMin != null && deal.priceMax != null && deal.priceMax > deal.priceMin
                ? `$${deal.priceMin.toFixed(2)}–$${deal.priceMax.toFixed(2)}`
                : `$${deal.dealPrice.toFixed(2)}`}
            </span>
            {(deal.priceMin == null || deal.priceMax == null || deal.priceMax === deal.priceMin) &&
              deal.msrp > deal.dealPrice && (
                <span className="text-ink/40 text-sm line-through">${deal.msrp.toFixed(2)}</span>
              )}
          </div>
          {(() => {
            const sizes = deal.sizeValues && deal.sizeValues.length > 1 ? deal.sizeValues : null
            const colors = deal.colorValues && deal.colorValues.length > 1 ? deal.colorValues : null
            const sizeLabel = sizes
              ? sizes.length > 2
                ? `${sizes.length} sizes`
                : sizes.map(v => abbreviate(v)).join(' / ')
              : null
            const hasPriceRange =
              deal.priceMin != null && deal.priceMax != null && deal.priceMax > deal.priceMin
            const showFlatSavings  = discount > 0 && !hasPriceRange
            const showRangeSavings = hasPriceRange && (deal.maxSavingsAmount ?? 0) > 0
            if (!showFlatSavings && !showRangeSavings && !sizes && !colors) return null
            return (
              <div className="flex items-center gap-2 mt-1">
                {showFlatSavings && (
                  <span className="text-ink/70 text-xs whitespace-nowrap">
                    You save: ${(deal.msrp - deal.dealPrice).toFixed(2)} ({discount}%)
                  </span>
                )}
                {showRangeSavings && (
                  <span className="text-ink/70 text-xs whitespace-nowrap">
                    Save up to ${deal.maxSavingsAmount!.toFixed(2)} ({deal.maxSavingsPercent}%)
                  </span>
                )}
                {(sizes || colors) && (
                  <span
                    aria-hidden="true"
                    className="ml-auto flex items-center gap-1.5 shrink-0"
                  >
                    {colors && (
                      <span
                        className="block h-5 w-5 rounded-full border border-ink/80 shadow-sm"
                        style={{ background: buildPieGradient(colors) }}
                      />
                    )}
                    {sizeLabel && (
                      <span
                        className="inline-flex items-center justify-center h-5 px-2 rounded-full bg-paper border border-ink/80 shadow-sm text-[9px] font-bold tracking-wide text-ink whitespace-nowrap"
                        style={{ fontFamily: 'var(--font-display)' }}
                      >
                        {sizeLabel}
                      </span>
                    )}
                  </span>
                )}
              </div>
            )
          })()}
        </div>
      </Link>
    </article>
  )
}
