import { describe, expect, it } from 'vitest'
import { batchIdForDay, selectPushableUrls } from '~/lib/indexnow-bulk.server'
import {
  INDEXNOW_MAX_URLS_PER_REQUEST, chunkUrls, isRetryableStatus, normalizeUrls,
} from '~/lib/search-ping.server'

const u = (n: number) => `https://xdipx.com/products/p${n}`

describe('selectPushableUrls', () => {
  it('drops URLs pushed inside the suppression window', () => {
    const { pushable, suppressed } = selectPushableUrls(
      [u(1), u(2), u(3)],
      new Set([u(2)]),
      100,
    )
    expect(pushable).toEqual([u(1), u(3)])
    expect(suppressed).toBe(1)
  })

  it('counts every suppressed URL even past the limit', () => {
    // Suppression is a property of the candidate set, not of what fit in the
    // batch. Reporting it accurately is how we tell "nothing to do today"
    // apart from "we ran out of budget".
    const { pushable, suppressed } = selectPushableUrls(
      [u(1), u(2), u(3), u(4)],
      new Set([u(1), u(2)]),
      1,
    )
    expect(pushable).toEqual([u(3)])
    expect(suppressed).toBe(2)
  })

  it('caps at the limit and preserves candidate order', () => {
    const candidates = Array.from({ length: 10 }, (_, i) => u(i))
    const { pushable } = selectPushableUrls(candidates, new Set(), 4)
    expect(pushable).toEqual([u(0), u(1), u(2), u(3)])
  })

  it('returns nothing when every candidate is suppressed', () => {
    const candidates = [u(1), u(2)]
    const { pushable, suppressed } = selectPushableUrls(candidates, new Set(candidates), 100)
    expect(pushable).toEqual([])
    expect(suppressed).toBe(2)
  })

  it('handles an empty candidate set', () => {
    expect(selectPushableUrls([], new Set(), 100)).toEqual({ pushable: [], suppressed: 0 })
  })
})

describe('chunkUrls', () => {
  it('never exceeds the IndexNow per-request ceiling', () => {
    const urls = Array.from({ length: 25_000 }, (_, i) => u(i))
    const chunks = chunkUrls(urls, INDEXNOW_MAX_URLS_PER_REQUEST)
    expect(chunks).toHaveLength(3)
    expect(chunks.map(c => c.length)).toEqual([10_000, 10_000, 5_000])
    expect(chunks.every(c => c.length <= INDEXNOW_MAX_URLS_PER_REQUEST)).toBe(true)
  })

  it('keeps a single sub-ceiling batch in one request', () => {
    // The real stale set is ~1,565 URLs: one POST, not 1,565.
    const chunks = chunkUrls(Array.from({ length: 1_565 }, (_, i) => u(i)))
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toHaveLength(1_565)
  })

  it('loses nothing across the split', () => {
    const urls = Array.from({ length: 7 }, (_, i) => u(i))
    expect(chunkUrls(urls, 3).flat()).toEqual(urls)
  })

  it('returns no chunks for an empty list', () => {
    expect(chunkUrls([])).toEqual([])
  })

  it('refuses a zero chunk size rather than looping forever', () => {
    expect(chunkUrls([u(1), u(2)], 0)).toEqual([[u(1)], [u(2)]])
  })
})

describe('normalizeUrls', () => {
  it('absolutizes paths and dedupes', () => {
    expect(normalizeUrls(['/notebook', 'notebook', 'https://xdipx.com/notebook']))
      .toEqual(['https://xdipx.com/notebook'])
  })

  it('drops off-host URLs', () => {
    // IndexNow rejects the whole payload when any URL is off-host, so one
    // stray CDN link would silently kill a 1,500-URL batch.
    expect(normalizeUrls(['https://cdn.shopify.com/x.jpg', '/products/a']))
      .toEqual(['https://xdipx.com/products/a'])
  })

  it('drops empty and unparseable entries', () => {
    expect(normalizeUrls(['', 'http://', '/ok'])).toEqual(['https://xdipx.com/ok'])
  })
})

describe('isRetryableStatus', () => {
  it('retries transport failures and 5xx', () => {
    expect(isRetryableStatus(0)).toBe(true)
    expect(isRetryableStatus(500)).toBe(true)
    expect(isRetryableStatus(503)).toBe(true)
  })

  it('does not retry a 429 in-process', () => {
    // Being rate limited means back off until the next scheduled run.
    expect(isRetryableStatus(429)).toBe(false)
  })

  it('does not retry success or a 4xx', () => {
    expect(isRetryableStatus(200)).toBe(false)
    expect(isRetryableStatus(422)).toBe(false)
  })
})

describe('batchIdForDay', () => {
  it('groups a day of pushes under one id', () => {
    expect(batchIdForDay(new Date('2026-07-27T04:40:00Z'))).toBe('bulk-2026-07-27')
    expect(batchIdForDay(new Date('2026-07-27T23:59:00Z'))).toBe('bulk-2026-07-27')
  })
})
