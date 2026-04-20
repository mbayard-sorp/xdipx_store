/**
 * Emma cart-drawer context derivation — Phase 4.
 *
 * Reads cart + (optional) customer profile + curated upsell pool and picks:
 *   - a copy variant for Emma's avatar block
 *   - a short context footer ("past order · soft-touch preference · etc.")
 *   - ONE pairing product for the "ONE THING EMMA'D ADD →" slot
 *
 * All inputs are already-fetched data so this is a sync derivation. Callers
 * should pass whatever they have; every path produces a sensible default.
 */

import type { Cart, Product, EmmaCartContext, EmmaCartVariant } from '~/types'
import type { CustomerProfile } from '~/lib/shopify.server'

const FREE_SHIPPING_THRESHOLD = 99
const FREE_SHIP_ADJACENT_GAP  = 20 // $ remaining to trigger "close ✿" variant

interface DeriveArgs {
  cart:            Cart | null
  profile?:        CustomerProfile | null
  upsells?:        Product[]
  lastSearchQuery?: string | null
}

export function deriveEmmaCartContext({
  cart,
  profile = null,
  upsells = [],
  lastSearchQuery = null,
}: DeriveArgs): EmmaCartContext {
  const subtotal  = cart ? parseFloat(cart.cost.subtotalAmount.amount) : 0
  const remaining = Math.max(FREE_SHIPPING_THRESHOLD - subtotal, 0)
  const progress  = Math.min((subtotal / FREE_SHIPPING_THRESHOLD) * 100, 100)

  const firstName   = profile?.firstName?.trim() || null
  const orderCount  = profile?.orders?.length ?? 0
  const hasCart     = !!cart && cart.lines.length > 0
  const isGiftCart  = cartLooksLikeGift(cart)

  // ── pick variant (first match wins) ───────────────────────────────────────
  let variant: EmmaCartVariant
  if (isGiftCart)                                               variant = 'gift'
  else if (hasCart && remaining > 0 && remaining <= FREE_SHIP_ADJACENT_GAP) variant = 'free-ship-adjacent'
  else if (orderCount >= 1)                                     variant = 'repeat'
  else                                                          variant = 'first-timer'

  const greeting = firstName ? `Hey ${firstName} —` : 'Hey —'

  const body = bodyForVariant(variant, { firstName, remaining })

  // ── context footer ───────────────────────────────────────────────────────
  const contextFacts: string[] = []
  if (orderCount >= 2)            contextFacts.push(`${orderCount} past orders`)
  else if (orderCount === 1)      contextFacts.push('past order')
  if (lastSearchQuery)            contextFacts.push(`searched "${lastSearchQuery}"`)
  if (isGiftCart)                 contextFacts.push('gift cart')
  if (variant === 'free-ship-adjacent') contextFacts.push('close to free ship')

  // ── pairing — prefer a free-ship bridge, else a curated accessory ─────────
  const cartVariantIds = cart?.lines.map(l => l.merchandise.id) ?? []
  const eligible = upsells.filter(
    p => p.variants[0]?.availableForSale && !cartVariantIds.includes(p.variants[0].id),
  )
  const pairing = pickPairing(eligible, remaining)
  const pairingWhy = pairing ? pairingWhyCopy(pairing, remaining) : ''

  return {
    variant,
    greeting,
    body,
    contextFacts,
    pairing,
    pairingWhy,
    freeShip: { threshold: FREE_SHIPPING_THRESHOLD, remaining, progress },
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function cartLooksLikeGift(cart: Cart | null): boolean {
  if (!cart) return false
  return cart.lines.some(l => {
    const title = l.merchandise.product.title.toLowerCase()
    return title.includes('gift') || title.includes('bundle')
  })
}

function bodyForVariant(
  v: EmmaCartVariant,
  { firstName, remaining }: { firstName: string | null; remaining: number },
): string {
  switch (v) {
    case 'first-timer':
      return `Good picks — I'd have grabbed the same. Ships in a plain box, billed as DIPCOM. Checkout's quick ♥`
    case 'repeat':
      return firstName
        ? `Welcome back. I lined the pairing up with what you've bought before — take a peek if it fits.`
        : `Welcome back ♥ Pairing's chosen with your past orders in mind.`
    case 'gift':
      return `Gift energy — I love it. Pairing's something thoughtful that won't give the surprise away.`
    case 'free-ship-adjacent':
      return `You're $${remaining.toFixed(2)} from free ship — I'd add the pairing below and call it a day ♥`
    case 'back-after-abandon':
      return `Picked up where you left off. Nothing sold out — you're good.`
  }
}

function pickPairing(pool: Product[], remaining: number): Product | null {
  if (pool.length === 0) return null

  // Free-ship bridge: cheapest item that lands subtotal at/over threshold.
  if (remaining > 0) {
    const bridges = pool
      .filter(p => p.price >= remaining)
      .sort((a, b) => a.price - b.price)
    if (bridges[0]) return bridges[0]
  }

  // Else: the first curated accessory.
  return pool[0] ?? null
}

function pairingWhyCopy(product: Product, remaining: number): string {
  if (remaining > 0 && product.price >= remaining) {
    return `Adds $${product.price.toFixed(2)} — free ship unlocks.`
  }
  if (product.tags.some(t => t.toLowerCase().includes('lube'))) {
    return `Pairs great with what you picked — trust me.`
  }
  return `Quiet pairing — goes with almost anything.`
}
