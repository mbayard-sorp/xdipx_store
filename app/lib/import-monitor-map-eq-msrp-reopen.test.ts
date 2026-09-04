/**
 * Ticket #7232: import-monitor reopens watching -> pending on a price drop
 * for candidates whose map_price = msrp, but a MAP=MSRP product can never
 * carry a discount/deal story (MAP is the advertised floor and it already
 * equals MSRP). These rows reopened, got re-swept every product-daily run,
 * and could only ever be rejected -- structural queue rot product-manager
 * cleared by hand each time (run 661 rejected 4 such rows, all last_seen
 * frozen 2026-07-21).
 *
 * decideWatchingReopen is the pure decision extracted from the
 * watching-reopen branch of runImportMonitor so this doesn't require
 * mocking the whole feed-fetch/DB pipeline.
 */
import { describe, expect, it } from 'vitest'
import { decideWatchingReopen } from '~/lib/import-monitor.server'

const BASE = {
  priorScore: 2.0,
  score: 2.0,
  watchScoreDelta: 0.10,
  priorPrice: 20,
  proposedPrice: 20,
  watchPriceDropPct: 0.10,
  map: 0,
  msrp: 20,
}

describe('decideWatchingReopen', () => {
  it('closes to rejected on a price drop when MAP=MSRP (the run-661 pattern)', () => {
    const action = decideWatchingReopen({
      ...BASE,
      priorPrice: 20,
      proposedPrice: 17, // 15% drop, clears the 10% watchPriceDropPct threshold
      map: 20,
      msrp: 20,
    })
    expect(action).toBe('reject-map-locked')
  })

  it('closes to rejected when MAP is set above MSRP, not just exactly equal', () => {
    const action = decideWatchingReopen({
      ...BASE,
      priorPrice: 20,
      proposedPrice: 17,
      map: 25,
      msrp: 20,
    })
    expect(action).toBe('reject-map-locked')
  })

  it('reopens normally on a price drop when MAP is a real discount floor (map < msrp)', () => {
    const action = decideWatchingReopen({
      ...BASE,
      priorPrice: 20,
      proposedPrice: 17,
      map: 15,
      msrp: 20,
    })
    expect(action).toBe('reopen')
  })

  it('reopens normally on a price drop when there is no MAP at all', () => {
    const action = decideWatchingReopen({
      ...BASE,
      priorPrice: 20,
      proposedPrice: 17,
      map: 0,
      msrp: 20,
    })
    expect(action).toBe('reopen')
  })

  it('a genuine score improvement still reopens a MAP=MSRP-locked master (not rejected)', () => {
    const action = decideWatchingReopen({
      ...BASE,
      priorScore: 2.0,
      score: 2.5, // clears watchScoreDelta on its own
      priorPrice: 20,
      proposedPrice: 17,
      map: 20,
      msrp: 20,
    })
    expect(action).toBe('reopen')
  })

  it('refreshes (no reopen, no reject) when neither signal fires', () => {
    const action = decideWatchingReopen({
      ...BASE,
      priorPrice: 20,
      proposedPrice: 19.5, // under the 10% threshold
      map: 20,
      msrp: 20,
    })
    expect(action).toBe('refresh')
  })
})
