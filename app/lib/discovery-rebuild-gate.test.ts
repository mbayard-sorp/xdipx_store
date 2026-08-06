/**
 * When `/cron/warm` is allowed to spend a full catalog crawl.
 *
 * Measured 2026-08-05: one catalog page costs 128 Shopify rate-limit points and
 * the catalog is 46 pages, so a rebuild is 5,888 points against a 2,000-point
 * bucket refilling at 100/s. That is 2.9x the whole bucket — the crawl throttles
 * itself after 15 pages and then pins the bucket near zero for ~60s. Sampling
 * the live bucket every 15s across a cron boundary read
 * 1999 -> 1864 -> 138 -> 128 -> 575 -> 1999.
 *
 * Firing that unconditionally every 15 minutes starved every other Admin API
 * caller in the window: the purchase reconcile sweep (same tick, throttled on
 * every run), warm-discovery-index 500ing on itself, and getDiscoveryRails
 * timing out so the homepage served a degraded payload.
 *
 * Getting this gate wrong costs either a starved bucket or a frozen catalog, so
 * both directions are pinned here rather than discovered in production.
 */
import { describe, it, expect } from 'vitest'
import { shouldRebuildDiscoveryIndex, INDEX_STALE_FLOOR_MS } from './discovery.server'

const MIN = 60_000

describe('shouldRebuildDiscoveryIndex', () => {
  it('skips a clean, fresh index — the whole point of the change', () => {
    const d = shouldRebuildDiscoveryIndex({ dirty: false, ageMs: 15 * MIN })
    expect(d.rebuild).toBe(false)
    expect(d.reason).toMatch(/clean/)
  })

  it('rebuilds when the catalog changed, however fresh the index is', () => {
    // A products/create webhook one minute ago still has to be picked up: a new
    // product is absent from the index, so it is unreachable from discovery,
    // the rails, and the homepage payload built from them.
    const d = shouldRebuildDiscoveryIndex({ dirty: true, ageMs: 1 * MIN })
    expect(d.rebuild).toBe(true)
    expect(d.reason).toMatch(/changed/)
  })

  it('rebuilds past the staleness floor even when nothing signalled a change', () => {
    // The floor is what makes skipping safe. Collection edits, a missed webhook
    // delivery, or a KV eviction of the dirty flag all change the catalog
    // without setting it.
    const d = shouldRebuildDiscoveryIndex({ dirty: false, ageMs: INDEX_STALE_FLOOR_MS + MIN })
    expect(d.rebuild).toBe(true)
    expect(d.reason).toMatch(/floor/)
  })

  it('treats a missing durable row as always-rebuild', () => {
    // Never built, or the index version was just bumped. This is the one case
    // that must never be skipped: there is no index to serve.
    for (const dirty of [true, false]) {
      const d = shouldRebuildDiscoveryIndex({ dirty, ageMs: null })
      expect(d.rebuild).toBe(true)
      expect(d.reason).toMatch(/no durable index row/)
    }
  })

  it('holds the boundary exactly at the floor', () => {
    expect(shouldRebuildDiscoveryIndex({ dirty: false, ageMs: INDEX_STALE_FLOOR_MS - 1 }).rebuild).toBe(false)
    expect(shouldRebuildDiscoveryIndex({ dirty: false, ageMs: INDEX_STALE_FLOOR_MS }).rebuild).toBe(true)
  })

  it('keeps the floor well inside the index own 24h TTL', () => {
    // A floor above the TTL would let the cached index expire before the gate
    // ever asked for a rebuild, which is the frozen-catalog failure.
    expect(INDEX_STALE_FLOOR_MS).toBeLessThan(24 * 60 * 60 * 1000)
    // And far enough above the 15-minute cron tick to actually save crawls:
    // 96 rebuilds a day becomes 4.
    expect(INDEX_STALE_FLOOR_MS).toBeGreaterThan(60 * MIN)
  })
})
