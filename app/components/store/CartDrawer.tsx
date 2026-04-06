import type { RefObject } from 'react'
import { Link, useFetcher } from 'react-router'
import { motion } from 'motion/react'
import type { Cart, CartLine } from '~/types'

const FREE_SHIPPING_THRESHOLD = 99

interface CartDrawerProps {
  cart: Cart | null
  panelRef?: RefObject<HTMLDivElement | null>
  onClose: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

export function CartDrawer({ cart, panelRef, onClose, onMouseEnter, onMouseLeave }: CartDrawerProps) {
  const subtotal  = cart ? parseFloat(cart.cost.subtotalAmount.amount) : 0
  const remaining = Math.max(FREE_SHIPPING_THRESHOLD - subtotal, 0)
  const progress  = Math.min((subtotal / FREE_SHIPPING_THRESHOLD) * 100, 100)

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
              <span className="ml-2 text-sm font-normal text-brand-charcoal/50">
                ({cart.totalQuantity})
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-brand-mist transition-colors text-brand-charcoal/50 hover:text-brand-charcoal"
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
            <p className="text-xs font-semibold text-green-600 mb-2">
              🎉 You've unlocked free shipping!
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
            <span className="text-[10px] text-brand-charcoal/40">🚚 $99 Free Shipping</span>
          </div>
        </div>

        {/* Line items */}
        <div className="flex-1 overflow-y-auto">
          {!cart || cart.lines.length === 0 ? (
            <EmptyCart onClose={onClose} />
          ) : (
            <ul className="divide-y divide-brand-mist">
              {cart.lines.map(line => (
                <CartLineItem key={line.id} line={line} />
              ))}
            </ul>
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
            <p className="text-[11px] text-brand-charcoal/40 -mt-1">
              Taxes and shipping calculated at checkout
            </p>
            <a
              href={cart.checkoutUrl}
              className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl text-white text-sm font-bold tracking-wide transition-opacity hover:opacity-90"
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
              className="w-full text-center text-xs text-brand-charcoal/50 hover:text-brand-charcoal transition-colors py-1"
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

  const isRemoving  = removeFetcher.state !== 'idle'
  const isUpdating  = updateFetcher.state !== 'idle'
  const price       = parseFloat(line.merchandise.price.amount)
  const image       = line.merchandise.product.images[0]
  const variantTitle = line.merchandise.title === 'Default Title' ? null : line.merchandise.title

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
          <p className="text-xs text-brand-charcoal/50">{variantTitle}</p>
        )}
        <p className="text-sm font-semibold text-brand-coral">
          ${(price * line.quantity).toFixed(2)}
        </p>

        {/* Qty stepper + remove */}
        <div className="flex items-center gap-3 mt-1">
          <div className="flex items-center border border-brand-mist rounded-lg overflow-hidden">
            <button
              onClick={() => changeQty(-1)}
              disabled={isUpdating}
              className="w-7 h-7 flex items-center justify-center text-brand-charcoal/60 hover:bg-brand-mist transition-colors disabled:opacity-40 text-sm font-bold"
              aria-label="Decrease quantity"
            >
              −
            </button>
            <span className="w-6 text-center text-sm font-semibold text-brand-charcoal select-none">
              {isUpdating ? '…' : line.quantity}
            </span>
            <button
              onClick={() => changeQty(1)}
              disabled={isUpdating}
              className="w-7 h-7 flex items-center justify-center text-brand-charcoal/60 hover:bg-brand-mist transition-colors disabled:opacity-40 text-sm font-bold"
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
              className="w-7 h-7 flex items-center justify-center rounded-lg text-brand-charcoal/30 hover:text-red-400 hover:bg-brand-mist transition-colors disabled:opacity-40"
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

function EmptyCart({ onClose }: { onClose: () => void }) {
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
        <p className="text-sm text-brand-charcoal/50 mt-1">
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
    </div>
  )
}
