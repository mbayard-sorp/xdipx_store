import type { RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link, useFetcher } from 'react-router'
import { motion } from 'motion/react'
import type { Cart, CartLine, Product } from '~/types'
import { trackViewCart, trackRemoveFromCart, trackBeginCheckout, type GA4Item } from '~/lib/analytics.client'

const FREE_SHIPPING_THRESHOLD = 99

interface CartDrawerProps {
  cart: Cart | null
  upsells?: Product[]
  panelRef?: RefObject<HTMLDivElement | null>
  onClose: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

function cartLinesToGA4(lines: CartLine[]): GA4Item[] {
  return lines.map((line, i) => {
    const variantTitle = line.merchandise.title === 'Default Title' ? null : line.merchandise.title
    return {
      item_id: line.merchandise.product.id ?? line.id,
      item_name: line.merchandise.product.title,
      ...(variantTitle ? { item_variant: variantTitle } : {}),
      price: parseFloat(line.merchandise.price.amount),
      quantity: line.quantity,
      index: i,
    }
  })
}

export function CartDrawer({ cart, upsells = [], panelRef, onClose, onMouseEnter, onMouseLeave }: CartDrawerProps) {
  const subtotal  = cart ? parseFloat(cart.cost.subtotalAmount.amount) : 0
  const remaining = Math.max(FREE_SHIPPING_THRESHOLD - subtotal, 0)
  const progress  = Math.min((subtotal / FREE_SHIPPING_THRESHOLD) * 100, 100)

  // ── GA4: view_cart on drawer open ─────────────────────────────────────
  useEffect(() => {
    if (cart && cart.lines.length > 0) {
      trackViewCart(cartLinesToGA4(cart.lines), subtotal)
    }
  }, []) // fire once on mount (drawer open)

  return (
    <>
      {/* Drawer panel */}
      <motion.div
        id="cart-drawer"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Your cart"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.25 }}
        className="fixed top-0 right-0 bottom-0 z-[60] w-80 sm:w-96 bg-brand-cream shadow-2xl flex flex-col"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-mist shrink-0">
          <h2
            className="text-base font-bold text-brand-charcoal"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Your Cart
            {cart && cart.totalQuantity > 0 && (
              <span className="ml-2 text-sm font-normal text-brand-charcoal/70">
                ({cart.totalQuantity})
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-brand-mist transition-colors text-brand-charcoal/70 hover:text-brand-charcoal"
            aria-label="Close cart"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        {/* Free shipping bar */}
        <div className="px-5 py-3 border-b border-brand-mist bg-white shrink-0">
          {remaining > 0 ? (
            <p className="text-xs text-brand-charcoal/70 mb-2">
              You're only{' '}
              <span className="text-brand-coral font-semibold">${remaining.toFixed(2)}</span>
              {' '}away from{' '}
              <span className="font-semibold text-brand-charcoal">FREE SHIPPING</span>
            </p>
          ) : (
            <p className="text-xs font-semibold text-green-600 mb-2 flex items-center gap-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              You've unlocked free shipping!
            </p>
          )}
          <div className="relative h-2.5 rounded-full bg-brand-mist overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
              style={{
                width: `${progress}%`,
                background: 'repeating-linear-gradient(45deg, #F04E37, #F04E37 6px, #FF8C38 6px, #FF8C38 12px)',
              }}
            />
          </div>
          <div className="flex justify-end mt-1">
            <span className="text-xs text-brand-charcoal/70 flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1 3h15v13H1z" /><path d="M16 8h4l3 3v5h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
              $99 Free Shipping
            </span>
          </div>
        </div>

        {/* Line items + upsells */}
        <div className="flex-1 overflow-y-auto">
          {!cart || cart.lines.length === 0 ? (
            <EmptyCart onClose={onClose} upsells={upsells} />
          ) : (
            <>
              <ul className="divide-y divide-brand-mist">
                {cart.lines.map(line => (
                  <CartLineItem key={line.id} line={line} />
                ))}
              </ul>
              <CartUpsells cart={cart} upsells={upsells} />
            </>
          )}
        </div>

        {/* Footer */}
        {cart && cart.lines.length > 0 && (
          <div className="border-t border-brand-mist px-5 py-4 space-y-3 bg-white shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-brand-charcoal" style={{ fontFamily: 'var(--font-display)' }}>
                Subtotal
              </span>
              <span className="text-sm font-bold text-brand-charcoal">
                ${subtotal.toFixed(2)}
              </span>
            </div>
            <p className="text-xs text-brand-charcoal/70 -mt-1">
              Taxes and shipping calculated at checkout
            </p>
            <a
              href={cart.checkoutUrl}
              onClick={() => trackBeginCheckout(cartLinesToGA4(cart.lines), subtotal)}
              className="flex items-center justify-center gap-2 w-full py-4 rounded-xl text-white text-base font-bold tracking-wide transition-all hover:opacity-90 hover:shadow-lg hover:shadow-brand-coral/20"
              style={{
                background: 'linear-gradient(to right, #F04E37, #FF8C38)',
                fontFamily: 'var(--font-display)',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              CHECKOUT ♥
            </a>
            <button
              onClick={onClose}
              className="w-full text-center text-xs text-brand-charcoal/70 hover:text-brand-charcoal transition-colors py-3"
            >
              Continue Shopping
            </button>
          </div>
        )}
      </motion.div>
    </>
  )
}

function CartLineItem({ line }: { line: CartLine }) {
  const removeFetcher  = useFetcher()
  const updateFetcher  = useFetcher()
  const wasRemoving    = useRef(false)
  const wasUpdating    = useRef(false)

  const isRemoving  = removeFetcher.state !== 'idle'
  const isUpdating  = updateFetcher.state !== 'idle'
  const price       = parseFloat(line.merchandise.price.amount)
  const image       = line.merchandise.product.images[0]
  const variantTitle = line.merchandise.title === 'Default Title' ? null : line.merchandise.title

  // GA4: remove_from_cart on success + notify Navbar to refetch cart
  useEffect(() => {
    if (removeFetcher.state === 'submitting') {
      wasRemoving.current = true
    } else if (removeFetcher.state === 'idle' && wasRemoving.current) {
      wasRemoving.current = false
      trackRemoveFromCart({
        item_id: line.merchandise.product.id ?? line.id,
        item_name: line.merchandise.product.title,
        ...(variantTitle ? { item_variant: variantTitle } : {}),
        price,
        quantity: line.quantity,
      })
      window.dispatchEvent(new CustomEvent('xdipx:cart-updated'))
    }
  }, [removeFetcher.state])

  // Notify Navbar to refetch cart after quantity update
  useEffect(() => {
    if (updateFetcher.state === 'submitting') {
      wasUpdating.current = true
    } else if (updateFetcher.state === 'idle' && wasUpdating.current) {
      wasUpdating.current = false
      window.dispatchEvent(new CustomEvent('xdipx:cart-updated'))
    }
  }, [updateFetcher.state])

  const changeQty = (delta: number) => {
    const newQty = line.quantity + delta
    updateFetcher.submit(
      { intent: 'update-quantity', lineId: line.id, quantity: String(newQty) },
      { method: 'post', action: '/api/cart' },
    )
  }

  return (
    <li className={`flex gap-3 px-5 py-4 transition-opacity ${isRemoving ? 'opacity-40' : ''}`}>
      {/* Thumbnail */}
      <div className="w-16 h-16 rounded-lg overflow-hidden bg-brand-mist shrink-0">
        {image ? (
          <img
            src={image.url}
            alt={image.altText || line.merchandise.product.title}
            width={64}
            height={64}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-brand-charcoal/20">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
          </div>
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <p className="text-sm font-medium text-brand-charcoal leading-tight line-clamp-2">
          {line.merchandise.product.title}
        </p>
        {variantTitle && (
          <p className="text-xs text-brand-charcoal/70">{variantTitle}</p>
        )}
        {line.sellingPlanAllocation && (
          <p className="text-xs text-brand-purple font-medium flex items-center gap-1">
            <RepeatIcon /> {line.sellingPlanAllocation.sellingPlan.name}
          </p>
        )}
        <p className="text-sm font-semibold text-brand-coral">
          ${(price * line.quantity).toFixed(2)}
        </p>

        {/* Qty stepper + remove */}
        <div className="flex items-center gap-3 mt-1">
          <div className="flex items-center border border-brand-mist rounded-lg overflow-hidden" role="group" aria-label={`Quantity for ${line.merchandise.product.title}`}>
            <button
              onClick={() => changeQty(-1)}
              disabled={isUpdating}
              className="w-11 h-11 flex items-center justify-center text-brand-charcoal/60 hover:bg-brand-mist transition-colors disabled:opacity-40 text-sm font-bold"
              aria-label="Decrease quantity"
            >
              −
            </button>
            <span
              className="w-6 text-center text-sm font-semibold text-brand-charcoal select-none"
              role="status"
              aria-live="polite"
              aria-label={`Quantity: ${line.quantity}`}
            >
              {isUpdating ? '…' : line.quantity}
            </span>
            <button
              onClick={() => changeQty(1)}
              disabled={isUpdating}
              className="w-11 h-11 flex items-center justify-center text-brand-charcoal/60 hover:bg-brand-mist transition-colors disabled:opacity-40 text-sm font-bold"
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>

          {/* Remove */}
          <removeFetcher.Form method="post" action="/api/cart">
            <input type="hidden" name="intent"  value="remove-item" />
            <input type="hidden" name="lineId"  value={line.id} />
            <button
              type="submit"
              disabled={isRemoving}
              className="w-11 h-11 flex items-center justify-center rounded-lg text-brand-charcoal/30 hover:text-red-400 hover:bg-brand-mist transition-colors disabled:opacity-40"
              aria-label="Remove item"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </button>
          </removeFetcher.Form>
        </div>
      </div>
    </li>
  )
}

function EmptyCart({ onClose, upsells = [] }: { onClose: () => void; upsells?: Product[] }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-4">
      <div className="w-16 h-16 rounded-full bg-brand-mist flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand-charcoal/30" aria-hidden="true">
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
      </div>
      <div>
        <p className="text-base font-semibold text-brand-charcoal" style={{ fontFamily: 'var(--font-display)' }}>
          Your cart is empty ♥
        </p>
        <p className="text-sm text-brand-charcoal/70 mt-1">
          Today's deal is waiting for you
        </p>
      </div>
      <Link
        to="/"
        onClick={onClose}
        className="mt-2 px-6 py-2.5 rounded-full text-sm font-semibold text-white transition-opacity hover:opacity-90"
        style={{
          background: 'linear-gradient(to right, #F04E37, #FF8C38)',
          fontFamily: 'var(--font-display)',
        }}
      >
        Shop Today's Deal ♥
      </Link>
      {upsells.filter(p => p.variants[0]?.availableForSale).length > 0 && (
        <div className="w-full mt-6 pt-4 border-t border-brand-mist">
          <p
            className="text-xs font-semibold text-brand-charcoal/70 uppercase tracking-wider mb-3"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Popular picks
          </p>
          <div className="space-y-2">
            {upsells.filter(p => p.variants[0]?.availableForSale).slice(0, 3).map(product => (
              <CartUpsellItem key={product.id} product={product} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RepeatIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  )
}

// ─── Upsells ─────────────────────────────────────────────────────────────

function CartUpsells({ upsells }: { cart: Cart; upsells: Product[] }) {
  const available = upsells.filter(p => p.variants[0]?.availableForSale)
  if (available.length === 0) return null

  return (
    <div className="border-t border-brand-mist px-5 py-3">
      <p
        className="text-xs font-semibold text-brand-charcoal/70 uppercase tracking-wider mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        You might also like
      </p>
      <div className="space-y-2">
        {available.map(product => (
          <CartUpsellItem key={product.id} product={product} />
        ))}
      </div>
    </div>
  )
}

function CartUpsellItem({ product }: { product: Product }) {
  const fetcher       = useFetcher()
  const wasSubmitting = useRef(false)
  const [added, setAdded] = useState(false)
  const [failed, setFailed] = useState(false)
  const isPending = fetcher.state !== 'idle'

  useEffect(() => {
    if (fetcher.state === 'submitting') {
      wasSubmitting.current = true
    } else if (fetcher.state === 'idle' && wasSubmitting.current) {
      wasSubmitting.current = false
      const data = fetcher.data as { ok?: boolean } | undefined
      if (data?.ok) {
        setAdded(true)
        setFailed(false)
        window.dispatchEvent(new CustomEvent('xdipx:cart-added'))
      } else if (data && !data.ok) {
        setFailed(true)
      }
    }
  }, [fetcher.state, fetcher.data])

  const variant  = product.variants[0]
  const image    = product.images[0]
  const compare  = product.compareAtPrice
  const onSale   = compare != null && compare > product.price
  const discount = onSale ? Math.round(((compare - product.price) / compare) * 100) : 0

  return (
    <div className="flex items-center gap-3">
      <Link to={`/products/${product.handle}`} className="flex items-center gap-3 flex-1 min-w-0 group">
        {/* Thumbnail */}
        <div className="w-14 h-14 rounded-lg overflow-hidden bg-brand-mist shrink-0 ring-1 ring-brand-mist group-hover:ring-brand-purple/30 transition-all">
          {image ? (
            <img
              src={image.url}
              alt={image.altText || product.title}
              width={56}
              height={56}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-brand-charcoal/20">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 21V9" />
              </svg>
            </div>
          )}
        </div>

        {/* Title + price */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-brand-charcoal leading-tight group-hover:text-brand-coral transition-colors">
            {product.title}
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-bold text-brand-coral">${product.price.toFixed(2)}</span>
            {onSale && (
              <>
                <span className="text-xs text-brand-charcoal/70 line-through">${compare.toFixed(2)}</span>
                <span className="bg-brand-gradient text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                  {discount}% off
                </span>
              </>
            )}
          </div>
        </div>
      </Link>

      {/* Add button */}
      <fetcher.Form method="post" action="/api/cart">
        <input type="hidden" name="intent"    value="add-item" />
        <input type="hidden" name="variantId" value={variant?.id ?? ''} />
        <button
          type="submit"
          disabled={isPending || added || !variant?.availableForSale}
          onClick={() => setFailed(false)}
          className={[
            'shrink-0 text-xs font-bold px-3.5 py-2.5 rounded-full transition-all',
            added
              ? 'bg-brand-mist text-brand-purple'
              : failed
                ? 'bg-red-100 text-red-500'
                : 'bg-brand-gradient text-white hover:opacity-90 disabled:opacity-50',
          ].join(' ')}
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {added ? 'Added ♥' : isPending ? '...' : failed ? 'Retry' : '+ Add'}
        </button>
      </fetcher.Form>
    </div>
  )
}
