import { describe, it, expect } from 'vitest'
import { planCollapse, type OosRow } from './collapse-oos-sustained-duplicates'

// The exact split the ticket documents: an 08-24 colon row (pre-#896, stored
// raw) and an 08-26 hyphen row (post-#896, canonicalized) for the same SKU.
function row(over: Partial<OosRow> & Pick<OosRow, 'id' | 'dedupeKey'>): OosRow {
  return { status: 'approved', createdAt: new Date('2026-08-26T08:00:00Z'), ...over }
}

describe('planCollapse (#5590)', () => {
  it('collapses a colon/hyphen pair onto the canonical (hyphen) survivor', () => {
    const plans = planCollapse([
      row({ id: 5188, dedupeKey: 'inv-oos-sustained:21453', createdAt: new Date('2026-08-24T08:00:00Z') }),
      row({ id: 5561, dedupeKey: 'inv-oos-sustained-21453', createdAt: new Date('2026-08-26T08:00:00Z') }),
    ])
    expect(plans).toHaveLength(1)
    const [p] = plans
    expect(p!.canonicalKey).toBe('inv-oos-sustained-21453')
    // The hyphen row is the survivor purely because its stored key is canonical,
    // not because it is newer.
    expect(p!.survivorId).toBe(5561)
    expect(p!.rekeySurvivor).toBe(false)
    expect(p!.retire).toEqual([{ id: 5188, key: 'inv-oos-sustained:21453' }])
  })

  it('keeps the canonical row even when the colon straggler is newer', () => {
    const plans = planCollapse([
      row({ id: 10, dedupeKey: 'inv-oos-sustained-99', createdAt: new Date('2026-08-20T08:00:00Z') }),
      row({ id: 11, dedupeKey: 'inv-oos-sustained:99', createdAt: new Date('2026-08-26T08:00:00Z') }),
    ])
    expect(plans[0]!.survivorId).toBe(10)
    expect(plans[0]!.retire.map(r => r.id)).toEqual([11])
  })

  it('rekeys a lone colon row to canonical so it never spawns a hyphen twin', () => {
    const plans = planCollapse([
      row({ id: 42, dedupeKey: 'inv-oos-sustained:77' }),
    ])
    expect(plans).toHaveLength(1)
    expect(plans[0]!.survivorId).toBe(42)
    expect(plans[0]!.rekeySurvivor).toBe(true)
    expect(plans[0]!.canonicalKey).toBe('inv-oos-sustained-77')
    expect(plans[0]!.retire).toEqual([])
  })

  it('leaves a lone already-canonical row untouched', () => {
    expect(planCollapse([row({ id: 1, dedupeKey: 'inv-oos-sustained-55' })])).toEqual([])
  })

  it('ignores closed rows (dismissed/applied), so a resolved SKU is not resurrected', () => {
    const plans = planCollapse([
      row({ id: 1, dedupeKey: 'inv-oos-sustained:88', status: 'dismissed', createdAt: new Date('2026-08-24T08:00:00Z') }),
      row({ id: 2, dedupeKey: 'inv-oos-sustained-88', status: 'approved', createdAt: new Date('2026-08-26T08:00:00Z') }),
    ])
    // Only one OPEN row for SKU 88, and it is already canonical: nothing to do.
    expect(plans).toEqual([])
  })

  it('handles several SKUs at once and never crosses them', () => {
    const plans = planCollapse([
      row({ id: 5188, dedupeKey: 'inv-oos-sustained:21453', createdAt: new Date('2026-08-24T08:00:00Z') }),
      row({ id: 5561, dedupeKey: 'inv-oos-sustained-21453', createdAt: new Date('2026-08-26T08:00:00Z') }),
      row({ id: 5189, dedupeKey: 'inv-oos-sustained:21984', createdAt: new Date('2026-08-24T08:00:00Z') }),
      row({ id: 5562, dedupeKey: 'inv-oos-sustained-21984', createdAt: new Date('2026-08-26T08:00:00Z') }),
    ])
    expect(plans.map(p => [p.canonicalKey, p.survivorId, p.retire.map(r => r.id)])).toEqual([
      ['inv-oos-sustained-21453', 5561, [5188]],
      ['inv-oos-sustained-21984', 5562, [5189]],
    ])
  })

  it('does not touch unrelated dedupe namespaces', () => {
    expect(planCollapse([
      row({ id: 1, dedupeKey: 'restock:some-handle' }),
      row({ id: 2, dedupeKey: 'logmon-abc' }),
    ])).toEqual([])
  })
})
