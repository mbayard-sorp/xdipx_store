/**
 * Product card for the new storefront homepage rails (variant 'b').
 *
 * Consumes the lean `DiscoveryProduct` shape (from the discovery index) so the
 * storefront can reuse the already-scored "best of" product sets without a
 * second Shopify fan-out. Self-contained + SSR-safe — links to the canonical
 * `/products/{handle}` PDP. Matches the v3 brand tokens.
 */

import { Link } from 'react-router'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import { showDiscountBadge } from '~/lib/discount-badge'
import type { DiscoveryProduct } from '~/types/discovery'

function fmt(n: number): string {
  return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`
}

interface StorefrontProductCardProps {
  product: DiscoveryProduct
  /** Eager-load the first row of the first rail for a better LCP. */
  priority?: boolean
  /** Fired on click, before navigation — used for GA4 select_item attribution. */
  onSelect?: () => void
  /** Fill the parent column (grid layouts) instead of the fixed rail width. */
  fluid?: boolean
}

export function StorefrontProductCard({ product, priority = false, onSelect, fluid = false }: StorefrontProductCardProps) {
  const onSale = product.compareAtPrice != null && product.compareAtPrice > product.price
  const savePct = onSale
    ? Math.round(((product.compareAtPrice! - product.price) / product.compareAtPrice!) * 100)
    : 0
  const priceRange = product.priceMax != null && product.priceMax > product.price

  return (
    <Link
      to={`/products/${product.handle}`}
      className={`group block ${fluid ? 'w-full' : 'w-[220px] shrink-0 sm:w-auto sm:shrink'}`}
      aria-label={product.title}
      onClick={onSelect}
    >
      <div className="relative aspect-square overflow-hidden rounded-[var(--radius-lg)] bg-paper-2 border border-line">
        {product.imageUrl ? (
          <OptimizedImage
            src={product.imageUrl}
            alt={product.imageAlt ?? product.title}
            priority={priority}
            sizes="(max-width: 640px) 45vw, 240px"
            widths={[240, 360, 480, 640]}
            fallbackWidth={480}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-[var(--duration-slow)] ease-[var(--ease-standard)] group-hover:scale-[1.04]"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-sage text-4xl">♥</div>
        )}
        {/* Ink, not coral: the doctrine's coral budget reserves coral for the
            one primary CTA per viewport, and a grid of coral % badges reads
            as a discount wall (design-critic BLOCK finding, 2026-07-20).
            Floor at MIN_DISCOUNT_BADGE_PCT so a "1% off" badge never sits beside
            real markdowns (ticket #467); the struck price below still shows. */}
        {onSale && showDiscountBadge(savePct) && (
          <span
            className="absolute left-3 top-3 rounded-full bg-ink px-2.5 py-1 text-[11px] font-semibold text-paper"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            {savePct}% off
          </span>
        )}
      </div>

      <div className="mt-3">
        {/* Brand eyebrow: a recognizable vendor name reads as a legitimacy
            signal on a shame-adjacent category. Falls back to subcategory /
            category when the product has no vendor so the eyebrow is never
            empty. Mono ink-4, the doctrine's kicker treatment. */}
        <p
          className="text-[13px] uppercase tracking-[0.12em] text-ink-4"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {product.brand || product.subcategory || product.category}
        </p>
        <h3
          className="mt-1 line-clamp-2 text-[15px] leading-snug text-ink group-hover:text-plum transition-colors"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
        >
          {product.title}
        </h3>
        <p className="mt-1.5 flex items-baseline gap-2" style={{ fontFamily: 'var(--font-body)' }}>
          <span className="text-[15px] font-semibold text-ink">
            {priceRange ? `${fmt(product.price)}+` : fmt(product.price)}
          </span>
          {onSale && (
            <span className="text-[13px] text-ink-4 line-through">{fmt(product.compareAtPrice!)}</span>
          )}
        </p>
      </div>
    </Link>
  )
}
