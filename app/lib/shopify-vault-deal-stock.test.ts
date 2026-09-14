/**
 * Ticket #9323: collection/listing cards had no sold-out signal. `qty` on
 * VaultDeal only ever reads the first-listed variant's quantityAvailable, so
 * it silently misjudges a multi-variant product whose *other* variants carry
 * the real stock. `inStock` fixes that by checking whether ANY variant is
 * `availableForSale`, mirroring the same idiom already used for `getProduct`'s
 * PDP-level `inStock` field elsewhere in this file.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/kv.server', () => ({
  cached: async (_k: string, _ttl: number, fn: () => unknown) => fn(),
  invalidateCache: vi.fn(),
  kvGet: vi.fn(),
  kvSet: vi.fn(),
  KV_KEYS: {},
}))

import { nodeToVaultDeal } from '~/lib/shopify.server'

function variant(overrides: Partial<{ id: string; price: string; compareAtPrice: string | null; quantityAvailable: number; availableForSale: boolean }> = {}) {
  return {
    id: overrides.id ?? 'gid://shopify/ProductVariant/1',
    price: { amount: overrides.price ?? '10.00' },
    compareAtPrice: overrides.compareAtPrice != null ? { amount: overrides.compareAtPrice } : null,
    quantityAvailable: overrides.quantityAvailable ?? 0,
    availableForSale: overrides.availableForSale ?? false,
  }
}

function node(variants: ReturnType<typeof variant>[]) {
  return {
    id: 'gid://shopify/Product/1',
    handle: 'test-product',
    title: 'Test Product',
    vendor: 'Test',
    tags: [],
    options: [],
    images: { edges: [] },
    variants: { edges: variants.map((v) => ({ node: v })) },
    metafields: [],
  }
}

describe('nodeToVaultDeal inStock', () => {
  it('is false when the single variant is not purchasable — the Shane Diesel case (#9323)', () => {
    const deal = nodeToVaultDeal(node([variant({ quantityAvailable: 0, availableForSale: false })]))
    expect(deal.inStock).toBe(false)
    expect(deal.qty).toBe(0)
  })

  it('is true when the single variant is purchasable', () => {
    const deal = nodeToVaultDeal(node([variant({ quantityAvailable: 5, availableForSale: true })]))
    expect(deal.inStock).toBe(true)
  })

  it('is true when the FIRST variant is sold out but a sibling variant is purchasable', () => {
    // This is what `qty` alone gets wrong: qty reads only variantEdges[0],
    // so a naive `qty > 0` badge would falsely claim this product is sold out.
    const deal = nodeToVaultDeal(
      node([
        variant({ id: 'v1', quantityAvailable: 0, availableForSale: false }),
        variant({ id: 'v2', quantityAvailable: 4, availableForSale: true }),
      ]),
    )
    expect(deal.qty).toBe(0)
    expect(deal.inStock).toBe(true)
  })

  it('is false only when every variant is unavailable', () => {
    const deal = nodeToVaultDeal(
      node([
        variant({ id: 'v1', quantityAvailable: 0, availableForSale: false }),
        variant({ id: 'v2', quantityAvailable: 0, availableForSale: false }),
      ]),
    )
    expect(deal.inStock).toBe(false)
  })
})
