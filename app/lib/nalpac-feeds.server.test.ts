// Regression coverage for ticket #8794: fetchAllNalpacFeeds() used to seed
// its base snapshot map from the main (+ sale) feed only, and merely SET
// inNewFeed/inTop100Feed booleans on a snapshot that already existed. A SKU
// present only in the new or top100 feed never got a snapshot at all, so
// collapseMasters could never resolve it and approveAndImport failed every
// one with "master no longer in feed" — permanent queue rot on real,
// in-stock, sellable products (the Together Toy / NudeFit cluster).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./kv.server', () => ({
  kvGet: vi.fn(async () => null),
  kvSet: vi.fn(async () => {}),
}))

function csv(rows: Record<string, string>[]): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0]!)
  const lines = [headers.join(',')]
  for (const row of rows) lines.push(headers.map(h => row[h] ?? '').join(','))
  return lines.join('\n')
}

const MAIN_ROW = {
  SKU: 'MAIN-1', Vendor: 'Acme', 'Product Title': 'Main Widget',
  MSRP: '50.00', Wholesale: '20.00', MAP: '35.00', 'Total qty available': '10',
}

// A SKU that exists ONLY in the new-products feed — never in main or sale —
// same shape as the Together Toy / NudeFit cluster in the ticket.
const NEW_ONLY_ROW = {
  SKU: 'NEW-ONLY-1', Vendor: 'Together Toy', 'Product Title': 'NudeFit Realistic',
  MSRP: '89.99', Wholesale: '40.00', MAP: '70.00', 'Total qty available': '5',
}

const TOP100_ONLY_ROW = {
  SKU: 'TOP100-ONLY-1', Vendor: 'Evolved', 'Product Title': 'Selopa',
  MSRP: '60.00', Wholesale: '25.00', MAP: '45.00', 'Total qty available': '8',
}

function mockFetchByFeed(feeds: {
  main?: Record<string, string>[]
  sale?: Record<string, string>[]
  new?: Record<string, string>[]
  top100?: Record<string, string>[]
}) {
  return vi.fn(async (url: string | URL) => {
    const u = String(url)
    const pick = (name: keyof typeof feeds, file: string) =>
      u.includes(file) ? { ok: true, text: async () => csv(feeds[name] ?? []) } : null
    const match =
      pick('main', 'nal-product-attributes-main') ??
      pick('sale', 'nal-on-sale') ??
      pick('new', 'nal-new-products') ??
      pick('top100', 'nal-top-100')
    if (!match) throw new Error(`unexpected feed url in test: ${u}`)
    return match as Response
  })
}

describe('fetchAllNalpacFeeds', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('creates a snapshot for a SKU that exists only in the new-products feed', async () => {
    global.fetch = mockFetchByFeed({
      main: [MAIN_ROW],
      sale: [],
      new: [NEW_ONLY_ROW],
      top100: [],
    }) as unknown as typeof fetch

    const { fetchAllNalpacFeeds } = await import('./nalpac-feeds.server')
    const result = await fetchAllNalpacFeeds({ force: true })

    const snap = result.snapshots.get('NEW-ONLY-1')
    expect(snap).toBeDefined()
    expect(snap!.inNewFeed).toBe(true)
    expect(snap!.inTop100Feed).toBe(false)
    expect(snap!.vendor).toBe('Together Toy')
    expect(snap!.productTitle).toBe('NudeFit Realistic')
    expect(snap!.msrp).toBe(89.99)
  })

  it('creates a snapshot for a SKU that exists only in the top100 feed', async () => {
    global.fetch = mockFetchByFeed({
      main: [MAIN_ROW],
      sale: [],
      new: [],
      top100: [TOP100_ONLY_ROW],
    }) as unknown as typeof fetch

    const { fetchAllNalpacFeeds } = await import('./nalpac-feeds.server')
    const result = await fetchAllNalpacFeeds({ force: true })

    const snap = result.snapshots.get('TOP100-ONLY-1')
    expect(snap).toBeDefined()
    expect(snap!.inTop100Feed).toBe(true)
    expect(snap!.inNewFeed).toBe(false)
    expect(snap!.vendor).toBe('Evolved')
  })

  it('does not duplicate or overwrite a snapshot already present from main', async () => {
    global.fetch = mockFetchByFeed({
      main: [MAIN_ROW],
      sale: [],
      new: [MAIN_ROW],
      top100: [],
    }) as unknown as typeof fetch

    const { fetchAllNalpacFeeds } = await import('./nalpac-feeds.server')
    const result = await fetchAllNalpacFeeds({ force: true })

    expect(result.snapshots.size).toBe(1)
    const snap = result.snapshots.get('MAIN-1')
    expect(snap!.inNewFeed).toBe(true)
    expect(snap!.raw.mainRow).toBeDefined()
  })

  it('flags a new-feed-exclusive SKU that is also in top100', async () => {
    global.fetch = mockFetchByFeed({
      main: [MAIN_ROW],
      sale: [],
      new: [NEW_ONLY_ROW],
      top100: [NEW_ONLY_ROW],
    }) as unknown as typeof fetch

    const { fetchAllNalpacFeeds } = await import('./nalpac-feeds.server')
    const result = await fetchAllNalpacFeeds({ force: true })

    const snap = result.snapshots.get('NEW-ONLY-1')
    expect(snap!.inNewFeed).toBe(true)
    expect(snap!.inTop100Feed).toBe(true)
  })
})
