import { describe, expect, it } from 'vitest'
import { isFeedAwareIneligible, FEED_AWARE_MIN_BUYABLE_UNITS } from './feed-eligibility'

describe('isFeedAwareIneligible', () => {
  it('is true when the feed quantity is exactly 0, whatever totalInventory says', () => {
    expect(isFeedAwareIneligible({ feedQty: 0, totalInventory: 40 })).toBe(true)
    expect(isFeedAwareIneligible({ feedQty: 0, totalInventory: null })).toBe(true)
  })

  it('is true when totalInventory is at or below the floor, whatever the feed says', () => {
    expect(isFeedAwareIneligible({ feedQty: null, totalInventory: FEED_AWARE_MIN_BUYABLE_UNITS })).toBe(true)
    expect(isFeedAwareIneligible({ feedQty: 99, totalInventory: 1 })).toBe(true)
  })

  it('is false just above the floor with a positive or absent feed signal', () => {
    expect(isFeedAwareIneligible({ feedQty: null, totalInventory: FEED_AWARE_MIN_BUYABLE_UNITS + 1 })).toBe(false)
    expect(isFeedAwareIneligible({ feedQty: 12, totalInventory: 40 })).toBe(false)
  })

  it('treats null feedQty as no signal, not a disqualifying zero', () => {
    expect(isFeedAwareIneligible({ feedQty: null, totalInventory: 40 })).toBe(false)
  })

  it('treats null totalInventory (untracked) as no signal on its own', () => {
    expect(isFeedAwareIneligible({ feedQty: null, totalInventory: null })).toBe(false)
    expect(isFeedAwareIneligible({ feedQty: 5, totalInventory: null })).toBe(false)
  })

  // The two products named in ticket #20826's finding, reproduced exactly:
  // lust-fetish-seraphina (4 units, feed 0 for sku 95800) stayed in the
  // Curiosity Shelf's "worn-not-held" lane, and coquette-holiday-dress
  // (5 units, only one variant actually buyable, feed 0 for sku 96017)
  // stayed in rail Wear. Both must be ineligible.
  it('excludes the two incident products verbatim', () => {
    expect(isFeedAwareIneligible({ feedQty: 0, totalInventory: 4 })).toBe(true) // lust-fetish-seraphina
    expect(isFeedAwareIneligible({ feedQty: 0, totalInventory: 5 })).toBe(true) // coquette-holiday-dress
  })
})
