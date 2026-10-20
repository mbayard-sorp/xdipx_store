import { describe, expect, it, vi } from 'vitest'
import { pageKey, pageOwner, runPagerChecks, type PagerStore, type RejectedEntity } from './pager.server'

const NOW = new Date('2026-10-19T15:00:00Z')

function store(over: Partial<{ rejected: RejectedEntity[]; spend: number; leads: { value: number; detail: Record<string, unknown> | null } | null }> = {}): PagerStore {
  return {
    rejectedEntities: async () => over.rejected ?? [],
    spendForDay: async () => over.spend ?? 0,
    latestLeadEvents: async () => (over.leads === undefined ? { value: 0, detail: { ledger: false } } : over.leads),
  }
}

function filer() {
  return vi.fn(async (_input: { dedupeKey: string; title: string; category?: string | null }) => ({ id: 1, created: true, reopened: false }))
}

const run = (s: PagerStore, file: ReturnType<typeof filer>, capCents = 2000) =>
  runPagerChecks({ store: s, fileBlocker: file, dailyCapCents: async () => capCents, now: () => NOW })

describe('pageOwner', () => {
  it('files one decision blocker keyed by the reason', async () => {
    const file = filer()
    const r = await pageOwner('spend-1.5x 2026-10-19', { title: 't', detail: 'd' }, { fileBlocker: file })
    expect(r).toEqual({ key: 'ads-page-spend-1-5x-2026-10-19', filed: true, id: 1 })
    expect(file).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: 'ads-page-spend-1-5x-2026-10-19', category: 'decision', priority: 1 }))
  })

  it('never throws when filing fails', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await pageOwner('x', { title: 't', detail: 'd' }, { fileBlocker: async () => { throw new Error('db down') } })
    err.mockRestore()
    expect(r).toMatchObject({ filed: false, error: expect.stringContaining('db down') })
  })

  it('keeps a key it is given', () => {
    expect(pageKey('rejected-meta-123')).toBe('ads-page-rejected-meta-123')
  })
})

describe('runPagerChecks', () => {
  it('a clean state files nothing', async () => {
    const file = filer()
    const r = await run(store({ spend: 1000 }), file)
    expect(file).not.toHaveBeenCalled()
    expect(r.pages).toEqual([])
    expect(r.skipped.join(' ')).toMatch(/account_status/)
    expect(r.skipped.join(' ')).toMatch(/discount-code redemptions/)
  })

  it('pages once per rejected or restricted entity, keyed by entity', async () => {
    const file = filer()
    await run(store({ rejected: [
      { platform: 'meta', level: 'ad', externalId: '111', name: 'img07', effectiveStatus: 'DISAPPROVED' },
      { platform: 'meta', level: 'adset', externalId: '222', name: null, effectiveStatus: 'WITH_ISSUES' },
    ] }), file)
    const keys = file.mock.calls.map(c => c[0].dedupeKey)
    expect(keys).toEqual(['ads-page-rejected-meta-111', 'ads-page-rejected-meta-222'])
    expect(file.mock.calls[0]![0].title).toBe('Ads: meta marked ad img07 DISAPPROVED')
  })

  it('pages once when today\'s spend reaches 1.5x the daily cap, and not below it', async () => {
    const below = filer()
    await run(store({ spend: 2999 }), below)
    expect(below).not.toHaveBeenCalled()
    const at = filer()
    await run(store({ spend: 3000 }), at)
    expect(at).toHaveBeenCalledTimes(1)
    expect(at.mock.calls[0]![0].dedupeKey).toBe('ads-page-spend-1-5x-2026-10-19')
  })

  it('pages on no Lead event in 6h over $5 of spend, only when a Lead ledger exists', async () => {
    const noLedger = filer()
    const r = await run(store({ spend: 1200, leads: { value: 0, detail: { ledger: false } } }), noLedger)
    expect(noLedger).not.toHaveBeenCalled()
    expect(r.skipped.join(' ')).toMatch(/lead_events_6h has no ledger yet/)

    const withLedger = filer()
    await run(store({ spend: 1200, leads: { value: 0, detail: { ledger: true } } }), withLedger)
    expect(withLedger.mock.calls.map(c => c[0].dedupeKey)).toEqual(['ads-page-no-lead-event-2026-10-19'])

    const underFloor = filer()
    await run(store({ spend: 500, leads: { value: 0, detail: { ledger: true } } }), underFloor)
    expect(underFloor).not.toHaveBeenCalled()

    const leadsArrive = filer()
    await run(store({ spend: 1200, leads: { value: 3, detail: { ledger: true } } }), leadsArrive)
    expect(leadsArrive).not.toHaveBeenCalled()
  })
})
