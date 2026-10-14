import { describe, it, expect } from 'vitest'
import { isMaterialShortfall } from './backfill-inventory-resync'

describe('isMaterialShortfall (#15375)', () => {
  it('flags Shopify sitting at 0 while the feed shows any real stock', () => {
    expect(isMaterialShortfall(0, 2137)).toBe(true)
    expect(isMaterialShortfall(0, 1)).toBe(true)
  })

  it('does not flag 0 against 0 — nothing to resync to', () => {
    expect(isMaterialShortfall(0, 0)).toBe(false)
  })

  it('flags a large relative-and-absolute gap (the Strap-On-Me case: 11 vs 59)', () => {
    expect(isMaterialShortfall(11, 59)).toBe(true)
  })

  it('does not flag ordinary day-to-day drift on a small absolute gap', () => {
    // 48 vs 50: 4% short, 2 units — normal noise, not the import-lag defect.
    expect(isMaterialShortfall(48, 50)).toBe(false)
  })

  it('does not flag a small relative gap even when the absolute gap clears the floor', () => {
    // 480 vs 500: 4% short, 20 units — passes the absolute floor but not the
    // relative one, so it still reads as ordinary drift, not a stale import.
    expect(isMaterialShortfall(480, 500)).toBe(false)
  })

  it('never flags Shopify at or above the feed quantity', () => {
    expect(isMaterialShortfall(100, 100)).toBe(false)
    expect(isMaterialShortfall(150, 100)).toBe(false)
  })

  it('never flags when the feed itself has no stock to resync from', () => {
    expect(isMaterialShortfall(0, 0)).toBe(false)
  })
})
