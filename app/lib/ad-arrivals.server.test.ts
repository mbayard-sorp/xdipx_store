import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, number>()

vi.mock('~/lib/kv.server', () => ({
  kvIncr: vi.fn(async (key: string) => {
    const next = (store.get(key) ?? 0) + 1
    store.set(key, next)
    return next
  }),
  kvGet: vi.fn(async (key: string) => store.get(key) ?? null),
}))

import { arrivalDay, getArrivalCounts, recordArrivalBeacon, recordArrivalRequest } from '~/lib/ad-arrivals.server'

beforeEach(() => store.clear())

describe('arrivalDay', () => {
  it('returns the UTC calendar day', () => {
    expect(arrivalDay(new Date('2026-11-15T23:59:00Z'))).toBe('2026-11-15')
    expect(arrivalDay(new Date('2026-11-16T00:00:01Z'))).toBe('2026-11-16')
  })
})

describe('recordArrivalRequest / recordArrivalBeacon / getArrivalCounts', () => {
  it('a test click (a request plus a beacon) raises both counts by 1', async () => {
    const day = '2026-11-15'
    await recordArrivalRequest(day, 'exoclick', 'creative-42')
    await recordArrivalBeacon(day, 'exoclick', 'creative-42')
    expect(await getArrivalCounts(day, 'exoclick', 'creative-42')).toEqual({ requests: 1, beacons: 1 })
  })

  it('a curl (a request with no beacon) raises only the request count', async () => {
    const day = '2026-11-15'
    await recordArrivalRequest(day, 'exoclick', 'creative-42')
    expect(await getArrivalCounts(day, 'exoclick', 'creative-42')).toEqual({ requests: 1, beacons: 0 })
  })

  it('keeps distinct day/source/content combinations apart', async () => {
    await recordArrivalRequest('2026-11-15', 'exoclick', 'a')
    await recordArrivalRequest('2026-11-15', 'exoclick', 'b')
    await recordArrivalRequest('2026-11-15', 'bing', 'a')
    expect(await getArrivalCounts('2026-11-15', 'exoclick', 'a')).toEqual({ requests: 1, beacons: 0 })
    expect(await getArrivalCounts('2026-11-15', 'exoclick', 'b')).toEqual({ requests: 1, beacons: 0 })
    expect(await getArrivalCounts('2026-11-15', 'bing', 'a')).toEqual({ requests: 1, beacons: 0 })
    expect(await getArrivalCounts('2026-11-16', 'exoclick', 'a')).toEqual({ requests: 0, beacons: 0 })
  })

  it('reads zero for a combination that never recorded anything', async () => {
    expect(await getArrivalCounts('2026-11-15', 'exoclick', 'never-seen')).toEqual({ requests: 0, beacons: 0 })
  })

  it('treats a missing utm_content as its own bucket, distinct from a named one', async () => {
    await recordArrivalRequest('2026-11-15', 'exoclick', '')
    await recordArrivalRequest('2026-11-15', 'exoclick', 'creative-42')
    expect(await getArrivalCounts('2026-11-15', 'exoclick', '')).toEqual({ requests: 1, beacons: 0 })
    expect(await getArrivalCounts('2026-11-15', 'exoclick', 'creative-42')).toEqual({ requests: 1, beacons: 0 })
  })
})
