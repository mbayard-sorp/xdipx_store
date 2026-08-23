import { describe, it, expect } from 'vitest'
import { deriveGateStatus, findingToStored, panelRows } from './social-gate-status'

describe('deriveGateStatus', () => {
  it('is null when nothing was found (clean, awaiting the agent PASS)', () => {
    expect(deriveGateStatus([])).toBeNull()
  })
  it('block wins over hold and revise', () => {
    expect(deriveGateStatus([
      { check: 'a', verdict: 'revise' }, { check: 'b', verdict: 'hold' }, { check: 'c', verdict: 'block' },
    ])).toBe('block')
  })
  it('hold wins over revise', () => {
    expect(deriveGateStatus([{ check: 'a', verdict: 'revise' }, { check: 'b', verdict: 'hold' }])).toBe('hold')
  })
  it('revise when only warnings', () => {
    expect(deriveGateStatus([{ check: 'a', verdict: 'revise' }])).toBe('revise')
  })
  it('never derives pass from findings', () => {
    expect(deriveGateStatus([{ check: 'a', verdict: 'pass' }])).toBe('revise')
  })
})

describe('findingToStored', () => {
  it('maps warn to revise and keeps the detail as the note', () => {
    expect(findingToStored({ check: 'caption-sale', severity: 'warn', detail: 'd' }))
      .toEqual({ check: 'caption-sale', verdict: 'revise', note: 'd' })
    expect(findingToStored({ check: 'x', severity: 'block', detail: 'd' }).verdict).toBe('block')
    expect(findingToStored({ check: 'x', severity: 'hold', detail: 'd' }).verdict).toBe('hold')
  })
})

describe('panelRows', () => {
  it('lists every named check, passing when absent, and folds sub-slugs into their family', () => {
    const rows = panelRows([{ check: 'caption-sale-discount', verdict: 'block', note: 'says 20% off' }])
    const sale = rows.find(r => r.check === 'caption-sale')
    expect(sale?.verdict).toBe('block')
    expect(sale?.note).toContain('20% off')
    expect(rows.find(r => r.check === 'image-provenance')?.verdict).toBe('pass')
  })
  it('appends unknown checks rather than dropping them', () => {
    const rows = panelRows([{ check: 'something-new', verdict: 'hold' }])
    expect(rows.some(r => r.check === 'something-new' && r.verdict === 'hold')).toBe(true)
  })
})
