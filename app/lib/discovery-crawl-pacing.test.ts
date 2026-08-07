/**
 * The catalog crawl must not out-consume Shopify's refill rate.
 *
 * Shopify's Admin GraphQL bucket is 2,000 points refilling at 100/s, and one
 * PRODUCTS_PAGE_QUERY page costs 128 points. So a page cycle faster than
 * 128/100 = 1.28s spends the bucket down without limit — the page count is
 * irrelevant, the crawl is simply drawing faster than it earns.
 *
 * This is pinned in a test because the first version of the fix got it wrong in
 * a way that looked right. A flat 400ms delay reads as "paced", but measured in
 * production the cycle came to ~732ms, the crawl drew 175 points/s against the
 * 100/s refill, and the bucket bottomed at 54/2000 — worse than the 128 the
 * pacing was added to fix. A delay that slows a drain is not a delay that stops
 * one, and nothing but arithmetic tells the two apart.
 */
import { describe, it, expect } from 'vitest'
import { CRAWL_PAGE_DELAY_MS, CRAWL_BREAKEVEN_CYCLE_MS } from './discovery.server'

/** Slowest page round-trip observed in production; the delay tops up the cycle. */
const NETWORK_MS = 350
const RESTORE_PER_SEC = 100
const PAGE_COST = 128
const CATALOG_PAGES = 46

const cycleMs = NETWORK_MS + CRAWL_PAGE_DELAY_MS
const drawPerSec = PAGE_COST / (cycleMs / 1000)

describe('catalog crawl pacing', () => {
  it('draws no faster than Shopify refills', () => {
    // The whole point. At 400ms this was 175/s against 100/s and it failed.
    expect(drawPerSec).toBeLessThan(RESTORE_PER_SEC)
  })

  it('keeps real headroom, not a knife-edge', () => {
    // Break-even alone is not enough: one slow page tips a knife-edge negative.
    // Leave at least a quarter of the refill rate for everyone else.
    expect(RESTORE_PER_SEC - drawPerSec).toBeGreaterThan(RESTORE_PER_SEC * 0.25)
  })

  it('clears the break-even cycle the arithmetic demands', () => {
    expect(CRAWL_BREAKEVEN_CYCLE_MS).toBe(1280)
    expect(cycleMs).toBeGreaterThan(CRAWL_BREAKEVEN_CYCLE_MS)
  })

  it('rejects the delay that shipped first', () => {
    // Guards the specific regression: 400ms yields a 750ms cycle and a 170/s
    // draw. If someone trims the constant back toward "faster", this fails.
    const oldCycleMs = NETWORK_MS + 400
    expect(PAGE_COST / (oldCycleMs / 1000)).toBeGreaterThan(RESTORE_PER_SEC)
    expect(CRAWL_PAGE_DELAY_MS).toBeGreaterThan(400)
  })

  it('does not pay for headroom with an unreasonable crawl time', () => {
    // ~84s for the full catalog. Affordable only because the rebuild is gated
    // on a real catalog change now rather than firing every 15 minutes; if that
    // gate is ever removed, this number is the reason it cannot be.
    const fullCrawlSec = (CATALOG_PAGES * cycleMs) / 1000
    expect(fullCrawlSec).toBeLessThan(120)
  })
})
