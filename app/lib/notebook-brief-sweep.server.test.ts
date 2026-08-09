import { describe, it, expect, vi, beforeEach } from 'vitest'

const sanityFetch = vi.fn()
const fileDetectionTicket = vi.fn(async (..._args: unknown[]) => 77)
const captureException = vi.fn()

vi.mock('~/lib/sanity.server', () => ({
  getClient: () => ({ fetch: sanityFetch }),
}))
vi.mock('~/lib/sentry.server', () => ({
  Sentry: { captureException: (...args: unknown[]) => captureException(...args) },
}))
vi.mock('~/lib/detection-tickets.server', () => ({
  fileDetectionTicket: (...args: unknown[]) => fileDetectionTicket(...args),
  makeDedupeKey: (...parts: unknown[]) => parts.join(':'),
  priorityFromSeverity: () => 3,
}))

import { sweepStrandedBriefs, findStrandedBriefs } from './notebook-brief-sweep.server'

beforeEach(() => {
  sanityFetch.mockReset()
  fileDetectionTicket.mockClear()
  captureException.mockClear()
})

describe('findStrandedBriefs', () => {
  it('returns [] when the query yields nothing', async () => {
    sanityFetch.mockResolvedValue([])
    expect(await findStrandedBriefs()).toEqual([])
  })

  it('drops malformed rows lacking id/slug', async () => {
    sanityFetch.mockResolvedValue([
      { id: 'x', slug: 'good', status: 'queued', hasPublishedRef: false },
      { id: 'y' }, // missing slug
      null,
    ])
    const rows = await findStrandedBriefs()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.slug).toBe('good')
  })

  it('passes queued + drafted as the stranded statuses', async () => {
    sanityFetch.mockResolvedValue([])
    await findStrandedBriefs()
    const params = sanityFetch.mock.calls[0]?.[1] as { statuses: string[] }
    expect(params.statuses).toEqual(['queued', 'drafted'])
  })
})

describe('sweepStrandedBriefs', () => {
  it('is ok with no tickets when nothing is stranded', async () => {
    sanityFetch.mockResolvedValue([])
    const result = await sweepStrandedBriefs()
    expect(result).toEqual({ ok: true, stranded: [], ticketsFiled: [] })
    expect(fileDetectionTicket).not.toHaveBeenCalled()
    expect(captureException).not.toHaveBeenCalled()
  })

  it('files one deduped process ticket per stranded brief and captures once', async () => {
    sanityFetch.mockResolvedValue([
      { id: 'seoContentBrief-a', slug: 'a', status: 'queued', hasPublishedRef: false },
      { id: 'seoContentBrief-b', slug: 'b', status: 'drafted', hasPublishedRef: true },
    ])
    const result = await sweepStrandedBriefs()

    expect(result.ok).toBe(false)
    expect(result.stranded).toHaveLength(2)
    expect(result.ticketsFiled).toEqual([77, 77])
    expect(captureException).toHaveBeenCalledTimes(1)
    expect(fileDetectionTicket).toHaveBeenCalledTimes(2)

    const first = fileDetectionTicket.mock.calls[0]?.[0] as {
      kind: string
      priority: number
      dedupeKey: string
      detector: string
    }
    expect(first.kind).toBe('process') // not 'code' — no dev-loop claim
    expect(first.priority).toBe(3)
    expect(first.dedupeKey).toBe('stranded-brief:a') // stable per slug
    expect(first.detector).toBe('notebook-brief-sweep')
  })

  it('never throws when the query fails', async () => {
    sanityFetch.mockRejectedValue(new Error('sanity down'))
    const result = await sweepStrandedBriefs()
    expect(result).toEqual({ ok: false, stranded: [], ticketsFiled: [] })
    expect(fileDetectionTicket).not.toHaveBeenCalled()
  })
})
