/**
 * POST /api/team/brief publish carries metricsJson.videoShortlist through,
 * dropping (and reporting) malformed entries instead of failing the publish;
 * GET returns the stored shortlist unchanged. team.server is mocked with an
 * in-memory "active brief".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store: { active: Record<string, unknown> | null } = { active: null }

vi.mock('~/lib/team.server', () => ({
  assertTeamAuth: vi.fn(),
  getActiveBrief: vi.fn(async () => store.active),
  publishBrief: vi.fn(async (input: Record<string, unknown>) => {
    store.active = { id: 42, ...input, metricsJson: input['metricsJson'] ?? null }
    return 42
  }),
}))

import { action, loader } from '~/routes/api.team.brief'
import { sanitizeBriefMetrics } from '~/lib/video-shortlist'

const good = {
  handle: 'rose-toy', title: 'Rose', format: 'show-and-tell',
  reason: 'never posted, 62% margin, fits the self-care week', stockCheckedAt: '2026-09-22T12:05:00Z',
}

function publish(metricsJson: unknown): Promise<Response> {
  const request = new Request('http://localhost/api/team/brief', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'publish', weekStart: '2026-09-21', brief: '# Focus', metricsJson }),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

async function getBrief(): Promise<Record<string, unknown>> {
  const res = (await loader({ request: new Request('http://localhost/api/team/brief'), params: {}, context: {} } as never)) as Response
  return ((await res.json()) as { brief: Record<string, unknown> }).brief
}

beforeEach(() => { store.active = null })

describe('brief videoShortlist passthrough', () => {
  it('round-trips a well-formed shortlist and the rest of metricsJson unchanged', async () => {
    const metrics = { revenue7d: 812.5, videoShortlist: [good, { ...good, handle: 'magic-wand', title: 'Wand' }] }
    const res = await publish(metrics)
    expect(await res.json()).toEqual({ id: 42 })
    expect((await getBrief())['metricsJson']).toEqual(metrics)
  })

  it('drops malformed entries, keeps the good ones, and still publishes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await publish({
      videoShortlist: [
        good,
        { ...good, handle: '' },
        { ...good, stockCheckedAt: 'yesterday-ish' },
        'rose-toy',
        { handle: 'no-other-fields' },
      ],
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 42, shortlistDropped: 4 })
    expect((await getBrief())['metricsJson']).toEqual({ videoShortlist: [good] })
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('leaves metricsJson without a shortlist, or not an object, untouched', async () => {
    await publish({ revenue7d: 1 })
    expect((await getBrief())['metricsJson']).toEqual({ revenue7d: 1 })
    await publish(undefined)
    expect((await getBrief())['metricsJson']).toBeNull()
  })
})

describe('sanitizeBriefMetrics', () => {
  it('removes a non-array videoShortlist and reports it', () => {
    const r = sanitizeBriefMetrics({ a: 1, videoShortlist: { handle: 'x' } })
    expect(r.metricsJson).toEqual({ a: 1 })
    expect(r.dropped).toEqual([{ index: -1, reason: 'videoShortlist is not an array' }])
  })

  it('passes a well-formed entry through as sent, extra keys included', () => {
    const entry = { ...good, margin: 0.62, alternate: 'magic-wand' }
    const r = sanitizeBriefMetrics({ videoShortlist: [entry] })
    expect(r.metricsJson).toEqual({ videoShortlist: [entry] })
    expect(r.dropped).toEqual([])
  })
})
