// Unit tests for pricing-rules.server.ts (pure functions only — DB mocked out).
import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock DB and dependencies before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('./db.server', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}))

vi.mock('../../db/schema', () => ({
  pricingRules:          { scopeLevel: 'scope_level', scopeId: 'scope_id' },
  pricingProductTypeMap: { productType: 'product_type', subGroupId: 'sub_group_id' },
  pricingSubGroups:      { id: 'id', groupId: 'group_id', sortOrder: 'sort_order' },
  pricingGroups:         { id: 'id', usesClearanceLadder: 'uses_clearance_ladder' },
  pipelineSettings:      { key: 'key', value: 'value' },
}))

import { buildRationale } from './pricing-rules.server'

// ---------------------------------------------------------------------------
// buildRationale tests
// ---------------------------------------------------------------------------

describe('buildRationale', () => {
  it('returns no-change string when status is skipped_no_change', () => {
    const r = buildRationale({
      oldCost: 10, newCost: 10, oldSell: 24.99, newSell: 24.99,
      status: 'skipped_no_change', trigger: 'batch',
      mapHeld: false, marginAfter: 0.6,
    })
    expect(r).toContain('no action')
  })

  it('returns discontinued clearance string with correct tier', () => {
    const r = buildRationale({
      oldCost: 10, newCost: 10, oldSell: 30, newSell: 14.96,
      status: 'auto_applied', trigger: 'batch',
      daysDisc: 47, mapHeld: false, marginAfter: 0.33,
    })
    expect(r).toContain('Discontinued day 47')
    expect(r).toContain('25%')
    expect(r).toContain('$14.96')
  })

  it('returns velocity: slow string', () => {
    const r = buildRationale({
      oldCost: 10, newCost: 10, oldSell: 36.99, newSell: 32.99,
      status: 'auto_applied', trigger: 'batch',
      velocityBucket: 'slow', mapHeld: false, marginAfter: 0.70,
    })
    expect(r).toContain('slow')
    expect(r).toContain('-5pp')
    expect(r).toContain('$32.99')
  })

  it('returns velocity: dead string', () => {
    const r = buildRationale({
      oldCost: 10, newCost: 10, oldSell: 36.99, newSell: 28.99,
      status: 'auto_applied', trigger: 'batch',
      velocityBucket: 'dead', mapHeld: false, marginAfter: 0.65,
    })
    expect(r).toContain('dead')
    expect(r).toContain('-10pp')
  })

  it('returns queued: threshold exceeded string (drop)', () => {
    const r = buildRationale({
      oldCost: 10, newCost: 10, oldSell: 30, newSell: 22,
      status: 'pending', trigger: 'webhook',
      mapHeld: false, marginAfter: 0.55,
      deltaPct: -0.267, approvalThreshold: 0.05,
    })
    expect(r).toContain('Queued')
    expect(r).toContain('27%')
    expect(r).toContain('5%')
    expect(r).toContain('price drop')
  })

  it('labels a queued increase as an increase, not a drop', () => {
    // Below-MAP product raised to MAP: $98.99 -> $199.00 is a +101% increase.
    const r = buildRationale({
      oldCost: 54.45, newCost: 54.45, oldSell: 98.99, newSell: 199.0,
      status: 'pending', trigger: 'batch',
      mapHeld: false, marginAfter: 0.73,
      deltaPct: 1.01, approvalThreshold: 0.6,
    })
    expect(r).toContain('Queued')
    expect(r).toContain('101%')
    expect(r).toContain('price increase')
    expect(r).not.toContain('price drop')
  })

  it('returns MAP-held cost-change string', () => {
    const r = buildRationale({
      oldCost: 10, newCost: 11.20, oldSell: 24.99, newSell: 24.99,
      status: 'auto_applied', trigger: 'webhook',
      mapHeld: true, map: 24.99, marginAfter: 0.55,
    })
    expect(r).toContain('MAP')
    expect(r).toContain('$24.99')
  })

  it('returns generic auto_applied string as fallback', () => {
    const r = buildRationale({
      oldCost: 10, newCost: 10, oldSell: 20, newSell: 21,
      status: 'auto_applied', trigger: 'manual',
      mapHeld: false, marginAfter: 0.52,
    })
    expect(r).toContain('Auto-applied')
    expect(r).toContain('$20.00')
    expect(r).toContain('$21.00')
  })
})
