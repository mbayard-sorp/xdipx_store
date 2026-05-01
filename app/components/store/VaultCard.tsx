import { useEffect, useRef, useState } from 'react'
import { Link, useFetcher } from 'react-router'
import type { VaultDeal } from '~/types'
import { HeartButton } from './HeartButton'
import { CardVideo } from './CardVideo'
import { abbreviate, buildPieGradient } from './CircleOptionSelector'
import { shopifyImageUrl, shopifyImageSrcSet } from '~/lib/shopify-image'

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
    <article className="bg-white rounded-2xl overflow-hidden shadow-sm card-lift group relative">
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
      <Link to={`/products/${deal.handle}`} className="block">
        <div className="aspect-[4/5] overflow-hidden bg-cream-2 relative">
          {deal.heroVideo?.src ? (
            <CardVideo cardId={deal.id} video={deal.heroVideo} title={deal.seoTitle} />
          ) : deal.images[0] ? (
            <img
              src={shopifyImageUrl(deal.images[0].url, 480) || deal.images[0].url}
              srcSet={shopifyImageSrcSet(deal.images[0].url, [240, 360, 480, 720])}
              sizes="(min-width: 768px) 25vw, 50vw"
              alt={deal.images[0].altText || deal.seoTitle}
              className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-300"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink/10 text-5xl">♥</div>
          )}

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

        <div className="p-4">
          <p className="text-ink/50 text-xs uppercase tracking-wide mb-1">{deal.brand}</p>
          <h3
            className="font-semibold text-ink text-sm leading-snug line-clamp-2 group-hover:text-coral transition-colors"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {deal.seoTitle}
          </h3>

          <div className="flex items-center gap-2 mt-2">
            <span className="text-coral font-bold">${deal.dealPrice.toFixed(2)}</span>
            {deal.msrp > deal.dealPrice && (
              <span className="text-ink/40 text-sm line-through">${deal.msrp.toFixed(2)}</span>
            )}
            {discount > 0 && (
              <span className="text-coral text-xs font-semibold">{discount}% off</span>
            )}

            {/* Scaled swatch — sits in the right side of the price row when
                the product has multiple colors or sizes. Decorative; tap on
                the card still goes to the PDP via the wrapping <Link>. */}
            {(deal.colorValues || deal.sizeValues) && (
              <span
                aria-hidden="true"
                className="ml-auto flex items-center gap-1.5"
              >
                {deal.colorValues && deal.colorValues.length > 1 && (
                  <span
                    className="block h-6 w-6 rounded-full border border-ink/80 shadow-sm"
                    style={{ background: buildPieGradient(deal.colorValues) }}
                  />
                )}
                {deal.sizeValues && deal.sizeValues.length > 1 && (
                  <span
                    className="inline-flex items-center justify-center h-6 px-1.5 rounded-full bg-paper border border-ink/80 shadow-sm text-[9px] font-bold tracking-wide text-ink"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {deal.sizeValues.slice(0, 3).map(v => abbreviate(v)).join(' / ')}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      </Link>
    </article>
  )
}
