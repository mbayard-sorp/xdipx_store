// Ticket #22426: the IPX7 water-grant detector (app/lib/ipx7-water-grant.ts,
// fixed under #22377) needs to run on a schedule, not only on demand.
// sweepIpx7WaterGrants wires it into the existing daily
// /cron/notebook-healthcheck route. Pins the wiring with mocked Sanity +
// ticket-filing reads, independent of this file's own fetch-based page
// checks (which need a live/preview origin and are not exercised here).
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('sweepIpx7WaterGrants', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('~/lib/sentry.server', () => ({
      Sentry: { captureException: vi.fn() },
    }))
  })

  it('files one deduped detection ticket per published post carrying a hit, and none for a clean post', async () => {
    const filed: Array<{ dedupeKey: string; targetTeam: string; category: string }> = []

    vi.doMock('~/lib/sanity.server', () => ({
      getPublishedBlogPostBodies: async () => [
        {
          slug: 'clean-post',
          title: 'Clean post',
          body: [{ _type: 'block', style: 'normal', children: [{ _type: 'span', text: 'Nothing to see here.' }] }],
        },
        {
          slug: 'wrong-post',
          title: 'Wrong post',
          body: [
            {
              _type: 'block',
              style: 'normal',
              children: [{ _type: 'span', text: 'A toy rated IPX7 goes under the tap safely.' }],
            },
          ],
        },
      ],
      getBlogPostsForSitemap: async () => [],
      getBlogCategories: async () => [],
    }))
    vi.doMock('~/lib/notebook-brief-sweep.server', () => ({
      sweepStrandedBriefs: async () => ({ stranded: [], ticketsFiled: [] }),
    }))
    vi.doMock('~/lib/detection-tickets.server', () => ({
      fileDetectionTicket: async (input: { dedupeKey: string; targetTeam: string; category: string }) => {
        filed.push(input)
        return filed.length
      },
      makeDedupeKey: (...parts: Array<string | number>) => parts.join(':'),
      priorityFromSeverity: () => 2,
    }))

    const { sweepIpx7WaterGrants } = await import('./notebook-healthcheck.server')
    const result = await sweepIpx7WaterGrants()

    expect(result.postsWithHits).toBe(1)
    expect(result.ticketsFiled).toHaveLength(1)
    expect(filed).toHaveLength(1)
    expect(filed[0]?.dedupeKey).toBe('ipx7-water-grant:wrong-post')
    expect(filed[0]?.targetTeam).toBe('content')
    expect(filed[0]?.category).toBe('content-safety')
  })

  it('files nothing when no published post carries a hit', async () => {
    vi.doMock('~/lib/sanity.server', () => ({
      getPublishedBlogPostBodies: async () => [
        {
          slug: 'clean-post',
          title: 'Clean post',
          body: [{ _type: 'block', style: 'normal', children: [{ _type: 'span', text: 'Nothing to see here.' }] }],
        },
      ],
      getBlogPostsForSitemap: async () => [],
      getBlogCategories: async () => [],
    }))
    vi.doMock('~/lib/notebook-brief-sweep.server', () => ({
      sweepStrandedBriefs: async () => ({ stranded: [], ticketsFiled: [] }),
    }))
    const fileDetectionTicket = vi.fn()
    vi.doMock('~/lib/detection-tickets.server', () => ({
      fileDetectionTicket,
      makeDedupeKey: (...parts: Array<string | number>) => parts.join(':'),
      priorityFromSeverity: () => 2,
    }))

    const { sweepIpx7WaterGrants } = await import('./notebook-healthcheck.server')
    const result = await sweepIpx7WaterGrants()

    expect(result).toEqual({ postsWithHits: 0, ticketsFiled: [] })
    expect(fileDetectionTicket).not.toHaveBeenCalled()
  })
})
