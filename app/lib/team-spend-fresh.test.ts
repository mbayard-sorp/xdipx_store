/**
 * Ticket #5929: a stale or inflated KV spend counter must never be the sole
 * reason a run is skipped. gate() re-confirms an at/over-budget reading against
 * the DB source of truth via getTodaySpendCents(team, { forceFresh: true })
 * before it issues an over_budget skip. This proves the primitive that guard
 * composes: forceFresh ignores a present, fresh KV counter and re-sums from the
 * DB, self-healing a phantom value (run 528 read a ~3649c counter against a ~4c
 * real spend and forfeited its pass).
 *
 * No DB harness in this suite (same discipline as team-image-cap.test.ts: the
 * database is PRODUCTION), so db.execute and the KV client are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const executeMock = vi.hoisted(() => vi.fn())
const kvGetMock = vi.hoisted(() => vi.fn(async (_k: string) => null as unknown))
const kvSetMock = vi.hoisted(() => vi.fn(async (_k: string, _v: unknown, _ttl?: number) => undefined))

vi.mock('~/lib/db.server', () => ({ db: { execute: executeMock } }))
vi.mock('~/lib/kv.server', () => ({
  kvGet: kvGetMock,
  kvSet: kvSetMock,
  kvSetNX: vi.fn(async () => true),
  kvDel: vi.fn(async () => undefined),
  kvIncrBy: vi.fn(async () => undefined),
  cached: vi.fn(async (_key: string, _ttl: number, fn: () => unknown) => fn()),
  invalidateCache: vi.fn(),
}))

import { getTodaySpendCents } from '~/lib/team.server'

// A "hot" cache: a present counter value and a seededAt inside the reseed
// window, so a normal read is a pure cache hit.
function hotCache(cents: number) {
  kvGetMock.mockImplementation(async (k: string) =>
    k.endsWith(':seededAt') ? Date.now() : cents,
  )
}

beforeEach(() => {
  executeMock.mockReset()
  kvGetMock.mockReset()
  kvSetMock.mockReset()
  kvSetMock.mockResolvedValue(undefined)
  // DB source of truth: ~4 cents (0.04 dollars).
  executeMock.mockResolvedValue({ rows: [{ dollars: 0.04 }] })
})

describe('getTodaySpendCents forceFresh (ticket #5929)', () => {
  it('a normal read returns the cached counter and never touches the DB', async () => {
    hotCache(3649) // the inflated phantom counter
    const cents = await getTodaySpendCents('social')
    expect(cents).toBe(3649)
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('forceFresh ignores the fresh cached counter and re-sums from the DB', async () => {
    hotCache(3649)
    const cents = await getTodaySpendCents('social', { forceFresh: true })
    expect(cents).toBe(4) // the real DB sum, not the 3649c phantom
    expect(executeMock).toHaveBeenCalledTimes(1)
  })

  it('forceFresh overwrites the KV counter with the DB sum so the phantom self-heals', async () => {
    hotCache(3649)
    await getTodaySpendCents('social', { forceFresh: true })
    // counterRead writes both the value key and its :seededAt key.
    const wroteValue = kvSetMock.mock.calls.some(
      ([k, v]) => !String(k).endsWith(':seededAt') && v === 4,
    )
    expect(wroteValue).toBe(true)
  })
})
