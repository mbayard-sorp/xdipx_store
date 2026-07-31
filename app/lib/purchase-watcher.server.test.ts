import { describe, expect, it } from 'vitest'

import {
  evaluatePurchaseWatch,
  type PurchaseWatchInputs,
  type PurchaseWatchState,
} from '~/lib/purchase-watcher.server'

/**
 * These exercise the pure decision core as the pure function it is, so no
 * Shopify / DB / KV / alert IO is involved. The binding requirement (ticket
 * #590) is: a simulated recent-order gap produces exactly one owner alert, and
 * a day with zero orders produces none.
 */

const CLEAN: PurchaseWatchState = { gapStrikes: 0, p0Alerted: false, p1Fingerprint: '' }

function inputs(over: Partial<PurchaseWatchInputs> = {}): PurchaseWatchInputs {
  return {
    recentPaidOrders: 0,
    gapOrderIds: [],
    staleCapiOrderIds: [],
    staleGa4OrderIds: [],
    stubMarkerSeen: false,
    prior: CLEAN,
    ...over,
  }
}

describe('evaluatePurchaseWatch — zero-orders day never pages', () => {
  it('scanned 0, nothing stale, no stub → no alerts, strikes reset', () => {
    const d = evaluatePurchaseWatch(inputs({ recentPaidOrders: 0 }))
    expect(d.p0Alert).toBe(false)
    expect(d.p1Alert).toBe(false)
    expect(d.next.gapStrikes).toBe(0)
  })

  it('a gap set with zero scanned orders is impossible and never pages', () => {
    // recentPaidOrders 0 means Shopify confirmed no live sales; gap ids from a
    // stale scan must not manufacture an alert.
    const d = evaluatePurchaseWatch(inputs({ recentPaidOrders: 0, gapOrderIds: ['999'] }))
    expect(d.p0Alert).toBe(false)
    expect(d.next.gapStrikes).toBe(0)
  })
})

describe('evaluatePurchaseWatch — recent-order gap pages exactly once per episode', () => {
  it('does not page on the first run a gap is seen', () => {
    const d = evaluatePurchaseWatch(inputs({ recentPaidOrders: 1, gapOrderIds: ['111'] }))
    expect(d.next.gapStrikes).toBe(1)
    expect(d.p0Alert).toBe(false)
  })

  it('pages on the second consecutive run and latches the episode', () => {
    const run1 = evaluatePurchaseWatch(inputs({ recentPaidOrders: 1, gapOrderIds: ['111'] }))
    const run2 = evaluatePurchaseWatch(
      inputs({ recentPaidOrders: 1, gapOrderIds: ['111'], prior: run1.next }),
    )
    expect(run2.next.gapStrikes).toBe(2)
    expect(run2.p0Alert).toBe(true)
    expect(run2.p0Reason).toContain('111')
    expect(run2.next.p0Alerted).toBe(true)
  })

  it('does not re-page while the same gap persists past the threshold', () => {
    let state = CLEAN
    const alerts: boolean[] = []
    for (let i = 0; i < 5; i++) {
      const d = evaluatePurchaseWatch(inputs({ recentPaidOrders: 1, gapOrderIds: ['111'], prior: state }))
      alerts.push(d.p0Alert)
      state = d.next
    }
    // Exactly one alert across five consecutive gap runs.
    expect(alerts.filter(Boolean)).toHaveLength(1)
    expect(alerts[1]).toBe(true)
    expect(state.gapStrikes).toBeLessThanOrEqual(3) // capped
  })

  it('re-arms after recovery so a later episode pages again', () => {
    // Drive to a paged, latched state.
    let state = evaluatePurchaseWatch(inputs({ recentPaidOrders: 1, gapOrderIds: ['111'] })).next
    state = evaluatePurchaseWatch(inputs({ recentPaidOrders: 1, gapOrderIds: ['111'], prior: state })).next
    expect(state.p0Alerted).toBe(true)

    // Recovery: no gap. Latch clears, strikes reset.
    const recovered = evaluatePurchaseWatch(inputs({ recentPaidOrders: 2, gapOrderIds: [], prior: state }))
    expect(recovered.next.p0Alerted).toBe(false)
    expect(recovered.next.gapStrikes).toBe(0)

    // New episode: two runs page again.
    const e1 = evaluatePurchaseWatch(inputs({ recentPaidOrders: 1, gapOrderIds: ['222'], prior: recovered.next }))
    const e2 = evaluatePurchaseWatch(inputs({ recentPaidOrders: 1, gapOrderIds: ['222'], prior: e1.next }))
    expect(e2.p0Alert).toBe(true)
  })

  it('unknown scanned count (Shopify failure) carries strikes forward without paging', () => {
    const primed = evaluatePurchaseWatch(inputs({ recentPaidOrders: 1, gapOrderIds: ['111'] }))
    expect(primed.next.gapStrikes).toBe(1)
    const unknown = evaluatePurchaseWatch(inputs({ recentPaidOrders: null, prior: primed.next }))
    expect(unknown.next.gapStrikes).toBe(1) // unchanged, not reset
    expect(unknown.p0Alert).toBe(false)
  })
})

describe('evaluatePurchaseWatch — stub marker is an immediate P0', () => {
  it('pages on first sight of the fallback-stub marker, once', () => {
    const run1 = evaluatePurchaseWatch(inputs({ stubMarkerSeen: true }))
    expect(run1.p0Alert).toBe(true)
    expect(run1.p0Reason).toContain('fallback stub')
    const run2 = evaluatePurchaseWatch(inputs({ stubMarkerSeen: true, prior: run1.next }))
    expect(run2.p0Alert).toBe(false)
  })
})

describe('evaluatePurchaseWatch — stale send failures are P1 email, deduped', () => {
  it('emails on a new stale set, then not on the identical set', () => {
    const run1 = evaluatePurchaseWatch(inputs({ staleCapiOrderIds: ['a', 'b'] }))
    expect(run1.p1Alert).toBe(true)
    expect(run1.p0Alert).toBe(false)
    const run2 = evaluatePurchaseWatch(inputs({ staleCapiOrderIds: ['a', 'b'], prior: run1.next }))
    expect(run2.p1Alert).toBe(false)
  })

  it('re-alerts when the stale set grows', () => {
    const run1 = evaluatePurchaseWatch(inputs({ staleGa4OrderIds: ['a'] }))
    const run2 = evaluatePurchaseWatch(inputs({ staleGa4OrderIds: ['a', 'c'], prior: run1.next }))
    expect(run2.p1Alert).toBe(true)
  })

  it('a live P0 suppresses the P1 email in the same run', () => {
    const d = evaluatePurchaseWatch(inputs({ stubMarkerSeen: true, staleCapiOrderIds: ['a'] }))
    expect(d.p0Alert).toBe(true)
    expect(d.p1Alert).toBe(false)
  })
})
