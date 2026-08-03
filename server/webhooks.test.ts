import { describe, it, expect } from 'vitest'
import { isRestockCrossing } from './webhooks'

// Guards the inventory webhook's back-in-stock branch: a notification must fire
// only on a genuine sold-out -> in-stock transition, never on routine positive
// updates or on the first time an item is ever observed.

describe('isRestockCrossing', () => {
  it('fires when a known sold-out item goes positive', () => {
    expect(isRestockCrossing(0, 5)).toBe(true)
  })

  it('fires from a negative (oversold) prior level to positive', () => {
    expect(isRestockCrossing(-2, 1)).toBe(true)
  })

  it('does not fire on a routine positive decrement (50 -> 49)', () => {
    expect(isRestockCrossing(50, 49)).toBe(false)
  })

  it('does not fire when the item is still sold out', () => {
    expect(isRestockCrossing(0, 0)).toBe(false)
    expect(isRestockCrossing(3, 0)).toBe(false)
    expect(isRestockCrossing(0, -1)).toBe(false)
  })

  it('does not fire on the first observation (unknown prior)', () => {
    expect(isRestockCrossing(null, 5)).toBe(false)
    expect(isRestockCrossing(null, 0)).toBe(false)
  })
})
