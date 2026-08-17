/**
 * Merchant-feed shipping and description helpers for app/routes/[feed.xml].tsx.
 *
 * Ticket #3425: the feed previously declared a blanket 0.00 USD shipping
 * block on rich entries and nothing on lean entries, while checkout charges
 * $9.99 unless the order total reaches the free-shipping threshold. Google
 * Merchant Center treats a feed/checkout shipping mismatch as
 * misrepresentation (docs/ads-policy.md, Merchant Center section), a
 * suspension-level failure.
 *
 * A <g:shipping> block is per item: Merchant Center evaluates it as what a
 * customer pays to ship that one item. Cart-total-conditional rates cannot be
 * expressed per item, so the honest per-item value is the single-unit cart:
 *   - contiguous US: $9.99, free when the item price alone reaches $99
 *   - HI / AK / PR: $9.99, free when the item price alone reaches $145
 * Threshold values mirror the live Shopify delivery profile via
 * FREE_SHIPPING_THRESHOLD (see app/lib/shipping.ts and its coupling guard).
 * The fuller conditional-rate model (free over $99 on multi-item carts)
 * belongs in Merchant Center account-level shipping settings, an owner
 * action in the GMC UI, not in the feed.
 *
 * Plain module (no .server suffix) so vitest can unit-test it directly; it
 * has no server-only dependencies.
 */

import { FREE_SHIPPING_THRESHOLD } from '~/lib/shipping'

/** Base US Standard rate charged at checkout below the free threshold. */
export const US_SHIPPING_FLAT_RATE = 9.99

/** HI / AK / PR free-shipping threshold in the Shopify delivery profile. */
export const REMOTE_FREE_SHIPPING_THRESHOLD = 145

const REMOTE_REGIONS = ['AK', 'HI', 'PR'] as const

function fmtShipPrice(n: number): string {
  return `${n.toFixed(2)} USD`
}

function shippingBlock(price: number, region?: string): string {
  const regionTag = region ? `<g:region>${region}</g:region>` : ''
  return (
    `      <g:shipping><g:country>US</g:country>${regionTag}` +
    `<g:service>Standard</g:service>` +
    `<g:price>${fmtShipPrice(price)}</g:price></g:shipping>`
  )
}

/**
 * Per-item <g:shipping> lines mirroring what checkout charges for a
 * single-unit cart at `itemPrice`. Region-specific blocks (HI/AK/PR) are
 * listed before the country-level block; Merchant Center applies the most
 * specific matching entry.
 */
export function feedShippingLines(itemPrice: number): string[] {
  const usPrice = itemPrice >= FREE_SHIPPING_THRESHOLD ? 0 : US_SHIPPING_FLAT_RATE
  const remotePrice = itemPrice >= REMOTE_FREE_SHIPPING_THRESHOLD ? 0 : US_SHIPPING_FLAT_RATE
  const lines: string[] = []
  if (remotePrice !== usPrice) {
    for (const region of REMOTE_REGIONS) {
      lines.push(shippingBlock(remotePrice, region))
    }
  }
  lines.push(shippingBlock(usPrice))
  return lines
}

const DOLLAR_AMOUNT = /\$\s?\d[\d,]*(?:\.\d{1,2})?/

/**
 * Removes literal dollar amounts from a generated description. The pricing
 * agent moves prices daily, so any interpolated "$29.99 at xdipx" drifts out
 * of truth on its own and reads as a price mismatch in Merchant Center.
 *
 * Sentences containing a dollar amount are dropped whole so the remaining
 * copy stays grammatical; any residual amount (single-sentence text) is
 * excised directly. Returns '' when nothing survives, letting the caller
 * fall back to its priceless template.
 */
export function stripDollarAmounts(text: string): string {
  if (!DOLLAR_AMOUNT.test(text)) return text
  const sentences = text.split(/(?<=[.!?])\s+/)
  const kept = sentences.filter(s => !DOLLAR_AMOUNT.test(s))
  let out = kept.join(' ').trim()
  if (out === '' && sentences.length === 1) {
    // Single-sentence text: dropping the sentence drops everything, so
    // excise the amount itself and keep the surrounding copy.
    out = text
  }
  if (DOLLAR_AMOUNT.test(out)) {
    out = out
      .replace(new RegExp(DOLLAR_AMOUNT.source, 'g'), '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  }
  // A sanitized remnant with fewer than four words ("at xdipx.") is not a
  // description; return '' so the caller's template takes over.
  if (out.split(/\s+/).filter(Boolean).length < 4) return ''
  return out
}
