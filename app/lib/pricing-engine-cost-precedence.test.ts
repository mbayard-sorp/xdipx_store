// The v2 engine prices off the feed cost when Shopify's unit cost is a lapsed
// Nalpac sale cost (pricing audit 2026-10-15). engine-cost.test.ts pins the
// rule; this pins that recomputeCatalog actually reads nalpac_price_history
// and hands the resolved cost to the compute core and the audit row.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const auditRows: Array<Record<string, unknown>> = []
const computeCosts: Array<number | null> = []
let historyRows: Array<Record<string, unknown>> = []

vi.mock('./db.server', () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => ({
        where: (pred: { key?: string }) => {
          if (table?.__name === 'nalpac_price_history') return Promise.resolve(historyRows)
          return { limit: async () => (pred?.key ? [] : []) }
        },
      }),
    }),
    insert: (table: { __name?: string }) => ({
      values: (row: Record<string, unknown>) => {
        if (table?.__name === 'pipeline_settings') return { onConflictDoUpdate: async () => undefined }
        auditRows.push(row)
        return { returning: async () => [{ id: auditRows.length }] }
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}))

vi.mock('../../db/schema', () => ({
  pricingAuditLog:    { __name: 'pricing_audit_log', id: 'id' },
  pipelineSettings:   { __name: 'pipeline_settings', key: 'key', value: 'value' },
  nalpacPriceHistory: {
    __name: 'nalpac_price_history', sku: 'sku', wholesale: 'wholesale', inSale: 'in_sale',
    observedAt: 'observed_at', mapPrice: 'map_price',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (_col: unknown, val: unknown) => ({ key: val }),
  sql: Object.assign(() => 'sql', { raw: () => 'sql' }),
  and: () => 'and',
  lt: () => 'lt',
  inArray: () => ({}),
}))

vi.mock('./pricing-rules.server', () => ({
  resolvePricingConfig: async () => ({
    velocity_modifier_enabled: false,
    map_behavior: 'ignore_map',
    margin_floor_pct: 0.1,
    groupId: null,
    subGroupId: null,
  }),
  getGroupForProductType: async () => null,
  buildRationale: () => 'rationale.',
}))
vi.mock('./pricing-velocity.server', () => ({ computeVelocityBucket: async () => 'steady' }))
vi.mock('./pricing-engine-v2.server', () => ({
  computePrice: ({ cost }: { cost: number | null }) => {
    computeCosts.push(cost)
    return cost == null ? null : { sell: Math.round(cost * 200) / 100, compare_at: null, msrpBelowFloor: false }
  },
  computeDiscontinuedPrice: () => null,
  applyVelocityModifier: (c: unknown) => c,
  enforceMapFloor: (sell: number) => sell,
  enforceWholesaleFloor: (sell: number) => sell,
  roundUpPsychological: (n: number) => n,
  ABSOLUTE_PRICE_FLOOR_DEFAULT: 2.99,
  DEFAULT_CLEARANCE_LADDER: [[30, 0.15], [60, 0.25], [90, 0.35], [10_000, 0.5]],
  parseClearanceLadder: () => null,
}))

let pages: Array<{ products: unknown[]; endCursor: string | null; hasNextPage: boolean }> = []

vi.mock('./shopify.server', () => ({
  updateVariantPricing: async () => undefined,
  setVariantLaunchPrice: async () => undefined,
  normalizeMetafieldKey: (k: string) => k,
  fetchPricingProductsPage: async () => pages.shift() ?? { products: [], endCursor: null, hasNextPage: false },
}))

import { recomputeCatalog } from './pricing-apply-v2.server'

function product(sku: string, unitCost: number) {
  return {
    productId: sku,
    handle: sku,
    title: sku,
    vendor: 'Acme',
    productType: 'Douche / Enema',
    metafields: { wholesaleCost: null, mapPrice: null, originalPrice: null, discontinuedAt: null },
    variants: [{
      variantId: `gid://shopify/ProductVariant/${sku}`,
      sku,
      price: 57.99,
      compareAtPrice: null,
      unitCost,
      launchPrice: 57.99,
    }],
  }
}

beforeEach(() => {
  auditRows.length = 0
  computeCosts.length = 0
  historyRows = []
  pages = []
})

describe('recomputeCatalog cost precedence', () => {
  it('prices a lapsed-sale variant off the feed wholesale and records the replaced unit cost', async () => {
    historyRows = [{ sku: '95230', wholesale: '50.05', inSale: false, observedAt: new Date() }]
    pages.push({ products: [product('95230', 35.04)], endCursor: null, hasNextPage: false })

    await recomputeCatalog({ trigger: 'manual' })

    expect(computeCosts).toEqual([50.05])
    expect(auditRows[0]?.oldCost).toBe('35.04')
    expect(auditRows[0]?.newCost).toBe('50.05')
    expect(String(auditRows[0]?.rationale)).toContain('lapsed sale cost')
  })

  it('keeps the Shopify unit cost while the SKU is in the sale feed', async () => {
    historyRows = [{ sku: '92689', wholesale: '27.80', inSale: true, observedAt: new Date() }]
    pages.push({ products: [product('92689', 16.68)], endCursor: null, hasNextPage: false })

    await recomputeCatalog({ trigger: 'manual' })

    expect(computeCosts).toEqual([16.68])
    expect(String(auditRows[0]?.rationale ?? '')).not.toContain('lapsed sale cost')
  })

  it('keeps the unit cost when the SKU has no feed snapshot', async () => {
    pages.push({ products: [product('77777', 9.5)], endCursor: null, hasNextPage: false })

    await recomputeCatalog({ trigger: 'manual' })

    expect(computeCosts).toEqual([9.5])
  })
})
