// Unit tests for cost-sync.server.ts's wholesale-rise flag (ticket #10871).
// DB and every collaborator (Shopify, pricing engine, detection-ticket bus)
// are mocked out; this exercises runNalpacCostSync's own branching only.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NalpacPriceSnapshot } from './nalpac-feeds.server'

type PriorRow = {
  sku: string
  wholesale: string | null
  mapPrice: string | null
  syncedAt: Date | null
  riseBasisWholesale?: string | null
}

let priorRows: PriorRow[] = []
const settings: Record<string, string | null> = {
  pricing_costsync_enabled: 'true',
  import_monitor_watch_price_drop_pct: '0.10',
}

const insertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) })
const dbInsert = vi.fn().mockReturnValue({ values: insertValues })
const dbSelect = vi.fn(() => ({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockImplementation(async () => priorRows),
  }),
}))

vi.mock('./db.server', () => ({
  db: {
    select: dbSelect,
    insert: dbInsert,
  },
}))

vi.mock('../../db/schema', () => ({
  nalpacPriceHistory: { sku: 'sku' },
}))

vi.mock('./feed-processor.server', () => ({
  getPipelineSetting: vi.fn(async (key: string) => settings[key] ?? null),
}))

const findVariantsBySkus = vi.fn(async (_skus: string[]) => [] as Array<{ productGid: string; variant: { sku: string; variantId: string } }>)
const updateProductMetafield = vi.fn(async (_productId: string, _key: string, _value: string, _type?: string) => {})
vi.mock('./shopify.server', () => ({
  findVariantsBySkus,
  updateProductMetafield,
}))

const recomputeVariant = vi.fn(async (_params: { variantId: string; trigger: string }) => ({}))
vi.mock('./pricing-apply-v2.server', () => ({
  recomputeVariant,
}))

const fileDetectionTicket = vi.fn(async (_input: { dedupeKey: string; kind: string; targetTeam: string; suggestion: string }) => 123)
vi.mock('./detection-tickets.server', () => ({
  fileDetectionTicket,
  makeDedupeKey: (...parts: Array<string | number>) => parts.join(':').toLowerCase(),
  priorityFromSeverity: () => 3,
}))

function snap(overrides: Partial<NalpacPriceSnapshot> & { sku: string; wholesale: number }): NalpacPriceSnapshot {
  return {
    vendor: null,
    productTitle: null,
    msrp: 20,
    mapPrice: null,
    qty: 5,
    inSaleFeed: false,
    inNewFeed: false,
    inTop100Feed: false,
    nalpacDiscountPct: null,
    raw: {},
    ...overrides,
  } as NalpacPriceSnapshot
}

describe('runNalpacCostSync: wholesale-rise flag (#10871)', () => {
  beforeEach(() => {
    priorRows = []
    vi.clearAllMocks()
    settings['pricing_costsync_enabled'] = 'true'
    settings['import_monitor_watch_price_drop_pct'] = '0.10'
  })

  it('flags a material wholesale rise via a detection ticket, without repricing', async () => {
    priorRows = [{ sku: 'SKU1', wholesale: '10.00', mapPrice: '8.00', syncedAt: null }]
    const { runNalpacCostSync } = await import('./cost-sync.server')

    const result = await runNalpacCostSync({
      snapshots: new Map([['SKU1', snap({ sku: 'SKU1', wholesale: 12.5, mapPrice: 8 })]]),
      carriedSkus: new Set(['SKU1']),
    })

    expect(result.increasesFlagged).toBe(1)
    expect(result.dropsDetected).toBe(0)
    expect(fileDetectionTicket).toHaveBeenCalledTimes(1)
    const call = fileDetectionTicket.mock.calls[0]![0]
    expect(call.dedupeKey).toBe('cost-sync-wholesale-rise:sku1')
    expect(call.kind).toBe('process')
    expect(call.targetTeam).toBe('product')
    expect(call.suggestion).toContain('10.00')
    expect(call.suggestion).toContain('12.50')
    // A rise is never pushed through the reprice path.
    expect(findVariantsBySkus).not.toHaveBeenCalled()
    expect(updateProductMetafield).not.toHaveBeenCalled()
    expect(recomputeVariant).not.toHaveBeenCalled()
  })

  it('does not flag a rise below the material-change threshold', async () => {
    priorRows = [{ sku: 'SKU1', wholesale: '10.00', mapPrice: null, syncedAt: null }]
    const { runNalpacCostSync } = await import('./cost-sync.server')

    const result = await runNalpacCostSync({
      snapshots: new Map([['SKU1', snap({ sku: 'SKU1', wholesale: 10.5 })]]), // +5%, under the 10% floor
      carriedSkus: new Set(['SKU1']),
    })

    expect(result.increasesFlagged).toBe(0)
    expect(fileDetectionTicket).not.toHaveBeenCalled()
  })

  it('still detects and reprices a drop exactly as before, and never flags it as a rise', async () => {
    priorRows = [{ sku: 'SKU1', wholesale: '10.00', mapPrice: null, syncedAt: null }]
    findVariantsBySkus.mockResolvedValueOnce([
      { productGid: 'gid://shopify/Product/1', variant: { sku: 'SKU1', variantId: 'gid://shopify/ProductVariant/1' } },
    ])
    const { runNalpacCostSync } = await import('./cost-sync.server')

    const result = await runNalpacCostSync({
      snapshots: new Map([['SKU1', snap({ sku: 'SKU1', wholesale: 8 })]]), // -20%, a drop
      carriedSkus: new Set(['SKU1']),
    })

    expect(result.dropsDetected).toBe(1)
    expect(result.increasesFlagged).toBe(0)
    expect(fileDetectionTicket).not.toHaveBeenCalled()
    expect(recomputeVariant).toHaveBeenCalledTimes(1)
    expect(result.variantsRepriced).toBe(1)
  })

  it('caps the number of rise tickets filed in one run', async () => {
    const skus = Array.from({ length: 15 }, (_, i) => `SKU${i}`)
    priorRows = skus.map(sku => ({ sku, wholesale: '10.00', mapPrice: null, syncedAt: null }))
    const { runNalpacCostSync } = await import('./cost-sync.server')

    const result = await runNalpacCostSync({
      snapshots: new Map(skus.map(sku => [sku, snap({ sku, wholesale: 15 })])), // +50% each
      carriedSkus: new Set(skus),
    })

    expect(result.increasesFlagged).toBe(10) // MAX_WHOLESALE_RISE_FLAGS_PER_RUN
    expect(fileDetectionTicket).toHaveBeenCalledTimes(10)
  })

  it('does not reset the sticky rise basis on a sub-threshold rise, so it carries forward instead of tracking yesterday (#12082)', async () => {
    priorRows = [{ sku: 'SKU1', wholesale: '10.00', mapPrice: null, syncedAt: null, riseBasisWholesale: null }]
    const { runNalpacCostSync } = await import('./cost-sync.server')

    const result = await runNalpacCostSync({
      snapshots: new Map([['SKU1', snap({ sku: 'SKU1', wholesale: 10.5 })]]), // +5%, under the 10% floor
      carriedSkus: new Set(['SKU1']),
    })

    expect(result.increasesFlagged).toBe(0)
    const chunk = insertValues.mock.calls[0]![0] as Array<{ sku: string; riseBasisWholesale: string | null }>
    // The basis stays pinned at 10.00 (not advanced to 10.50) so a second
    // sub-threshold step is measured cumulatively against the same floor.
    expect(chunk[0]!.riseBasisWholesale).toBe('10')
  })

  it('flags a creeping wholesale rise once the CUMULATIVE basis crosses the threshold, even though no single day crossed it (#12082, SKU 88038 shape)', async () => {
    // Day 1: 10.00 -> 10.50 (+5%, under threshold). No flag, basis stays 10.00.
    priorRows = [{ sku: 'SKU1', wholesale: '10.00', mapPrice: null, syncedAt: null, riseBasisWholesale: null }]
    const { runNalpacCostSync } = await import('./cost-sync.server')
    const day1 = await runNalpacCostSync({
      snapshots: new Map([['SKU1', snap({ sku: 'SKU1', wholesale: 10.5 })]]),
      carriedSkus: new Set(['SKU1']),
    })
    expect(day1.increasesFlagged).toBe(0)

    // Day 2: 10.50 -> 11.50. Day-over-day is only ~9.5% (under threshold, and
    // under the old priorWholesale-only check this would never flag), but
    // against the still-10.00 basis it is +15%, over the 10% floor.
    priorRows = [{ sku: 'SKU1', wholesale: '10.50', mapPrice: null, syncedAt: null, riseBasisWholesale: '10.00' }]
    vi.clearAllMocks()
    const day2 = await runNalpacCostSync({
      snapshots: new Map([['SKU1', snap({ sku: 'SKU1', wholesale: 11.5 })]]),
      carriedSkus: new Set(['SKU1']),
    })

    expect(day2.increasesFlagged).toBe(1)
    const call = fileDetectionTicket.mock.calls[0]![0]
    expect(call.suggestion).toContain('10.00')
    expect(call.suggestion).toContain('11.50')
    // The basis resets to today's wholesale once a rise actually fires, so
    // the next comparison starts fresh rather than re-flagging immediately.
    const chunk = insertValues.mock.calls[0]![0] as Array<{ sku: string; riseBasisWholesale: string | null }>
    expect(chunk[0]!.riseBasisWholesale).toBe('11.5')
  })

  it('is a no-op entirely when pricing_costsync_enabled is off', async () => {
    settings['pricing_costsync_enabled'] = 'false'
    const { runNalpacCostSync } = await import('./cost-sync.server')

    const result = await runNalpacCostSync({
      snapshots: new Map([['SKU1', snap({ sku: 'SKU1', wholesale: 12.5 })]]),
      carriedSkus: new Set(['SKU1']),
    })

    expect(result.enabled).toBe(false)
    expect(dbSelect).not.toHaveBeenCalled()
    expect(fileDetectionTicket).not.toHaveBeenCalled()
  })
})

describe('runNalpacCostSync: in_sale snapshot (pricing audit 2026-10-15)', () => {
  beforeEach(() => {
    priorRows = []
    vi.clearAllMocks()
    settings['pricing_costsync_enabled'] = 'true'
  })

  it('marks a SKU on sale when the main feed carries an "N% Off Sale" tag the sale feed missed', async () => {
    const { runNalpacCostSync } = await import('./cost-sync.server')
    await runNalpacCostSync({
      snapshots: new Map([
        ['TAGGED', snap({ sku: 'TAGGED', wholesale: 27.8, raw: { mainRow: { 'Sub-Category': '40% Off Sale,Collars and Leashes' } } })],
        ['PLAIN',  snap({ sku: 'PLAIN',  wholesale: 50.05, raw: { mainRow: { 'Sub-Category': 'Douches and Enemas' } } })],
        ['FEED',   snap({ sku: 'FEED',   wholesale: 10, inSaleFeed: true })],
      ]),
      carriedSkus: new Set(['TAGGED', 'PLAIN', 'FEED']),
    })

    const written = insertValues.mock.calls.flatMap(c => c[0] as Array<{ sku: string; inSale: boolean }>)
    const bySku = new Map(written.map(r => [r.sku, r.inSale]))
    expect(bySku.get('TAGGED')).toBe(true)
    expect(bySku.get('PLAIN')).toBe(false)
    expect(bySku.get('FEED')).toBe(true)
  })
})
