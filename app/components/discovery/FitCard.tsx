/**
 * FitCard — "Emma's fit" closer card.
 *
 * Renders ABOVE the rails once at least one discovery chip is active and the
 * reshaped rails return at least one result. Surfaces the single top-ranked
 * product across all rails with a grounded, fresh Emma-voice line built from
 * that product's own mood/audience/matters tags (never a lived-experience
 * claim), an inline "I'll take it ♥" add-to-cart button, and a quiet "Take a
 * peek" link through to the PDP.
 *
 * Add-to-cart reuses the exact useFetcher → POST /api/cart, intent=add-item
 * pattern the PDP uses (app/routes/_layout.products.$slug.tsx), and dispatches
 * the same xdipx:cart-added CustomEvent on success so the CartDrawer opens.
 *
 * Add-to-cart requires product.defaultVariantId (a true ProductVariant GID,
 * indexed since discovery index v7). Pre-v7 cached entries carry null there;
 * the card then renders the PDP link as the only CTA instead of firing a
 * cartLinesAdd that Shopify would reject.
 */

import { useEffect, useRef } from 'react'
import { Link, useFetcher } from 'react-router'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import { Reveal } from '~/components/motion/Reveal'
import { trackAddToCart, trackSelectItem } from '~/lib/analytics.client'
import type { DiscoveryProduct, DiscoveryState } from '~/types/discovery'

interface FitCardProps {
  product: DiscoveryProduct
  state: DiscoveryState
}

/**
 * Fresh, product-grounded Emma line. Pulls from whichever of the product's
 * own mood/audience/matters tags overlap the shopper's current brief, so the
 * copy differs card to card instead of repeating a fixed template verbatim.
 * No lived-experience claims ("known for", "built for") — no em-dashes.
 */
function fitLine(product: DiscoveryProduct, state: DiscoveryState): string {
  const mood = product.mood.find(m => state.mood.includes(m)) ?? product.mood[0]
  const audience = product.audience.find(a => state.audience.includes(a)) ?? product.audience[0]
  const matter = product.matters.find(k => state.matters.includes(k)) ?? product.matters[0]

  const parts: string[] = []
  if (mood) parts.push(mood.toLowerCase())
  if (matter) parts.push(matter.toLowerCase())

  if (mood && audience) {
    return `Known for ${mood.toLowerCase()} nights, built with ${audience.toLowerCase()} in mind.`
  }
  if (parts.length === 2) {
    return `Reads ${parts[0]}, and ${parts[1]}.`
  }
  if (mood) {
    return `Reads ${mood.toLowerCase()}, top of the shelf for this brief.`
  }
  if (matter) {
    return `${matter} and top of the shelf for this brief.`
  }
  return 'Top of the shelf for this brief.'
}

export function FitCard({ product, state }: FitCardProps) {
  const fetcher = useFetcher<{ ok?: boolean; addToCartEventId?: string }>()
  const isPending = fetcher.state !== 'idle'
  const wasSubmitting = useRef(false)

  useEffect(() => {
    if (fetcher.state === 'submitting') {
      wasSubmitting.current = true
    } else if (fetcher.state === 'idle' && wasSubmitting.current) {
      wasSubmitting.current = false
      if (fetcher.data?.ok) {
        window.dispatchEvent(new CustomEvent('xdipx:cart-added'))
        trackAddToCart({
          item_id: product.id,
          item_name: product.title,
          item_category: product.category,
          price: product.price,
        }, product.price)
      }
    }
  }, [fetcher.state, fetcher.data, product])

  function handlePeekClick() {
    trackSelectItem('discovery_fit_card', "Emma's fit", {
      item_id: product.id,
      item_name: product.title,
      item_category: product.category,
      price: product.price,
      item_list_id: 'discovery_fit_card',
      item_list_name: "Emma's fit",
    }, 0)
  }

  return (
    <Reveal variant="up" className="mb-10 md:mb-14">
      <div className="rounded-[var(--radius-lg)] border border-line-2 bg-paper-2 p-4 sm:p-5 md:p-7 flex flex-col sm:flex-row gap-5 sm:gap-7 items-stretch">
        {/* Image — aspect-ratio reserved so there is zero CLS. */}
        <Link
          to={`/products/${product.handle}`}
          onClick={handlePeekClick}
          className="block flex-none w-full sm:w-40 md:w-48 aspect-[4/5] rounded-[var(--radius)] overflow-hidden bg-paper-3"
          aria-label={product.title}
        >
          {product.imageUrl ? (
            <OptimizedImage
              src={product.imageUrl}
              alt={product.imageAlt ?? product.title}
              className="w-full h-full object-cover"
              sizes="(min-width: 768px) 20vw, 90vw"
              widths={[240, 360, 480]}
              fallbackWidth={480}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-3xl text-sage/50 select-none" aria-hidden="true">♥</span>
            </div>
          )}
        </Link>

        <div className="min-w-0 flex-1 flex flex-col justify-center gap-2.5">
          <p
            className="text-[10px] uppercase tracking-[0.18em] text-coral font-medium"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            Emma's fit
          </p>
          <h3
            className="text-xl md:text-2xl text-ink leading-tight tracking-[-0.02em]"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}
          >
            {product.title}
          </h3>
          <p
            className="text-[15px] text-ink-2 leading-relaxed"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            {fitLine(product, state)}
          </p>
          <p
            className="text-base font-semibold text-coral"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {product.priceMax != null && product.priceMax > product.price
              ? `$${product.price.toFixed(2)}–$${product.priceMax.toFixed(2)}`
              : `$${product.price.toFixed(2)}`}
          </p>

          <div className="flex items-center gap-4 flex-wrap mt-1">
            {product.defaultVariantId ? (
              <>
                <fetcher.Form method="post" action="/api/cart" className="flex-none">
                  <input type="hidden" name="intent" value="add-item" />
                  <input type="hidden" name="variantId" value={product.defaultVariantId} />
                  <input type="hidden" name="productId" value={product.id} />
                  <input type="hidden" name="price" value={String(product.price)} />
                  <button
                    type="submit"
                    disabled={isPending}
                    className="inline-flex items-center justify-center px-6 py-3 rounded-full bg-coral text-white font-bold text-[15px] transition-all hover:opacity-90 disabled:opacity-60 disabled:cursor-wait"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {isPending ? 'Adding…' : 'I\'ll take it ♥'}
                  </button>
                </fetcher.Form>
                <Link
                  to={`/products/${product.handle}`}
                  onClick={handlePeekClick}
                  className="text-[14px] text-ink link-coral hover:text-plum-2"
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  Take a peek →
                </Link>
              </>
            ) : (
              <Link
                to={`/products/${product.handle}`}
                onClick={handlePeekClick}
                className="inline-flex items-center justify-center px-6 py-3 rounded-full bg-coral text-white font-bold text-[15px] transition-all hover:opacity-90"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Take a peek →
              </Link>
            )}
          </div>
        </div>
      </div>
    </Reveal>
  )
}
