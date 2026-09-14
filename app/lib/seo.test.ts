import { describe, expect, it } from 'vitest'
import { isPermanentlyUnindexableStatus } from './seo'

describe('isPermanentlyUnindexableStatus', () => {
  it('reads 404 and 410 as permanently unindexable', () => {
    expect(isPermanentlyUnindexableStatus(404)).toBe(true)
    expect(isPermanentlyUnindexableStatus(410)).toBe(true)
  })

  // Ticket #9316: 1,208 product/collection URLs sit on a Google-cached
  // "Excluded by 'noindex' tag" verdict from a May 2026 render outage where
  // root.tsx's ErrorBoundary emitted noindex for every error, not only
  // 404/410 (fixed by PR #173, 2026-06-13). This asserts the fix holds: a
  // transient error, a Storefront outage, or a normal 200 must never be read
  // as permanently unindexable again. The PDP loader only ever throws
  // 404 when Shopify does not return the product at all (never for a stock
  // level — see app/lib/pdp-stock.ts, which has no status-code or robots
  // concern at all), so this is also the guarantee that an ACTIVE product
  // never emits noindex in any stock state: in stock, tracked zero-stock, or
  // oversell-continue all reach this function with a non-404/410 status (a
  // clean 200, or at worst the PDP's own 503 for a Storefront outage), and
  // every one of them reads as indexable below.
  it('never reads a transient or unknown status as unindexable', () => {
    expect(isPermanentlyUnindexableStatus(null)).toBe(false)
    expect(isPermanentlyUnindexableStatus(200)).toBe(false)
    expect(isPermanentlyUnindexableStatus(499)).toBe(false)
    expect(isPermanentlyUnindexableStatus(500)).toBe(false)
    expect(isPermanentlyUnindexableStatus(503)).toBe(false)
  })
})
