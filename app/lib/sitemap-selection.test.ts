import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_QUOTA_PER_DIAL, MIN_CANDIDATE_POOL, isoWeekIndex, quotaFromEnv,
  rotatingSlice, selectProductHandles, stableHash,
  type SitemapCandidate,
} from '~/lib/sitemap-selection'

/** A pool big enough to clear MIN_CANDIDATE_POOL, spread over `dials` dials. */
const pool = (n: number, dials = 4, inStock = true): SitemapCandidate[] =>
  Array.from({ length: n }, (_, i) => ({
    handle: `product-${i}`,
    dial: `dial-${i % dials}`,
    inStock,
  }))

const select = (
  candidates: SitemapCandidate[],
  opts: { protectedHandles?: string[]; quotaPerDial?: number; weekIndex?: number } = {},
) => selectProductHandles({
  candidates,
  protectedHandles: new Set(opts.protectedHandles ?? []),
  quotaPerDial: opts.quotaPerDial ?? 10,
  weekIndex: opts.weekIndex ?? 0,
})

describe('stableHash', () => {
  it('is deterministic', () => {
    expect(stableHash('lush-3-egg-vibrator')).toBe(stableHash('lush-3-egg-vibrator'))
  })

  it('separates handles that share a long prefix', () => {
    // Brand-prefixed handles are the norm in this catalog; an ordering that
    // kept them adjacent would make one week's sitemap a single brand.
    expect(stableHash('we-vibe-chorus-pro')).not.toBe(stableHash('we-vibe-sync-2'))
  })

  it('stays inside the unsigned 32-bit range', () => {
    for (const h of ['a', 'zzzz', 'we-vibe-chorus-pro-satin-black']) {
      expect(stableHash(h)).toBeGreaterThanOrEqual(0)
      expect(stableHash(h)).toBeLessThanOrEqual(0xffffffff)
    }
  })
})

describe('isoWeekIndex', () => {
  it('turns over at Monday 00:00 UTC, not mid-week', () => {
    const sunday = new Date('2026-09-13T23:59:59Z')
    const monday = new Date('2026-09-14T00:00:00Z')
    const saturday = new Date('2026-09-19T12:00:00Z')
    expect(isoWeekIndex(monday)).toBe(isoWeekIndex(sunday) + 1)
    expect(isoWeekIndex(saturday)).toBe(isoWeekIndex(monday))
  })

  it('advances by exactly one per week', () => {
    const a = new Date('2026-09-14T00:00:00Z')
    const b = new Date('2026-09-21T00:00:00Z')
    expect(isoWeekIndex(b) - isoWeekIndex(a)).toBe(1)
  })
})

describe('rotatingSlice', () => {
  const bucket = Array.from({ length: 10 }, (_, i) => i)

  it('takes exactly `quota` entries', () => {
    expect(rotatingSlice(bucket, 3, 0)).toHaveLength(3)
  })

  it('advances the window by `quota` each week', () => {
    expect(rotatingSlice(bucket, 3, 0)).toEqual([0, 1, 2])
    expect(rotatingSlice(bucket, 3, 1)).toEqual([3, 4, 5])
    expect(rotatingSlice(bucket, 3, 2)).toEqual([6, 7, 8])
  })

  it('wraps at the end of the bucket', () => {
    expect(rotatingSlice(bucket, 3, 3)).toEqual([9, 0, 1])
  })

  it('covers every entry within ceil(size / quota) weeks', () => {
    // This is the property that makes deselection temporary rather than a
    // lottery some products lose indefinitely.
    const seen = new Set<number>()
    const weeks = Math.ceil(bucket.length / 3)
    for (let w = 0; w < weeks; w++) for (const n of rotatingSlice(bucket, 3, w)) seen.add(n)
    expect(seen.size).toBe(bucket.length)
  })

  it('returns the whole bucket when the quota meets or exceeds its size', () => {
    expect(rotatingSlice(bucket, 10, 5)).toEqual(bucket)
    expect(rotatingSlice(bucket, 99, 5)).toEqual(bucket)
  })

  it('handles an empty bucket and a non-positive quota', () => {
    expect(rotatingSlice([], 5, 0)).toEqual([])
    expect(rotatingSlice(bucket, 0, 0)).toEqual([])
  })

  it('does not index off the front on a negative week', () => {
    expect(rotatingSlice(bucket, 3, -1)).toEqual([7, 8, 9])
  })
})

describe('selectProductHandles', () => {
  it('caps each dial at the quota', () => {
    const { handles } = select(pool(1000, 4), { quotaPerDial: 10 })
    expect(handles).not.toBeNull()
    expect(handles!.size).toBe(40)
  })

  it('submits far fewer URLs than the catalog holds', () => {
    const { handles } = select(pool(5000, 20), { quotaPerDial: DEFAULT_QUOTA_PER_DIAL })
    expect(handles!.size).toBe(20 * DEFAULT_QUOTA_PER_DIAL)
    expect(handles!.size).toBeLessThan(5000 / 5)
  })

  it('drops out-of-stock products', () => {
    const candidates = [...pool(600, 2), { handle: 'gone', dial: 'dial-0', inStock: false }]
    const { handles } = select(candidates, { quotaPerDial: 5 })
    expect(handles!.has('gone')).toBe(false)
  })

  it('keeps a protected handle the candidate pool has never heard of', () => {
    // The discovery index is a slightly narrower view of the catalog than the
    // sitemap's own list; four already-indexed products sat in that gap.
    const { handles } = select(pool(600, 2), { quotaPerDial: 5, protectedHandles: ['not-in-the-index'] })
    expect(handles!.has('not-in-the-index')).toBe(true)
  })

  it('keeps a protected product even when it is out of stock', () => {
    // An out-of-stock page that ranks is still worth keeping submitted;
    // pulling an indexed URL is the one move that risks deindexing it.
    const candidates = [...pool(600, 2), { handle: 'ranked', dial: 'dial-0', inStock: false }]
    const { handles } = select(candidates, { quotaPerDial: 5, protectedHandles: ['ranked'] })
    expect(handles!.has('ranked')).toBe(true)
  })

  it('keeps protected products outside the quota rather than spending it', () => {
    const candidates = pool(600, 1)
    const protectedHandles = ['product-0', 'product-1', 'product-2']
    const { handles, stats } = select(candidates, { quotaPerDial: 5, protectedHandles })
    for (const h of protectedHandles) expect(handles!.has(h)).toBe(true)
    // Protected entries are seeded wholesale, so the count is the set size.
    expect(stats.protectedPicked).toBe(3)
    // 5 quota slots awarded to unprotected products, plus the 3 protected.
    expect(stats.quotaPicked).toBe(5)
    expect(handles!.size).toBe(8)
  })

  it('buckets a missing dial under a single "other" bucket', () => {
    const candidates: SitemapCandidate[] = [
      ...pool(600, 1),
      ...Array.from({ length: 40 }, (_, i) => ({ handle: `x-${i}`, dial: null, inStock: true })),
      ...Array.from({ length: 40 }, (_, i) => ({ handle: `y-${i}`, dial: '  ', inStock: true })),
    ]
    const { handles } = select(candidates, { quotaPerDial: 5 })
    // dial-0 plus one shared 'other' bucket = 2 buckets x 5.
    expect(handles!.size).toBe(10)
  })

  it('is deterministic for a fixed week', () => {
    const candidates = pool(1000, 4)
    const a = select(candidates, { weekIndex: 7 }).handles!
    const b = select(candidates, { weekIndex: 7 }).handles!
    expect([...a].sort()).toEqual([...b].sort())
  })

  it('is insensitive to the incoming candidate order', () => {
    const candidates = pool(1000, 4)
    const a = select(candidates, { weekIndex: 7 }).handles!
    const b = select([...candidates].reverse(), { weekIndex: 7 }).handles!
    expect([...a].sort()).toEqual([...b].sort())
  })

  it('rotates the set between weeks', () => {
    const candidates = pool(1000, 4)
    const a = select(candidates, { weekIndex: 0 }).handles!
    const b = select(candidates, { weekIndex: 1 }).handles!
    expect([...a].some(h => !b.has(h))).toBe(true)
  })

  it('reaches every in-stock product over a full rotation', () => {
    const size = 600
    const candidates = pool(size, 1)
    const quotaPerDial = 20
    const seen = new Set<string>()
    for (let w = 0; w < Math.ceil(size / quotaPerDial); w++) {
      for (const h of select(candidates, { quotaPerDial, weekIndex: w }).handles!) seen.add(h)
    }
    expect(seen.size).toBe(size)
  })

  it('falls open on a pool too small to be a real catalog read', () => {
    const { handles, reason } = select(pool(MIN_CANDIDATE_POOL - 1))
    expect(handles).toBeNull()
    expect(reason).toContain('candidate pool')
  })

  it('falls open on an empty pool', () => {
    expect(select([]).handles).toBeNull()
  })

  it('falls open on a non-positive quota', () => {
    const { handles, reason } = select(pool(1000), { quotaPerDial: 0 })
    expect(handles).toBeNull()
    expect(reason).toContain('not positive')
  })

  it('reports stats that reconcile with the returned set', () => {
    const { handles, stats } = select(pool(1000, 4), { quotaPerDial: 10, protectedHandles: ['product-0'] })
    expect(stats.candidates).toBe(1000)
    expect(stats.inStock).toBe(1000)
    expect(handles!.size).toBe(stats.quotaPicked + stats.protectedPicked)
  })
})

describe('quotaFromEnv', () => {
  it('defaults when unset or blank', () => {
    expect(quotaFromEnv(undefined)).toBe(DEFAULT_QUOTA_PER_DIAL)
    expect(quotaFromEnv('  ')).toBe(DEFAULT_QUOTA_PER_DIAL)
  })

  it('accepts a non-negative integer', () => {
    expect(quotaFromEnv('40')).toBe(40)
    expect(quotaFromEnv('0')).toBe(0)
  })

  it('falls back and warns on anything unusable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const bad of ['abc', '-5', '12.5', 'NaN']) {
      expect(quotaFromEnv(bad)).toBe(DEFAULT_QUOTA_PER_DIAL)
    }
    expect(warn).toHaveBeenCalledTimes(4)
    warn.mockRestore()
  })
})
