/**
 * Product card for merchandised category/drop shelves. Consumes the
 * pre-resolved `CategoryCardProduct` shape (~/types/cms). Everything here is
 * a plain value, no client-side fetch. Dial rows only render when the
 * product actually carries dial data (dial honesty, category-page.server.ts).
 */

import { Link } from 'react-router'
import { OptimizedImage } from '~/components/store/OptimizedImage'
import type { CategoryCardProduct } from '~/types/cms'
import { MONO, BODY, formatPrice } from './consts'
import { mapAllowsDiscountDisplay } from '~/lib/discount-badge'

const DIAL_NOTCHES = 5

function DialRow({ label, value }: { label: string; value: number }) {
  const filled = Math.max(0, Math.min(DIAL_NOTCHES, Math.round(value)))
  return (
    <div className="flex items-center justify-between gap-2 text-[11px] text-ink-4" style={MONO}>
      <span className="truncate">{label}</span>
      <span className="flex shrink-0 gap-[3px]" aria-hidden="true">
        {Array.from({ length: DIAL_NOTCHES }, (_, i) => (
          <span
            key={i}
            className={`h-[6px] w-[6px] rounded-full ${i < filled ? 'bg-sage' : 'bg-line-2'}`}
          />
        ))}
      </span>
    </div>
  )
}

export function CategoryProductCard({
  product,
  priority = false,
  onSelect,
}: {
  product: CategoryCardProduct
  priority?: boolean
  onSelect?: () => void
}) {
  // Struck price is advertised-discount framing, gated on the MAP rule so a
  // MAP-locked product (map == compare-at) shows none (ticket #3675).
  const onSale =
    product.compareAtPrice != null &&
    product.compareAtPrice > product.price &&
    mapAllowsDiscountDisplay(product.mapPrice, product.compareAtPrice)

  return (
    <Link
      to={`/products/${product.handle}`}
      className="group block"
      aria-label={product.title}
      onClick={onSelect}
    >
      <div className="relative aspect-square overflow-hidden rounded-xl border border-line bg-paper-2">
        {product.imageUrl ? (
          <OptimizedImage
            src={product.imageUrl}
            alt={product.imageAlt ?? product.title}
            priority={priority}
            sizes="(max-width: 640px) 45vw, 240px"
            widths={[240, 360, 480, 640]}
            fallbackWidth={480}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-4xl text-sage">♥</div>
        )}
      </div>

      <div className="mt-3">
        {product.brand && (
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>
            {product.brand}
          </p>
        )}
        <h3 className="mt-1 line-clamp-2 text-[15px] leading-snug text-ink" style={BODY}>
          {product.title}
        </h3>
        <p className="mt-1.5 flex items-baseline gap-2" style={BODY}>
          <span className="text-[15px] font-semibold text-ink">{formatPrice(product.price)}</span>
          {onSale && (
            <span className="text-[13px] text-ink-4 line-through">
              {formatPrice(product.compareAtPrice!)}
            </span>
          )}
        </p>
        {product.dial.length > 0 && (
          <div className="mt-2.5 flex flex-col gap-1">
            {product.dial.slice(0, 3).map(d => (
              <DialRow key={d.label} label={d.label} value={d.value} />
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}
