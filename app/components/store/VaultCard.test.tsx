/**
 * Ticket #9323: collection/listing cards had no sold-out signal beyond a
 * silently-missing quick-add button — a zero-inventory product (all variants
 * `availableForSale: false`) rendered as a normal, purchasable-looking card.
 * `nodeToVaultDeal` now carries a real `inStock` flag (unlike `qty`, which only
 * reads the first-listed variant) and VaultCard renders an explicit "Sold out"
 * badge from it, matching the honest state the PDP's StockIndicator already
 * shows. This locks the card-level half of that fix in place.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoutesStub } from 'react-router'
import { VaultCard } from './VaultCard'
import type { VaultDeal } from '~/types'

const BASE_DEAL: VaultDeal = {
  id: 'gid://shopify/Product/1',
  handle: 'test-product',
  seoTitle: 'Test Product',
  dealPrice: 10,
  msrp: 12,
  images: [],
  brand: 'Test',
  category: [],
  qty: 3,
  inStock: true,
  defaultVariantId: 'gid://shopify/ProductVariant/1',
  hasMultipleVariants: false,
}

function renderCard(deal: VaultDeal): string {
  const Stub = createRoutesStub([{ path: '/', Component: () => <VaultCard deal={deal} /> }])
  return renderToStaticMarkup(<Stub />)
}

describe('VaultCard sold-out badge', () => {
  it('renders a Sold out badge when no variant is purchasable', () => {
    const html = renderCard({ ...BASE_DEAL, qty: 0, inStock: false })
    expect(html).toContain('Sold out')
  })

  it('renders no Sold out badge for an in-stock product', () => {
    const html = renderCard({ ...BASE_DEAL, qty: 3, inStock: true })
    expect(html).not.toContain('Sold out')
  })

  it('hides the sold-out badge even when qty reads 0 on a multi-variant product with another variant in stock', () => {
    // Regression guard for the exact gap #9323 found: `qty` only reflects the
    // first-listed variant, so a multi-variant product with a sold-out first
    // variant but a purchasable sibling must never show "Sold out" — that
    // would be a false unavailability claim on a product a shopper can buy.
    const html = renderCard({ ...BASE_DEAL, qty: 0, inStock: true, hasMultipleVariants: true })
    expect(html).not.toContain('Sold out')
  })

  it('never shows the quick-add button on a sold-out card', () => {
    const html = renderCard({ ...BASE_DEAL, qty: 0, inStock: false })
    expect(html).not.toContain('+ Add')
  })
})
