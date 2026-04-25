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

/**
 * Signals struct used by emma-cart-aside.server.ts to prompt Haiku.
 * Keeps the variant-selection logic co-located with deriveEmmaCartContext
 * so AI + deterministic copy always pick the same angle.
 */
export interface EmmaCartSignals {
  variant:          EmmaCartVariant
  firstName:        string | null
  orderCount:       number
  subtotal:         number
  freeShipGap:      number
  cartLines:        Array<{
    variantId:   string
    title:       string
    productType: string | null
    quantity:    number
    price:       number
  }>
  recentCategories: string[]
  isGift:           boolean
  hasSubscription:  boolean
  userGid:          string | null
}

export function deriveEmmaCartSignals({
  cart,
  profile = null,
  lastSearchQuery: _unused = null,
}: Pick<DeriveArgs, 'cart' | 'profile' | 'lastSearchQuery'>): EmmaCartSignals | null {
  if (!cart || cart.lines.length === 0) return null

  const subtotal    = parseFloat(cart.cost.subtotalAmount.amount)
  const freeShipGap = Math.max(FREE_SHIPPING_THRESHOLD - subtotal, 0)

  const firstName  = profile?.firstName?.trim() || null
  const orderCount = profile?.orders?.length ?? 0
  const isGift     = cartLooksLikeGift(cart)

  // Mirror the variant selection from deriveEmmaCartContext exactly.
  let variant: EmmaCartVariant
  if (isGift)                                                                    variant = 'gift'
  else if (freeShipGap > 0 && freeShipGap <= FREE_SHIP_ADJACENT_GAP)             variant = 'free-ship-adjacent'
  else if (orderCount >= 1)                                                      variant = 'repeat'
  else                                                                           variant = 'first-timer'

  const cartLines = cart.lines.map(l => ({
    variantId:   l.merchandise.id,
    title:       l.merchandise.product.title,
    productType: inferProductType(l.merchandise.product.title),
    quantity:    l.quantity,
    price:       parseFloat(l.merchandise.price.amount),
  }))

  const hasSubscription = cart.lines.some(l => !!l.sellingPlanAllocation)

  // Top categories from profile order history — gives Emma a past-purchase angle.
  const recentCategories: string[] = profile?.orders
    ? topCategories(profile.orders.flatMap(o => o.lineItems.map(li => li.title)))
    : []

  return {
    variant,
    firstName,
    orderCount,
    subtotal,
    freeShipGap,
    cartLines,
    recentCategories,
    isGift,
    hasSubscription,
    userGid: profile?.id ?? null,
  }
}

function inferProductType(title: string): string | null {
  const t = title.toLowerCase()
  if (/\b(lube|glide|silicone|water[- ]based)\b/.test(t)) return 'lube'
  if (/\bwand\b/.test(t)) return 'wand'
  if (/\b(pulse|suction|clitoral)\b/.test(t)) return 'air-pulsation'
  if (/\b(wearable|panty|cock[- ]?ring)\b/.test(t)) return 'wearable'
  if (/\b(vibr|vibe)\b/.test(t)) return 'vibrator'
  if (/\bmassage\b/.test(t)) return 'massager'
  return null
}

function topCategories(titles: string[]): string[] {
  // Cheap keyword buckets — we don't have proper taxonomy on past orders,
  // so we grep titles for known product-type words. Good enough to signal "loves lubes".
  const buckets: Record<string, RegExp> = {
    lube:           /\b(lube|glide|silicone|water[- ]based)\b/i,
    vibrator:       /\b(vibr|vibe)\b/i,
    wand:           /\bwand\b/i,
    'air-pulsation':/\b(pulse|air|suction|clitoral)\b/i,
    wearable:       /\b(wearable|panty|ring|cock[- ]?ring)\b/i,
    massager:       /\bmassage\b/i,
  }
  const counts: Record<string, number> = {}
  for (const t of titles) {
    for (const [bucket, re] of Object.entries(buckets)) {
      if (re.test(t)) counts[bucket] = (counts[bucket] ?? 0) + 1
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([bucket]) => bucket)
}

// ─── helpers ────────────────────────────────────────────────────────────────

function cartLooksLikeGift(cart: Cart | null): boolean {
  if (!cart) return false
  return cart.lines.some(l => {
    const title = l.merchandise.product.title.toLowerCase()
    return title.includes('gift') || title.includes('bundle')
  })
}

export function bodyForVariant(
  v: EmmaCartVariant,
  { firstName, remaining }: { firstName: string | null; remaining: number },
): string {
  switch (v) {
    case 'first-timer':
      return `Good picks. I'd have grabbed the same. Ships in a plain box, billed as XDIPX. Checkout's quick ♥`
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
