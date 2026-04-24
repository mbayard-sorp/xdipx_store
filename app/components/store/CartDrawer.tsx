import type { RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link, useFetcher } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import type { Cart, CartLine, EmmaCartContext, Product } from '~/types'
import type { EmmaPersona } from '~/types/cms'
import { trackViewCart, trackRemoveFromCart, trackBeginCheckout, type GA4Item } from '~/lib/analytics.client'

const FREE_SHIPPING_THRESHOLD = 99

interface CartDrawerProps {
  cart: Cart | null
  emma?: EmmaCartContext | null
  upsells?: Product[]
  emmaPersona?: EmmaPersona | null
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

export function CartDrawer({ cart, emma = null, upsells = [], emmaPersona = null, panelRef, onClose, onMouseEnter, onMouseLeave }: CartDrawerProps) {
  const subtotal  = cart ? parseFloat(cart.cost.subtotalAmount.amount) : 0
  const remaining = emma?.freeShip.remaining ?? Math.max(FREE_SHIPPING_THRESHOLD - subtotal, 0)
  const progress  = emma?.freeShip.progress  ?? Math.min((subtotal / FREE_SHIPPING_THRESHOLD) * 100, 100)

  // AI-generated Emma aside — fetched after the drawer renders the deterministic
  // body, then fades in. Never blocks the drawer.
  const asideFetcher = useFetcher<{ body: string | null; source: string }>()
  const cartSignature = cart
    ? `${cart.totalQuantity}|${cart.cost.subtotalAmount.amount}`
    : 'empty'
  useEffect(() => {
    if (!cart || cart.lines.length === 0) return
    asideFetcher.load('/api/emma-cart')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartSignature])
  const aiBody = asideFetcher.data?.body ?? null

  useEffect(() => {
    if (cart && cart.lines.length > 0) {
      trackViewCart(cartLinesToGA4(cart.lines), subtotal)
    }
  }, []) // fire once on mount (drawer open)

  return (
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
      className="fixed top-0 right-0 bottom-0 z-[60] w-80 sm:w-96 bg-cream shadow-2xl flex flex-col"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Header — Emma voice */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-line shrink-0 bg-paper">
        <h2
          className="text-lg font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Nice pick ♥
          {cart && cart.totalQuantity > 0 && (
            <span className="ml-2 text-sm font-normal text-muted">({cart.totalQuantity})</span>
          )}
        </h2>
        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-cream-2 transition-colors text-ink/70 hover:text-ink"
          aria-label="Close cart"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M1 1l12 12M13 1L1 13" />
          </svg>
        </button>
      </div>

      {/* Emma avatar block — only when we have cart content */}
      {cart && cart.lines.length > 0 && emma && (
        <EmmaBlock emma={emma} aiBody={aiBody} persona={emmaPersona} />
      )}

      {/* Free-ship bar */}
      <div className="px-5 py-3 border-b border-line bg-paper shrink-0">
        <div
          className="relative h-1.5 rounded-full bg-cream-2 overflow-hidden"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Progress toward free shipping at $${FREE_SHIPPING_THRESHOLD}`}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-coral transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        {remaining > 0 ? (
          <p className="text-xs text-ink/75 mt-2 text-center">
            <span className="text-coral font-semibold">${remaining.toFixed(2)}</span>
            {' '}to ${FREE_SHIPPING_THRESHOLD} for free shipping
          </p>
        ) : (
          <p className="text-xs font-semibold text-sage mt-2 flex items-center justify-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            Free shipping unlocked ♥
          </p>
        )}
      </div>

      {/* Line items + Emma recommends rail */}
      <div className="flex-1 overflow-y-auto">
        {!cart || cart.lines.length === 0 ? (
          <EmptyCart onClose={onClose} upsells={upsells} />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {cart.lines.map(line => (
                <CartLineItem key={line.id} line={line} />
              ))}
            </ul>
            {upsells.length > 0 && emma && (
              <EmmaRecommends products={upsells} emma={emma} />
            )}
          </>
        )}
      </div>

      {/* Footer */}
      {cart && cart.lines.length > 0 && (
        <div className="border-t border-line px-5 py-4 space-y-3 bg-paper shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
              Subtotal
            </span>
            <span className="text-sm font-bold text-ink">
              ${subtotal.toFixed(2)}
            </span>
          </div>
          <a
            href={cart.checkoutUrl}
            onClick={() => trackBeginCheckout(cartLinesToGA4(cart.lines), subtotal)}
            className="flex items-center justify-center w-full py-4 rounded-xl bg-coral hover:bg-coral-deep transition-colors text-white text-base font-bold tracking-wide shadow-sm"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Check out ♥
          </a>
          <p className="text-[11px] text-center text-muted">
            straight to checkout · no detours
          </p>
        </div>
      )}
    </motion.div>
  )
}

// ─── Emma avatar block ──────────────────────────────────────────────────────

function EmmaBlock({
  emma,
  aiBody,
  persona,
}: {
  emma:     EmmaCartContext
  aiBody:   string | null
  persona:  EmmaPersona | null
}) {
  const body    = aiBody ?? emma.body
  const bodyKey = aiBody ? 'ai' : 'fallback'
  return (
    <div className="px-5 py-4 border-b border-line bg-cream-2/70">
      <div className="flex gap-3">
        {persona?.avatarUrl ? (
          <img
            src={persona.avatarUrl}
            alt={persona.avatarAlt || persona.displayName || 'Emma'}
            width={40}
            height={40}
            className="w-10 h-10 shrink-0 rounded-full object-cover ring-1 ring-line"
            loading="lazy"
          />
        ) : (
          <div
            className="w-10 h-10 shrink-0 rounded-full bg-coral text-white flex items-center justify-center font-bold text-sm"
            style={{ fontFamily: 'var(--font-display)' }}
            aria-hidden="true"
          >
            E
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] leading-relaxed text-ink">
            <span className="font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
              {emma.greeting}
            </span>{' '}
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={bodyKey}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                {body}
              </motion.span>
            </AnimatePresence>
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── EMMA RECOMMENDS (rail of pinned upsells) ───────────────────────────────

function upsellsIntroCopy(emma: EmmaCartContext): string {
  const { variant, freeShip } = emma
  if (freeShip.remaining > 0 && freeShip.remaining <= 25) {
    return `You're $${freeShip.remaining.toFixed(2)} from free ship — any of these tip you over ✿`
  }
  switch (variant) {
    case 'gift':               return "A few quiet add-ons that travel well in a bundle."
    case 'repeat':             return "Little things I'd slide in alongside what you've got."
    case 'first-timer':        return "A few picks I'd casually add — low commitment."
    case 'back-after-abandon': return "These pair nicely with what you've been eyeing."
    case 'free-ship-adjacent': return "Any of these round the order out nicely."
    default:                   return "A few of my quiet favorites — low-key add-ons."
  }
}

function EmmaRecommends({ products, emma }: { products: Product[]; emma: EmmaCartContext }) {
  const available = products.filter(p => p.variants[0]?.availableForSale).slice(0, 4)
  if (available.length === 0) return null
  const intro = upsellsIntroCopy(emma)

  return (
    <div className="border-t border-line px-5 pt-4 pb-5 bg-paper">
      <p
        className="text-[10px] font-bold text-coral uppercase tracking-[0.14em] mb-1"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Emma recommends →
      </p>
      <p className="text-[12px] text-muted leading-snug mb-3 italic">
        {intro}
      </p>
      <ul className="divide-y divide-line/70">
        {available.map(p => (
          <li key={p.id} className="py-3 first:pt-0 last:pb-0">
            <EmmaRecommendRow product={p} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function EmmaRecommendRow({ product }: { product: Product }) {
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

  const variant = product.variants[0]
  const image   = product.images[0]
  if (!variant) return null

  return (
    <div className="flex items-center gap-3">
      <Link to={`/products/${product.handle}`} className="flex items-center gap-3 flex-1 min-w-0 group">
        <div className="w-14 h-14 rounded-lg overflow-hidden bg-cream-2 shrink-0 ring-1 ring-line">
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
            <div className="w-full h-full flex items-center justify-center text-ink/20">♥</div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink leading-tight group-hover:text-coral transition-colors break-words">
            {product.title}
          </p>
          <p className="text-sm font-bold text-coral mt-0.5">${product.price.toFixed(2)}</p>
        </div>
      </Link>
      <fetcher.Form method="post" action="/api/cart">
        <input type="hidden" name="intent"    value="add-item" />
        <input type="hidden" name="variantId" value={variant.id} />
        <button
          type="submit"
          disabled={isPending || added}
          onClick={() => setFailed(false)}
          className={[
            'shrink-0 text-xs font-bold px-3.5 py-2.5 rounded-full transition-all',
            added
              ? 'bg-sage/20 text-sage'
              : failed
                ? 'bg-red-100 text-red-500'
                : 'bg-coral text-white hover:bg-coral-deep disabled:opacity-50',
          ].join(' ')}
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {added ? 'Added ♥' : isPending ? '…' : failed ? 'Retry' : '+ add'}
        </button>
      </fetcher.Form>
    </div>
  )
}

// ─── Line item ──────────────────────────────────────────────────────────────

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
      <div className="w-16 h-16 rounded-lg overflow-hidden bg-cream-2 shrink-0">
        {image ? (
          <img
            src={image.url}
            alt={image.altText || line.merchandise.product.title}
            width={64}
            height={64}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ink/20">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <p className="text-sm font-medium text-ink leading-tight line-clamp-2">
          {line.merchandise.product.title}
        </p>
        {variantTitle && (
          <p className="text-xs text-muted">{variantTitle}</p>
        )}
        {line.sellingPlanAllocation && (
          <p className="text-xs text-sage font-medium flex items-center gap-1">
            <RepeatIcon /> {line.sellingPlanAllocation.sellingPlan.name}
            {line.sellingPlanAllocation.discountPct
              ? ` · save ${line.sellingPlanAllocation.discountPct}%`
              : ''}
          </p>
        )}
        <p className="text-sm font-semibold text-coral">
          ${(price * line.quantity).toFixed(2)}
        </p>

        <div className="flex items-center gap-3 mt-1">
          <div className="flex items-center border border-line rounded-lg overflow-hidden" role="group" aria-label={`Quantity for ${line.merchandise.product.title}`}>
            <button
              onClick={() => changeQty(-1)}
              disabled={isUpdating}
              className="w-10 h-9 flex items-center justify-center text-ink/60 hover:bg-cream-2 transition-colors disabled:opacity-40 text-sm font-bold"
              aria-label="Decrease quantity"
            >
              −
            </button>
            <span
              className="w-6 text-center text-sm font-semibold text-ink select-none"
              role="status"
              aria-live="polite"
              aria-label={`Quantity: ${line.quantity}`}
            >
              {isUpdating ? '…' : line.quantity}
            </span>
            <button
              onClick={() => changeQty(1)}
              disabled={isUpdating}
              className="w-10 h-9 flex items-center justify-center text-ink/60 hover:bg-cream-2 transition-colors disabled:opacity-40 text-sm font-bold"
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>

          <removeFetcher.Form method="post" action="/api/cart">
            <input type="hidden" name="intent"  value="remove-item" />
            <input type="hidden" name="lineId"  value={line.id} />
            <button
              type="submit"
              disabled={isRemoving}
              className="w-10 h-9 flex items-center justify-center rounded-lg text-ink/30 hover:text-red-400 hover:bg-cream-2 transition-colors disabled:opacity-40"
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
  const available = upsells.filter(p => p.variants[0]?.availableForSale).slice(0, 3)
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-4 py-10">
      <div className="w-16 h-16 rounded-full bg-cream-2 flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ink/30" aria-hidden="true">
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
      </div>
      <div>
        <p className="text-base font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          Empty bag — I see you ♥
        </p>
        <p className="text-sm text-muted mt-1">
          Emma's picks are one tap away.
        </p>
      </div>
      <Link
        to="/"
        onClick={onClose}
        className="mt-2 px-6 py-2.5 rounded-full text-sm font-semibold text-white bg-coral hover:bg-coral-deep transition-colors"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Take a peek →
      </Link>
      {available.length > 0 && (
        <div className="w-full mt-6 pt-4 border-t border-line">
          <p
            className="text-[10px] font-bold text-ink/70 uppercase tracking-[0.14em] mb-3"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Emma's picks
          </p>
          <div className="space-y-3">
            {available.map(product => (
              <EmptyCartTile key={product.id} product={product} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyCartTile({ product }: { product: Product }) {
  const image = product.images[0]
  return (
    <Link to={`/products/${product.handle}`} className="flex items-center gap-3 text-left hover:opacity-90 transition-opacity">
      <div className="w-12 h-12 rounded-lg overflow-hidden bg-cream-2 shrink-0">
        {image && (
          <img src={image.url} alt={image.altText || product.title} className="w-full h-full object-cover" loading="lazy" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink line-clamp-1">{product.title}</p>
        <p className="text-xs font-semibold text-coral">${product.price.toFixed(2)}</p>
      </div>
    </Link>
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
