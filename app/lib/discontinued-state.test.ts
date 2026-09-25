import { describe, expect, it } from 'vitest'
import { classifyFeedAbsence } from './discontinued-state'

describe('classifyFeedAbsence', () => {
  const base = { flagged: new Set<string>(), graceDays: 3 }

  it('starts the ledger on the first missed day and does not discontinue inside the grace window', () => {
    const r = classifyFeedAbsence({ ...base, carried: ['A', 'B'], present: new Set(['B']), ledger: {}, today: '2026-09-25' })
    expect(r.ledger).toEqual({ A: '2026-09-25' })
    expect(r.discontinued).toEqual([])
    expect(r.pending).toBe(1)
  })

  it('discontinues after graceDays consecutive absences, dated from the first miss', () => {
    const r = classifyFeedAbsence({ ...base, carried: ['A'], present: new Set(), ledger: { A: '2026-09-22' }, today: '2026-09-25' })
    expect(r.discontinued).toEqual([{ sku: 'A', since: '2026-09-22' }])
  })

  it('clears the ledger and reports a return when the SKU is back in the feed', () => {
    const r = classifyFeedAbsence({ ...base, carried: ['A'], present: new Set(['A']), ledger: { A: '2026-09-20' }, today: '2026-09-25' })
    expect(r.ledger).toEqual({})
    expect(r.returned).toEqual(['A'])
  })

  it('a feed-flagged SKU is discontinued immediately even though present', () => {
    const r = classifyFeedAbsence({ ...base, flagged: new Set(['A']), carried: ['A'], present: new Set(['A']), ledger: {}, today: '2026-09-25' })
    expect(r.discontinued).toEqual([{ sku: 'A', since: '2026-09-25' }])
  })

  it('drops ledger entries for SKUs no longer carried', () => {
    const r = classifyFeedAbsence({ ...base, carried: ['A'], present: new Set(['A']), ledger: { Z: '2026-09-01' }, today: '2026-09-25' })
    expect(r.ledger).toEqual({})
  })
})
