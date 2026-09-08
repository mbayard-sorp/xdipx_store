import { describe, expect, it } from 'vitest'
import { isPdpInStock } from '~/lib/pdp-stock'

describe('isPdpInStock', () => {
  it('is out of stock when Shopify totalInventory is 0, even if availableForSale is true', () => {
    // Ticket #8025: sku 77731, ACTIVE, totalInventory 0, availableForSale
    // true (inventoryPolicy CONTINUE allows oversell) — rendered as an
    // ordinary buyable PDP before this fix.
    expect(isPdpInStock({
      isDigital: false,
      totalInventory: 0,
      variantAvailableForSale: true,
      multiVariant: false,
      dealQty: 0,
    })).toBe(false)
  })

  it('is out of stock when totalInventory is negative', () => {
    expect(isPdpInStock({
      isDigital: false,
      totalInventory: -3,
      variantAvailableForSale: true,
      multiVariant: false,
      dealQty: 0,
    })).toBe(false)
  })

  it('is in stock when totalInventory is positive and the variant is available', () => {
    expect(isPdpInStock({
      isDigital: false,
      totalInventory: 12,
      variantAvailableForSale: true,
      multiVariant: false,
      dealQty: 12,
    })).toBe(true)
  })

  it('falls back to availableForSale when totalInventory is null (nothing on the product tracks inventory)', () => {
    expect(isPdpInStock({
      isDigital: false,
      totalInventory: null,
      variantAvailableForSale: true,
      multiVariant: false,
      dealQty: 0,
    })).toBe(true)
  })

  it('falls back to deal.qty when no variant is resolved on a single-variant product', () => {
    expect(isPdpInStock({
      isDigital: false,
      totalInventory: null,
      variantAvailableForSale: undefined,
      multiVariant: false,
      dealQty: 3,
    })).toBe(true)
    expect(isPdpInStock({
      isDigital: false,
      totalInventory: null,
      variantAvailableForSale: undefined,
      multiVariant: false,
      dealQty: 0,
    })).toBe(false)
  })

  it('defaults to out of stock when a multi-variant product has no variant resolved yet', () => {
    expect(isPdpInStock({
      isDigital: false,
      totalInventory: null,
      variantAvailableForSale: undefined,
      multiVariant: true,
      dealQty: 5,
    })).toBe(false)
  })

  it('is always in stock for digital products, regardless of inventory signals', () => {
    expect(isPdpInStock({
      isDigital: true,
      totalInventory: 0,
      variantAvailableForSale: false,
      multiVariant: false,
      dealQty: 0,
    })).toBe(true)
  })
})
