import { useRef, useEffect, useState } from 'react'
import { useFetcher } from 'react-router'
import type { Deal } from '~/types'
import { trackAddToCart } from '~/lib/analytics.client'
import { StockIndicator } from './StockIndicator'
import { shopifyImageUrl, shopifyImageSrcSet } from '~/lib/shopify-image'

interface EditorialDealHeroProps {
  deal: Deal
  cartId?: string
  buyButtonText?: string
}

function renderQuoteWithHighlight(quote: string) {
  const parts = quote.split(/(\*[^*]+\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <span key={i} className="text-brand-coral">
          {part.slice(1, -1)}
        </span>
      )
    }
    return <span key={i}>{part}</span>
  })
}

export function EditorialDealHero({
  deal,
  cartId,
  buyButtonText = 'Show me →',
}: EditorialDealHeroProps) {
  const fetcher = useFetcher()
  const isPending = fetcher.state !== 'idle'
  const wasSubmitting = useRef(false)

  const firstAvailable = deal.variants?.find(v => v.availableForSale) ?? deal.variants?.[0]
  const variantId = firstAvailable?.id ?? deal.variantId
  const [quantity] = useState(1)

  useEffect(() => {
    if (fetcher.state === 'submitting') {
      wasSubmitting.current = true
    } else if (fetcher.state === 'idle' && wasSubmitting.current) {
      wasSubmitting.current = false
      window.dispatchEvent(new CustomEvent('xdipx:cart-added'))
      trackAddToCart({
        item_id: deal.shopifyProductId,
        item_name: deal.seoTitle,
        item_brand: deal.brand,
        item_category: deal.category,
        price: deal.dealPrice,
        quantity,
      })
    }
  }, [fetcher.state])

  const isMapRestricted = deal.mapPrice > 0 && deal.mapPrice >= deal.dealPrice
  const contextTag = isMapRestricted
    ? 'quiet endorsement · works for MAP-restricted'
    : `quiet endorsement · Emma's pick`

  const quote = deal.emmaQuote && deal.emmaQuote.trim().length > 0
    ? deal.emmaQuote
    : `I've been a little obsessed with this one — it's got a kind of *quiet magic* I wasn't expecting. Come see.`

  const caption = deal.editorialCaption && deal.editorialCaption.trim().length > 0
    ? deal.editorialCaption
    : `${deal.brand} · ${deal.seoTitle}`

  const priceCommentary = deal.priceCommentary && deal.priceCommentary.trim().length > 0
    ? deal.priceCommentary
    : 'the price is the price — worth it'

  const heroImage = deal.images[0]

  return (
    <section className="max-w-6xl mx-auto px-4 py-8 md:py-12">
      <div className="grid md:grid-cols-[1fr_1fr] gap-6 lg:gap-8 items-stretch">
        {/* Left — Emma's editorial card */}
        <div className="relative border border-brand-charcoal/20 rounded-2xl bg-brand-cream p-6 md:p-8 flex flex-col">
          {/* Context tag — sticky note style */}
          <div className="absolute -top-3 left-4 rotate-[-2deg] bg-amber-100 border border-amber-300 px-3 py-1 shadow-sm rounded-sm">
            <span
              className="text-xs text-brand-charcoal/80"
              style={{ fontFamily: 'var(--font-hand)' }}
            >
              {contextTag}
            </span>
          </div>

          {/* Author row */}
          <div className="flex items-center gap-3 mt-2 mb-5">
            <div className="w-12 h-12 rounded-full bg-brand-coral flex items-center justify-center text-white text-xl font-bold shrink-0"
              style={{ fontFamily: 'var(--font-hand)' }}
            >
              E
            </div>
            <div>
              <p
                className="text-xs font-bold tracking-[0.2em] text-brand-charcoal uppercase"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Emma Says
              </p>
              <p
                className="text-sm text-brand-charcoal/50"
                style={{ fontFamily: 'var(--font-hand)' }}
              >
                updated whenever I change my mind
              </p>
            </div>
          </div>

          {/* Quote */}
          <blockquote
            className="text-2xl md:text-3xl lg:text-4xl leading-[1.2] text-brand-charcoal flex-1"
            style={{ fontFamily: 'var(--font-hand)' }}
          >
            <span className="text-brand-charcoal/60">&ldquo;</span>
            {renderQuoteWithHighlight(quote)}
            <span className="text-brand-charcoal/60">&rdquo;</span>
          </blockquote>

          {/* CTAs */}
          <div className="flex flex-wrap gap-3 mt-6">
            <fetcher.Form method="post" action="/api/cart">
              <input type="hidden" name="intent"    value="add-item" />
              <input type="hidden" name="variantId" value={variantId} />
              <input type="hidden" name="quantity"  value={quantity} />
              {cartId && <input type="hidden" name="cartId" value={cartId} />}
              <button
                type="submit"
                disabled={isPending || !firstAvailable?.availableForSale}
                className="bg-brand-coral text-white font-bold px-6 py-3 rounded-full hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ fontFamily: 'var(--font-hand)', fontSize: '1.25rem' }}
              >
                {isPending ? 'Adding…' : buyButtonText}
              </button>
            </fetcher.Form>

            {/* Stubbed — chat widget follow-up */}
            <button
              type="button"
              className="border-2 border-brand-charcoal/30 text-brand-charcoal px-6 py-3 rounded-full hover:border-brand-charcoal/60 transition-colors"
              style={{ fontFamily: 'var(--font-hand)', fontSize: '1.25rem' }}
              aria-label="What else she's into (chat coming soon)"
              /* TODO: wire to chat widget once /api/chat + drawer ship */
            >
              What else she&apos;s into
            </button>
          </div>
        </div>

        {/* Right — product card */}
        <div className="border border-brand-charcoal/20 rounded-2xl bg-brand-cream overflow-hidden flex flex-col">
          <div className="aspect-[4/3] md:aspect-auto md:flex-1 bg-brand-mist/40 relative">
            {heroImage && (
              <img
                src={shopifyImageUrl(heroImage.url, 800) || heroImage.url}
                srcSet={shopifyImageSrcSet(heroImage.url, [480, 640, 800, 1200])}
                sizes="(min-width: 768px) 50vw, 100vw"
                alt={heroImage.altText || deal.seoTitle}
                decoding="async"
                fetchPriority="high"
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
          </div>
          <div className="border-t border-brand-charcoal/20 p-5 md:p-6 space-y-1">
            <p
              className="text-lg md:text-xl text-brand-charcoal"
              style={{ fontFamily: 'var(--font-hand)' }}
            >
              {caption}
            </p>
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span
                className="text-2xl md:text-3xl font-bold text-brand-coral"
                style={{ fontFamily: 'var(--font-hand)' }}
              >
                ${deal.dealPrice.toFixed(2)}
              </span>
              <span
                className="text-sm text-brand-charcoal/60"
                style={{ fontFamily: 'var(--font-hand)' }}
              >
                · {priceCommentary}
              </span>
            </p>
            <div className="pt-2">
              <StockIndicator qty={deal.qty} />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
