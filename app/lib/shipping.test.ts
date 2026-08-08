import { describe, expect, it } from 'vitest'
import { FREE_SHIPPING_THRESHOLD } from '~/lib/shipping'

// free-shipping-threshold-shopify-coupling-guard (ticket #715).
//
// FREE_SHIPPING_THRESHOLD drives customer-facing money-path copy — the cart
// drawer "$X to free shipping" progress bar and the same promise on collection
// pages — but its correctness depends entirely on the live Shopify delivery
// profile, and NO gate couples the two. CI, tests, QA, and the release engine
// all pass a threshold change without ever reading Shopify, so a code edit here
// can silently over-promise free shipping that checkout will not honor. (This
// is exactly why R-DEV had to block ticket #420: it wanted 50 while Shopify
// still free-ships only at 99.)
//
// This is the interim guard the ticket sanctions: a change-detector that pins
// the constant against the documented Shopify condition so a code-side edit
// can't drift silently. It cannot catch a Shopify-side change on its own — that
// needs a runtime cron assertion reading the delivery profile, which requires a
// new vercel.json cron entry (a protected path) and is therefore out of the dev
// lane's scope.

// Documented Shopify US delivery-profile free-shipping TOTAL_PRICE condition.
// Verified 2026-07-27 (see app/lib/shipping.ts). Update this in the SAME change
// as any Shopify delivery-profile edit, or the constant and the storefront copy
// drift apart.
const SHOPIFY_US_FREE_SHIP_TOTAL_PRICE = 99

describe('FREE_SHIPPING_THRESHOLD coupling guard', () => {
  it('matches the live Shopify US free-shipping condition', () => {
    // If this fails you changed the code constant. Free shipping is a checkout
    // promise: update the Shopify delivery profile's US-Standard free-shipping
    // TOTAL_PRICE rule to the new value FIRST, then update
    // SHOPIFY_US_FREE_SHIP_TOTAL_PRICE above to match. Never edit only the
    // constant — the storefront would advertise a threshold checkout won't honor.
    expect(FREE_SHIPPING_THRESHOLD).toBe(SHOPIFY_US_FREE_SHIP_TOTAL_PRICE)
  })

  it('is a positive, whole-dollar amount', () => {
    // Sanity floor: a zero/negative/fractional threshold would render broken
    // "$X to free shipping" copy and a nonsensical progress bar.
    expect(Number.isInteger(FREE_SHIPPING_THRESHOLD)).toBe(true)
    expect(FREE_SHIPPING_THRESHOLD).toBeGreaterThan(0)
  })
})
