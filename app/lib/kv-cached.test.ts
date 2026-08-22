// Ticket #1254: opt-in negative-result TTL on cached(). Empty results
// (null/undefined/[]) must expire on the short TTL while non-empty results
// serve the full TTL, and call sites that do not pass the parameter must be
// completely unaffected, including for empty values.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cached, invalidateCache } from './kv.server'

let now = 1_000_000
beforeEach(() => {
  // Hermetic isolation. cached() has two persistent layers: an L1 read cache on
  // globalThis and an L2 KV store. When real KV creds are present (any worktree
  // with .env), cached() writes these tests' fixed keys (test:cached:N) into the
  // shared Upstash store, and because Date.now() is frozen below, a later run
  // inside the KV TTL window reads those stale entries and never re-invokes fn —
  // which is exactly why this file was repeatedly mislabeled a "flaky test" and
  // routed around rather than fixed. Force the in-memory fallback so nothing
  // leaves the process, and clear the L1 cache so re-runs in the same worker
  // (watch mode) start clean too.
  vi.stubEnv('KV_DISABLE', '1')
  invalidateCache('test:cached:')
  now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

const uniq = (() => {
  let i = 0
  return () => `test:cached:${++i}`
})()

describe('cached() emptyTtlSeconds', () => {
  it('refetches an empty-array result after the short TTL', async () => {
    const key = uniq()
    const fn = vi.fn<() => Promise<string[]>>().mockResolvedValue([])
    expect(await cached(key, 180, fn, 30)).toEqual([])
    now += 29_000
    expect(await cached(key, 180, fn, 30)).toEqual([])
    expect(fn).toHaveBeenCalledTimes(1) // inside the 30s window: cached
    now += 2_000
    fn.mockResolvedValue(['fresh'])
    expect(await cached(key, 180, fn, 30)).toEqual(['fresh']) // 31s: refetched
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('refetches a null result after the short TTL', async () => {
    const key = uniq()
    const fn = vi.fn<() => Promise<string[] | null>>().mockResolvedValue(null)
    await cached(key, 180, fn, 30)
    now += 31_000
    fn.mockResolvedValue(['x'])
    expect(await cached(key, 180, fn, 30)).toEqual(['x'])
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('serves a non-empty result for the full TTL even with emptyTtlSeconds set', async () => {
    const key = uniq()
    const fn = vi.fn<() => Promise<string[]>>().mockResolvedValue(['a'])
    await cached(key, 180, fn, 30)
    now += 179_000
    expect(await cached(key, 180, fn, 30)).toEqual(['a'])
    expect(fn).toHaveBeenCalledTimes(1)
    now += 2_000
    await cached(key, 180, fn, 30)
    expect(fn).toHaveBeenCalledTimes(2) // past 180s: refetched
  })

  it('does not treat falsy scalars as empty', async () => {
    const key = uniq()
    const fn = vi.fn<() => Promise<boolean>>().mockResolvedValue(false)
    await cached(key, 180, fn, 30)
    now += 60_000
    expect(await cached(key, 180, fn, 30)).toBe(false)
    expect(fn).toHaveBeenCalledTimes(1) // false is a real value, full TTL
  })

  it('leaves call sites without the parameter unaffected, including empties', async () => {
    const key = uniq()
    const fn = vi.fn<() => Promise<string[]>>().mockResolvedValue([])
    await cached(key, 180, fn)
    now += 120_000
    expect(await cached(key, 180, fn)).toEqual([])
    expect(fn).toHaveBeenCalledTimes(1) // pre-existing behavior: full TTL
  })
})
