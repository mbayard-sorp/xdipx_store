// Ticket #22337: carried SKUs where Shopify inventory exceeds the supplier's
// live feed quantity are an oversell risk the discontinued sweep's
// zero-stock-only archive step does not catch. isFeedQtyShortfall pins the
// pure decision; findFeedQtyShortfalls pins the end-to-end wiring against
// mocked feed/db/Shopify reads using the ticket's own named examples.
import { describe, it, expect, vi } from 'vitest'
import { isFeedQtyShortfall } from './feed-processor.server'

describe('isFeedQtyShortfall', () => {
  it('flags a SKU whose feed quantity has gone to zero while Shopify still shows stock', () => {
    // lust-fetish-seraphina: feed 0, Shopify 10 (ticket's own example).
    expect(isFeedQtyShortfall(0, 10)).toBe(true)
  })

  it('flags a SKU where feed and Shopify are both nonzero but the feed is lower', () => {
    // nixie-rechargeable-wand-massager-ombre-metallic: feed 179, Shopify 739.
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

describe('findFeedQtyShortfalls', () => {
  it('reports only the carried SKUs where feed qty is below Shopify qty, skipping archived/absent/sufficient ones', async () => {
    vi.resetModules()
    vi.doMock('./db.server', () => ({
      db: {
        select: () => ({
          from: () =>
            Promise.resolve([
              { sku: 'seraphina-sku', productId: 'gid://shopify/Product/1', status: 'live' },
              { sku: 'nixie-sku', productId: 'gid://shopify/Product/2', status: 'live' },
              { sku: 'sufficient-sku', productId: 'gid://shopify/Product/3', status: 'live' },
              { sku: 'archived-sku', productId: 'gid://shopify/Product/4', status: 'archived' },
              { sku: 'no-feed-row-sku', productId: 'gid://shopify/Product/5', status: 'live' },
            ]),
        }),
      },
    }))
    vi.doMock('../../db/schema', () => ({
      dealHistory: { sku: 'sku', shopifyProductId: 'shopify_product_id', status: 'status' },
      pipelineSettings: { key: 'key', value: 'value' },
    }))
    vi.doMock('./nalpac-feeds.server', () => ({
      fetchAllNalpacFeeds: async () => ({
        snapshots: new Map([
          ['seraphina-sku', { qty: 0 }],
          ['nixie-sku', { qty: 179 }],
          ['sufficient-sku', { qty: 40 }],
          ['archived-sku', { qty: 0 }],
          // no-feed-row-sku deliberately absent
        ]),
      }),
    }))
    vi.doMock('./shopify.server', () => ({
      adminGraphQL: async () => ({
        nodes: [
          { id: 'gid://shopify/Product/1', status: 'ACTIVE', variants: { nodes: [{ inventoryQuantity: 10 }] } },
          { id: 'gid://shopify/Product/2', status: 'ACTIVE', variants: { nodes: [{ inventoryQuantity: 739 }] } },
          { id: 'gid://shopify/Product/3', status: 'ACTIVE', variants: { nodes: [{ inventoryQuantity: 40 }] } },
          { id: 'gid://shopify/Product/4', status: 'ARCHIVED', variants: { nodes: [{ inventoryQuantity: 0 }] } },
          { id: 'gid://shopify/Product/5', status: 'ACTIVE', variants: { nodes: [{ inventoryQuantity: 5 }] } },
        ],
      }),
    }))

    const { findFeedQtyShortfalls } = await import('./feed-processor.server')
    const result = await findFeedQtyShortfalls()

    expect(result).toHaveLength(2)
    const bySku = new Map(result.map(r => [r.sku, r]))
    expect(bySku.get('seraphina-sku')).toEqual({
      sku: 'seraphina-sku', productId: 'gid://shopify/Product/1', feedQty: 0, shopifyQty: 10,
    })
    expect(bySku.get('nixie-sku')).toEqual({
      sku: 'nixie-sku', productId: 'gid://shopify/Product/2', feedQty: 179, shopifyQty: 739,
    })
    expect(bySku.has('sufficient-sku')).toBe(false)
    expect(bySku.has('archived-sku')).toBe(false)
    expect(bySku.has('no-feed-row-sku')).toBe(false)

    vi.doUnmock('./db.server')
    vi.doUnmock('../../db/schema')
    vi.doUnmock('./nalpac-feeds.server')
    vi.doUnmock('./shopify.server')
    vi.resetModules()
  })
})
