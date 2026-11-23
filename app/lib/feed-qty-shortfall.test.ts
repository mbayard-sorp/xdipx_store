// Ticket #22337: carried SKUs where Shopify inventory exceeds the supplier's
// live feed quantity are an oversell risk the discontinued sweep's
// zero-stock-only archive step does not catch. isFeedQtyShortfall pins the
// pure decision; findFeedQtyShortfalls pins the end-to-end wiring.
//
// Ticket #23829 corrected the method: #22337's original version compared a
// PRODUCT-level sum of every variant's Shopify inventory against a SINGLE
// deal SKU's feed qty, which manufactures phantom gaps a product with
// several variant SKUs doesn't actually have. findFeedQtyShortfalls now
// compares each variant against its OWN SKU's feed qty (from
// nalpac_price_history, not deal_history's one representative SKU), and
// reports the zero-feed-with-stock subset plus an untracked-variant count
// separately.
import { describe, it, expect, vi } from 'vitest'
import { isFeedQtyShortfall } from './feed-processor.server'

describe('isFeedQtyShortfall', () => {
  it('flags a SKU whose feed quantity has gone to zero while Shopify still shows stock', () => {
    // lust-fetish-seraphina: feed 0, Shopify 10 (ticket's own example).
    expect(isFeedQtyShortfall(0, 10)).toBe(true)
  })

  it('flags a SKU where feed and Shopify are both nonzero but the feed is lower', () => {
    expect(isFeedQtyShortfall(179, 739)).toBe(true)
  })

  it('does not flag a SKU whose feed quantity meets or exceeds Shopify', () => {
    expect(isFeedQtyShortfall(40, 40)).toBe(false)
    expect(isFeedQtyShortfall(99, 1)).toBe(false)
  })

  it('does not flag a SKU absent from the feed pull (null means cannot tell, never zero)', () => {
    expect(isFeedQtyShortfall(null, 40)).toBe(false)
    expect(isFeedQtyShortfall(undefined, 40)).toBe(false)
  })

  it('does not flag a SKU with no Shopify stock either way', () => {
    expect(isFeedQtyShortfall(0, 0)).toBe(false)
  })
})

describe('findFeedQtyShortfalls (#23829: per-variant SKU, nalpac_price_history-backed)', () => {
  async function run(opts: {
    carried: Array<{ productId: string; status: string }>
    shopifyNodes: Array<{
      id: string
      status: string
      variants: Array<{ sku: string | null; inventoryQuantity: number | null }>
    } | null>
    feedHistoryRows: Array<{ sku: string; qty: number | null }>
  }) {
    vi.resetModules()
    const schemaMocks = {
      dealHistory: { shopifyProductId: 'shopify_product_id', status: 'status' },
      nalpacPriceHistory: { sku: 'sku', qty: 'qty' },
      pipelineSettings: { key: 'key', value: 'value' },
    }
    vi.doMock('./db.server', () => ({
      db: {
        select: (_cols: unknown) => ({
          from: (table: unknown) => {
            // Distinguish the two select() call sites by which table object
            // is passed, the same way the real drizzle query builder would
            // route the query -- never by call order, which would silently
            // break if the implementation reorders its own two passes.
            if (table === schemaMocks.dealHistory) {
              return Promise.resolve(opts.carried)
            }
            if (table === schemaMocks.nalpacPriceHistory) {
              return { where: (_cond: unknown) => Promise.resolve(opts.feedHistoryRows) }
            }
            throw new Error('unexpected table in mocked select().from()')
          },
        }),
      },
    }))
    vi.doMock('../../db/schema', () => schemaMocks)
    // drizzle-orm's eq/inArray are pure query-builder constructors with no DB
    // connection of their own -- left unmocked, same as before #23829.
    vi.doMock('./shopify.server', () => ({
      adminGraphQL: async () => ({
        nodes: opts.shopifyNodes.map(n => n && { ...n, variants: { nodes: n.variants } }),
      }),
    }))

    const { findFeedQtyShortfalls } = await import('./feed-processor.server')
    const result = await findFeedQtyShortfalls()

    vi.doUnmock('./db.server')
    vi.doUnmock('../../db/schema')
    vi.doUnmock('./shopify.server')
    vi.resetModules()
    return result
  }

  it('compares each variant against its OWN sku, not a product-level sum against one sku', async () => {
    // nixie: two variant SKUs, feed qty 179 + would-be-sufficient — summing
    // them against either SKU's own feed qty is exactly #22337's bug. Each
    // variant checked against its own SKU should mostly clear.
    const result = await run({
      carried: [{ productId: 'gid://shopify/Product/2', status: 'live' }],
      shopifyNodes: [
        {
          id: 'gid://shopify/Product/2',
          status: 'ACTIVE',
          variants: [
            { sku: 'nixie-sku-a', inventoryQuantity: 178 },
            { sku: 'nixie-sku-b', inventoryQuantity: 560 },
          ],
        },
      ],
      feedHistoryRows: [
        { sku: 'nixie-sku-a', qty: 179 },
        { sku: 'nixie-sku-b', qty: 560 },
      ],
    })
    expect(result.shortfalls).toHaveLength(0)
    expect(result.zeroFeedWithStock).toHaveLength(0)
    expect(result.untrackedVariantCount).toBe(0)
    expect(result.checkedVariantCount).toBe(2)
  })

  it('flags a real per-variant shortfall and buckets feed-qty-0-with-stock separately', async () => {
    const result = await run({
      carried: [
        { productId: 'gid://shopify/Product/1', status: 'live' },
        { productId: 'gid://shopify/Product/2', status: 'live' },
      ],
      shopifyNodes: [
        {
          id: 'gid://shopify/Product/1',
          status: 'ACTIVE',
          variants: [{ sku: 'seraphina-sku', inventoryQuantity: 10 }],
        },
        {
          id: 'gid://shopify/Product/2',
          status: 'ACTIVE',
          variants: [{ sku: 'lower-not-zero-sku', inventoryQuantity: 739 }],
        },
      ],
      feedHistoryRows: [
        { sku: 'seraphina-sku', qty: 0 },
        { sku: 'lower-not-zero-sku', qty: 179 },
      ],
    })
    expect(result.shortfalls).toHaveLength(2)
    expect(result.zeroFeedWithStock).toEqual([
      { sku: 'seraphina-sku', productId: 'gid://shopify/Product/1', feedQty: 0, shopifyQty: 10 },
    ])
    expect(result.shortfalls.map(s => s.sku).sort()).toEqual(['lower-not-zero-sku', 'seraphina-sku'])
  })

  it('counts a carried variant SKU with no nalpac_price_history row as untracked, not a shortfall', async () => {
    const result = await run({
      carried: [{ productId: 'gid://shopify/Product/5', status: 'live' }],
      shopifyNodes: [
        {
          id: 'gid://shopify/Product/5',
          status: 'ACTIVE',
          variants: [{ sku: 'no-history-row-sku', inventoryQuantity: 5 }],
        },
      ],
      feedHistoryRows: [], // deliberately no row for no-history-row-sku
    })
    expect(result.shortfalls).toHaveLength(0)
    expect(result.untrackedVariantCount).toBe(1)
    expect(result.checkedVariantCount).toBe(1)
  })

  it('skips archived products and products carried only via a non-live deal_history status', async () => {
    const result = await run({
      carried: [
        { productId: 'gid://shopify/Product/4', status: 'archived' },
        { productId: 'gid://shopify/Product/3', status: 'live' },
      ],
      shopifyNodes: [
        {
          id: 'gid://shopify/Product/3',
          status: 'ACTIVE',
          variants: [{ sku: 'sufficient-sku', inventoryQuantity: 40 }],
        },
      ],
      feedHistoryRows: [{ sku: 'sufficient-sku', qty: 40 }],
    })
    expect(result.shortfalls).toHaveLength(0)
    expect(result.checkedVariantCount).toBe(1) // the archived deal_history row never reaches the Shopify fetch
  })
})
