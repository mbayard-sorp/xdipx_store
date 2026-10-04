import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const dbState = vi.hoisted(() => ({
  selects: [] as unknown[][],
  updates: [] as Array<Record<string, unknown>>,
}))

vi.mock('~/lib/db.server', () => {
  const thenable = (rows: unknown[]) => {
    const t: Record<string, unknown> = {
      from: () => t,
      where: () => t,
      then: (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res),
    }
    return t
  }
  return {
    db: {
      select: () => thenable(dbState.selects.shift() ?? []),
      update: () => ({
        set: (v: Record<string, unknown>) => {
          dbState.updates.push(v)
          return { where: () => Promise.resolve() }
        },
      }),
    },
  }
})
vi.mock('~/lib/feed-processor.server', () => ({ getPipelineSetting: vi.fn(async () => null) }))

import {
  AdMetricsError, buildCreativeIndex, buildSampleFeed, computeBreakEven, decodeCsvBuffer, extractOrderUtmContent,
  foldAttribution, formatRoas, importMetaInsights, MetricsParseError, netRevenueCents, parseDay, parseMetricsCsv, planImport,
  replayPaused, resolveCreativeId, rollupDaily, sampleDataset, sampleFirings, sumWindow, SAMPLE_END_DAY,
  utmContentOfUrl,
} from '~/lib/ad-metrics.server'

const FIX = join(__dirname, '__fixtures__', 'ad-metrics')
const googleBuf = () => new Uint8Array(readFileSync(join(FIX, 'google-ads-report-utf16le.csv')))
const shopBuf = () => new Uint8Array(readFileSync(join(FIX, 'shop-campaigns-export.csv')))

const SPEC_URL = 'https://xdipx.com/products/naturals-h2o?utm_source=google&utm_medium=cpc&utm_content=sample-spec-sheet-google'
const index = buildCreativeIndex([
  { id: 7, externalAdId: null, exportPayload: { destination_url: SPEC_URL } },
  { id: 12, externalAdId: '120330044', exportPayload: null },
])

describe('Google Ads UTF-16 report', () => {
  it('decodes UTF-16LE with a BOM and finds the header under the title lines', () => {
    expect(decodeCsvBuffer(googleBuf()).encoding).toBe('utf-16le')
    const p = parseMetricsCsv(googleBuf(), 'google')
    expect(p.encoding).toBe('utf-16le')
    expect(p.delimiter).toBe('\t')
    expect(p.headerLine).toBe(3)
    expect(p.columns).toContain('Final URL')
    expect(p.rows).toHaveLength(4)
  })

  it('skips the totals row and says so', () => {
    const p = parseMetricsCsv(googleBuf(), 'google')
    expect(p.skipped).toEqual([{ line: 8, reason: 'totals row' }])
    expect(p.rows.some(r => r.spendCents === 106135)).toBe(false)
  })

  it('parses money, thousands separators and dashes', () => {
    const p = parseMetricsCsv(googleBuf(), 'google')
    const last = p.rows[3]!
    expect(last.day).toBe('2026-10-03')
    expect(last.spendCents).toBe(103400)
    expect(last.impressions).toBe(1204)
    expect(last.clicks).toBe(31)
    const dash = p.rows[1]!
    expect(dash.platformRevenueCents).toBe(0)
    expect(p.rows[2]!.platformRevenueCents).toBe(3300)
  })

  it('reads utm_content out of the final URL and keeps the ad id', () => {
    const p = parseMetricsCsv(googleBuf(), 'google')
    expect(p.rows[0]!.utmContent).toBe('sample-spec-sheet-google')
    expect(p.rows[0]!.adId).toBe('9001')
  })

  it('also reads the same report saved as UTF-8', () => {
    const text = decodeCsvBuffer(googleBuf()).text
    const p = parseMetricsCsv(new TextEncoder().encode(text), 'google')
    expect(p.encoding).toBe('utf-8')
    expect(p.rows).toHaveLength(4)
  })

  it('throws a plain error when no header row exists', () => {
    expect(() => parseMetricsCsv(new TextEncoder().encode('hello\nworld\n'), 'google')).toThrow(MetricsParseError)
  })
})

describe('Shop Campaigns UTF-8 export', () => {
  it('detects the header after the preamble and skips the totals row', () => {
    const p = parseMetricsCsv(shopBuf(), 'shop')
    expect(p.encoding).toBe('utf-8')
    expect(p.delimiter).toBe(',')
    expect(p.headerLine).toBe(3)
    expect(p.rows).toHaveLength(3)
    expect(p.skipped).toHaveLength(1)
    expect(p.rows[0]).toMatchObject({ day: '2026-09-30', spendCents: 525, impressions: 1310, clicks: 22, campaign: 'Shop Campaign, Bestsellers' })
  })
})

describe('planImport', () => {
  it('matches by utm_content from the final URL and sends the rest to account rows, listed', () => {
    const plan = planImport(parseMetricsCsv(googleBuf(), 'google'), index)
    expect(plan.matchedRows).toBe(3)
    expect(plan.creativeRows).toEqual([
      { creativeId: 7, day: '2026-10-01', platform: 'google', spendCents: 1240, impressions: 412, clicks: 9 },
      { creativeId: 7, day: '2026-10-02', platform: 'google', spendCents: 1185, impressions: 388, clicks: 8 },
      { creativeId: 7, day: '2026-10-03', platform: 'google', spendCents: 103400, impressions: 1204, clicks: 31 },
    ])
    expect(plan.unmatched).toHaveLength(1)
    expect(plan.unmatched[0]!.adId).toBe('9002')
    expect(plan.accountRows).toEqual([{ day: '2026-10-01', platform: 'google', spendCents: 310, impressions: 120, clicks: 2 }])
  })

  it('lands unmatched Shop Campaigns rows as account-level days, never dropped', () => {
    const plan = planImport(parseMetricsCsv(shopBuf(), 'shop'), index)
    expect(plan.matchedRows).toBe(0)
    expect(plan.unmatched).toHaveLength(3)
    expect(plan.accountRows.map(r => r.day)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02'])
    expect(plan.accountRows.reduce((s, r) => s + r.spendCents, 0)).toBe(1915)
  })

  it('sums several rows on one creative and day', () => {
    const parsed = parseMetricsCsv(googleBuf(), 'google')
    const dup = { ...parsed, rows: [parsed.rows[0]!, { ...parsed.rows[0]!, line: 99 }] }
    const plan = planImport(dup, index)
    expect(plan.creativeRows).toHaveLength(1)
    expect(plan.creativeRows[0]!.spendCents).toBe(2480)
  })
})

describe('parseDay', () => {
  it.each([
    ['2026-10-01', '2026-10-01'],
    ['10/1/2026', '2026-10-01'],
    ['Oct 1, 2026', '2026-10-01'],
    ['Thursday, October 1, 2026', '2026-10-01'],
    ['2026-10-01T04:00:00Z', '2026-10-01'],
  ])('%s', (raw, want) => expect(parseDay(raw)).toBe(want))

  it.each(['Total: account', '', '--', 'Feb 31, 2026'])('rejects %j', raw => expect(parseDay(raw)).toBeNull())
})

describe('creative resolver', () => {
  it('matches utm_content, external ad id and creative id, case-insensitively', () => {
    expect(resolveCreativeId(index, ['SAMPLE-SPEC-SHEET-GOOGLE'])).toBe(7)
    expect(resolveCreativeId(index, ['120330044'])).toBe(12)
    expect(resolveCreativeId(index, ['12'])).toBe(12)
    expect(resolveCreativeId(index, ['nope', null, undefined])).toBeNull()
  })

  it('keeps the first owner of a duplicated key', () => {
    const dup = buildCreativeIndex([
      { id: 1, externalAdId: 'x', exportPayload: null },
      { id: 2, externalAdId: 'x', exportPayload: null },
    ])
    expect(resolveCreativeId(dup, ['x'])).toBe(1)
  })

  it('parses utm_content from a URL', () => {
    expect(utmContentOfUrl(SPEC_URL)).toBe('sample-spec-sheet-google')
    expect(utmContentOfUrl('https://xdipx.com/?utm_source=x')).toBeNull()
    expect(utmContentOfUrl(null)).toBeNull()
  })
})

describe('order attribution resolver', () => {
  it('prefers the note attribute, then order_attribution, then landing_site, then the journey', () => {
    expect(extractOrderUtmContent({
      customAttributes: [{ key: '_utm_content', value: 'from-attr' }],
      storedUtmContent: 'from-table',
    })).toEqual({ value: 'from-attr', source: 'note_attribute' })
    expect(extractOrderUtmContent({ storedUtmContent: 'from-table', storedLandingSite: '/?utm_content=landing' }))
      .toEqual({ value: 'from-table', source: 'order_attribution' })
    expect(extractOrderUtmContent({ storedLandingSite: '/products/x?utm_content=landing' }))
      .toEqual({ value: 'landing', source: 'landing_site' })
    expect(extractOrderUtmContent({ journeyLandingPages: [null, 'https://xdipx.com/?utm_content=journey'] }))
      .toEqual({ value: 'journey', source: 'journey' })
  })

  it('returns null when nothing carries utm_content', () => {
    expect(extractOrderUtmContent({ customAttributes: [{ key: '_utm_source', value: 'chatgpt.com' }], storedLandingSite: '/' })).toBeNull()
    expect(extractOrderUtmContent({})).toBeNull()
  })

  it('folds orders per creative and day, and lists what it could not place', () => {
    const f = foldAttribution([
      { order: '#1010', day: '2026-10-01', utmContent: 'sample-spec-sheet-google', source: 'note_attribute', netRevenueCents: 2700 },
      { order: '#1011', day: '2026-10-01', utmContent: '7', source: 'order_attribution', netRevenueCents: 1500 },
      { order: '#1012', day: '2026-10-02', utmContent: 'sample-spec-sheet-google', source: 'journey', netRevenueCents: 3000 },
      { order: '#1013', day: '2026-10-02', utmContent: 'typo-ad', source: 'note_attribute', netRevenueCents: 900 },
      { order: '#1014', day: '2026-10-02', utmContent: null, source: null, netRevenueCents: 4100 },
    ], index)
    expect([...f.rows.values()]).toEqual([
      { creativeId: 7, day: '2026-10-01', orders: 2, netRevenueCents: 4200 },
      { creativeId: 7, day: '2026-10-02', orders: 1, netRevenueCents: 3000 },
    ])
    expect(f.attributed).toBe(3)
    expect(f.noUtmContent).toBe(1)
    expect(f.unmatched).toEqual([{ order: '#1013', utmContent: 'typo-ad', source: 'note_attribute' }])
    expect(f.bySource).toEqual({ note_attribute: 1, order_attribution: 1, landing_site: 0, journey: 1 })
  })
})

describe('net revenue and break-even', () => {
  it('uses the subtotal and ignores shipping and tax', () => {
    expect(netRevenueCents({ subtotal: '40.00', totalShipping: '5.00', totalTax: '3.20', totalPrice: '48.20' })).toBe(4000)
  })

  it('derives the subtotal as total minus shipping minus tax when it is missing', () => {
    expect(netRevenueCents({ totalPrice: '48.20', totalShipping: '5.00', totalTax: '3.20' })).toBe(4000)
    expect(netRevenueCents({ totalPrice: '3.00', totalShipping: '5.00' })).toBe(0)
  })

  it('computes break-even CPA and ROAS from AOV and margin', () => {
    const be = computeBreakEven(3300, 45)
    expect(be.cpaCents).toBe(1485)
    expect(formatRoas(be.roas)).toBe('2.2x')
  })

  it('falls back to defaults for nonsense inputs', () => {
    const be = computeBreakEven(0, 0)
    expect(be.aovCents).toBe(3300)
    expect(be.marginPct).toBe(45)
  })
})

describe('rollupDaily', () => {
  it('writes only the ad_spend column, in dollars', async () => {
    dbState.selects = [[{ spend: 4200 }], [{ day: '2026-10-02', adSpend: '0.00' }]]
    dbState.updates = []
    const r = await rollupDaily('2026-10-02')
    expect(r).toEqual({ day: '2026-10-02', spendCents: 4200, written: true })
    expect(dbState.updates).toEqual([{ adSpend: '42.00' }])
  })

  it('reports a day with no summary row instead of inventing one', async () => {
    dbState.selects = [[{ spend: 500 }], []]
    dbState.updates = []
    expect(await rollupDaily('2026-10-03')).toEqual({ day: '2026-10-03', spendCents: 500, written: false, reason: 'no_summary_row' })
    expect(dbState.updates).toEqual([])
  })

  it('does not rewrite an unchanged value', async () => {
    dbState.selects = [[{ spend: 4200 }], [{ day: '2026-10-02', adSpend: '42.00' }]]
    dbState.updates = []
    expect((await rollupDaily('2026-10-02')).reason).toBe('unchanged')
    expect(dbState.updates).toEqual([])
  })
})

describe('sample dataset', () => {
  const be = computeBreakEven(3300, 45)

  it('is eight creatives of 14 days, deterministic, and flagged sample', () => {
    const a = sampleDataset()
    expect(a.sample).toBe(true)
    expect(a.creatives).toHaveLength(8)
    for (const c of a.creatives) expect(c.days).toHaveLength(14)
    expect(sampleDataset()).toEqual(a)
    expect(a.creatives[0]!.days[13]!.day).toBe(SAMPLE_END_DAY)
  })

  it('fires R1, R2, R5 and R8 on at least one row each, and nothing on the healthy rows', () => {
    const fired: Record<string, string[]> = {}
    for (const c of sampleDataset().creatives) {
      for (const f of sampleFirings(c, be)) (fired[f.ruleId] ??= []).push(c.key)
    }
    expect(fired['R1']).toEqual(['S1'])
    expect(fired['R2']).toEqual(['S2'])
    expect(fired['R5']).toEqual(['S3'])
    expect(fired['R8']).toEqual(['S4'])
    expect(Object.keys(fired).sort()).toEqual(['R1', 'R2', 'R5', 'R8'])
  })

  it('builds a labelled feed: every row sample, recommendations first, paused row last of the active', () => {
    const feed = buildSampleFeed({ lookbackDays: 7, breakEven: be })
    expect(feed.sample).toBe(true)
    expect(feed.rows.every(r => r.sample)).toBe(true)
    expect(feed.rows.map(r => r.recommendation).slice(0, 4)).toEqual(['pause', 'pause', 'scale', 'refresh'])
    expect(feed.needsAction).toBe(4)
    expect(feed.rows.find(r => r.key === 'sample:S8')!.recommendation).toBe('paused')
    expect(feed.rows.find(r => r.key === 'sample:S3')!.firing!.sentence).toMatch(/^Scale: \d\.\dx net ROAS on 4 orders over 7d, R5$/)
    expect(feed.band.spendCents).toBeGreaterThan(0)
  })

  it('windows the totals by lookback', () => {
    const c = sampleDataset().creatives[0]!
    expect(sumWindow(c.days, SAMPLE_END_DAY, 7).spendCents).toBe(4200)
    expect(sumWindow(c.days, SAMPLE_END_DAY, 14).spendCents).toBe(8400)
  })

  it('honours an owner pause and a resolved recommendation', () => {
    const f = buildSampleFeed({ lookbackDays: 7, breakEven: be, pausedKeys: new Set(['S1']), resolvedKeys: new Set(['S3']) })
    expect(f.rows.find(r => r.key === 'sample:S1')!.recommendation).toBe('paused')
    expect(f.rows.find(r => r.key === 'sample:S3')!.recommendation).toBe('healthy')
  })
})

describe('replayPaused', () => {
  const ev = (id: number, action: string, extra: Record<string, unknown> = {}) => ({
    id, ruleId: 'MAN', action, creativeId: 5, appliedAt: new Date(), detail: null as unknown, ...extra,
  })

  it('replays pause and resume in order and skips undone rows', () => {
    expect(replayPaused([ev(1, 'pause')]).paused.has('5')).toBe(true)
    expect(replayPaused([ev(1, 'pause'), ev(2, 'undo', { detail: { undoes: 1 } })]).paused.has('5')).toBe(false)
    const both = replayPaused([ev(1, 'pause'), ev(2, 'resume')])
    expect(both.paused.has('5')).toBe(false)
    expect(both.resumed.has('5')).toBe(true)
  })

  it('keys sample rows by their sample key and tracks resolved recommendations', () => {
    const r = replayPaused([
      ev(1, 'pause', { creativeId: null, detail: { sample: true, key: 'S1' } }),
      ev(2, 'scale_up', { creativeId: null, detail: { sample: true, key: 'S3' } }),
    ])
    expect(r.paused.has('S1')).toBe(true)
    expect(r.resolved.has('S3')).toBe(true)
  })

  it('ignores recommendations nobody applied', () => {
    expect(replayPaused([ev(1, 'pause', { appliedAt: null })]).paused.size).toBe(0)
  })
})

describe('importMetaInsights', () => {
  it('is a named stub that throws not_configured', async () => {
    await expect(importMetaInsights()).rejects.toMatchObject({ code: 'not_configured' })
    await expect(importMetaInsights()).rejects.toBeInstanceOf(AdMetricsError)
  })
})
