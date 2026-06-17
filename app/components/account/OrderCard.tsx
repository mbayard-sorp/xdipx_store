import type { ReactElement } from 'react'
import { Link } from 'react-router'
import type { StorefrontOrder } from '~/lib/shopify.server'
import { StatusPill } from './StatusPill'

interface OrderCardProps {
  order: StorefrontOrder
}

/**
 * Canonical order card used in the orders list (and reusable on the
 * dashboard). Intentionally NOT wrapped in a single <Link> because it
 * contains separately-clickable actions (Track, Reorder). The header
 * row is its own Link so users can tap the order number/date to open
 * the detail view.
 *
 * Reorder note: this storefront is an editorially curated shop with a
 * rotating catalog. The products on historical orders may no longer be
 * live in Shopify, and `StorefrontOrder.lineItems` does not expose a
 * `variantId`. So the "Reorder ♥" button here is a Link that takes the
 * customer to the current featured pick rather than a true re-add-to-cart.
 * See `reorder flow context` in the phase 3 spec.
 */
export function OrderCard({ order }: OrderCardProps): ReactElement {
  const date = new Date(order.processedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })

  const { id, orderNumber, financialStatus, fulfillmentStatus, totalPrice, lineItems } = order
  const detailHref = `/account/orders/${encodeURIComponent(id)}`
  const headingId = `order-card-${id}`

  // Up to 2 thumbs, plus an "+N more" chip when there are extras.
  const thumbs = lineItems.slice(0, 2)
  const extra = lineItems.length > 2 ? lineItems.length - 2 : 0

  const total = parseFloat(totalPrice.amount)
  const totalLabel = Number.isFinite(total) ? `$${total.toFixed(2)}` : totalPrice.amount

  return (
    <article
      aria-labelledby={headingId}
      className="border border-cream-2 rounded-2xl p-4 space-y-3 bg-white"
    >
      {/* Header row — clickable title + date */}
      <Link
        to={detailHref}
        className="flex items-start justify-between gap-3 -m-1 p-1 rounded-xl hover:bg-cream-2/40 transition-colors"
      >
        <p
          id={headingId}
          className="text-sm font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Order #{orderNumber}
        </p>
        <p className="text-xs text-ink/50 shrink-0">{date}</p>
      </Link>

      {/* Thumbs row */}
      {thumbs.length > 0 && (
        <div className="flex items-center gap-2">
          {thumbs.map((li, i) => (
            <LineThumb key={`${li.title}-${i}`} src={li.imageUrl} alt={li.title} />
          ))}
          {extra > 0 && (
            <span className="text-[11px] font-semibold text-ink/60 bg-cream-2 rounded-full px-2.5 py-1">
              +{extra} more
            </span>
          )}
        </div>
      )}

      {/* Status row */}
      <div className="flex gap-1.5 flex-wrap">
        <StatusPill value={financialStatus} kind="financial" />
        <StatusPill value={fulfillmentStatus} kind="fulfillment" />
      </div>

      {/* Bottom row — total + actions */}
      <div className="flex items-center justify-between gap-3 pt-3 border-t border-cream-2">
        <p className="text-sm font-bold text-ink tabular-nums">
          {totalLabel}{' '}
          <span className="text-[11px] font-normal text-ink/40">
            {totalPrice.currencyCode}
          </span>
        </p>
        <div className="flex items-center gap-2">
          <Link
            to={detailHref}
            className="text-xs font-semibold text-sage hover:text-sun transition-colors px-3 py-2 rounded-full"
            aria-label={`Track order ${orderNumber}`}
          >
            Track &rarr;
          </Link>
          <Link
            to="/"
            className="text-xs font-semibold text-white bg-coral hover:opacity-90 transition-opacity px-3.5 py-2 rounded-full"
            style={{ fontFamily: 'var(--font-display)' }}
            aria-label={`Reorder from order ${orderNumber}`}
            // TODO phase 3.1: once StorefrontOrder.lineItems exposes
            // variantId (or a matching product handle) and the order
            // products are still live in Shopify, convert this to a
            // useFetcher form posting { intent: 'add-item', variantId,
            // quantity } to /api/cart and dispatching `xdipx:cart-added`
            // on success (see DailyDealHero.tsx for the reference
            // pattern). Today's data shape doesn't allow it.
          >
            Reorder <span aria-hidden="true">♥</span>
          </Link>
        </div>
      </div>
    </article>
  )
}

function LineThumb({ src, alt }: { src: string | null; alt: string }): ReactElement {
  if (!src) {
    return (
      <div
        className="w-9 h-9 rounded-xl bg-cream-2 shrink-0"
        aria-hidden="true"
      />
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="w-9 h-9 rounded-xl object-cover shrink-0 border border-cream-2"
    />
  )
}
