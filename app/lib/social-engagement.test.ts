/**
 * Instagram engagement capture (ticket #2742). Mocks the Graph API at the
 * fetch layer with a fixture insights response, same convention as
 * social-publish/instagram.server.test.ts. Never hits the live API.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  fetchInstagramEngagement,
  captureInstagramEngagement,
  rankBySaves,
  CAPTURE_SAMPLE,
  type EngagementCaptureRow,
  type EngagementReportRow,
  type InstagramEngagementMetrics,
} from './social-engagement.server'

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })
}

/** Fixture Graph API insights response for one media id. */
function insightsFixture(values: { reach?: number; likes?: number; comments?: number; saved?: number }) {
  const data = Object.entries(values).map(([name, value]) => ({ name, values: [{ value }] }))
  return { data }
}

describe('fetchInstagramEngagement', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('parses reach, likes, comments, and saves from a fixture insights response', async () => {
    vi.stubEnv('IG_GRAPH_ACCESS_TOKEN', 'tok')
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(String(input))
      expect(url.pathname).toBe('/v23.0/media-1/insights')
      return jsonResponse(insightsFixture({ reach: 900, likes: 40, comments: 3, saved: 22 }))
    }))

    const result = await fetchInstagramEngagement('media-1')
    expect(result).toEqual({ ok: true, metrics: { reach: 900, likes: 40, comments: 3, saved: 22 } })
  })

  it('ignores unknown metric names and missing values without throwing', async () => {
    vi.stubEnv('IG_GRAPH_ACCESS_TOKEN', 'tok')
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ data: [{ name: 'impressions', values: [{ value: 500 }] }, { name: 'saved', values: [] }] }),
    ))
    const result = await fetchInstagramEngagement('media-1')
    expect(result).toEqual({ ok: true, metrics: {} })
  })

  it('surfaces the token-expiry message on a code 190 error', async () => {
    vi.stubEnv('IG_GRAPH_ACCESS_TOKEN', 'tok')
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ error: { message: 'Error validating access token', code: 190 } }),
    ))
    const result = await fetchInstagramEngagement('media-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.detail).toMatch(/IG_GRAPH_ACCESS_TOKEN is expired or revoked/)
  })

  it('returns not-configured without an access token, and never calls fetch', async () => {
    vi.stubEnv('IG_GRAPH_ACCESS_TOKEN', '')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const result = await fetchInstagramEngagement('media-1')
    expect(result).toEqual({ ok: false, detail: 'Instagram keys are not configured' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

function row(id: number, externalPostId: string | null): EngagementCaptureRow {
  return { id, externalPostId, postedAt: new Date('2026-08-14') }
}

describe('captureInstagramEngagement', () => {
  it('fetches one report row per posted post; a repo without persistMetrics stays read-only', async () => {
    const rows = [row(1, 'ig_1'), row(2, 'ig_2')]
    const calls: string[] = []
    const report = await captureInstagramEngagement({
      repo: { recentPosted: async () => rows },
      fetchEngagement: async (mediaId) => {
        calls.push(mediaId)
        return { ok: true, metrics: { saved: mediaId === 'ig_1' ? 10 : 2 } }
      },
    })
    expect(calls).toEqual(['ig_1', 'ig_2'])
    expect(report).toEqual([
      { postId: 1, externalPostId: 'ig_1', metrics: { saved: 10 } },
      { postId: 2, externalPostId: 'ig_2', metrics: { saved: 2 } },
    ])
  })

  it('persists each successful fetch through the repo, and skips persist on a failed one', async () => {
    const rows = [row(1, 'ig_1'), row(2, 'ig_2')]
    const persisted: Array<[number, InstagramEngagementMetrics]> = []
    await captureInstagramEngagement({
      repo: {
        recentPosted: async () => rows,
        persistMetrics: async (id, metrics) => { persisted.push([id, metrics]) },
      },
      fetchEngagement: async (mediaId) =>
        mediaId === 'ig_1' ? { ok: true, metrics: { saved: 10, reach: 90 } } : { ok: false, detail: 'HTTP 429' },
    })
    expect(persisted).toEqual([[1, { saved: 10, reach: 90 }]])
  })

  it('records a per-row error without aborting the rest of the sweep', async () => {
    const rows = [row(1, 'ig_1'), row(2, 'ig_2')]
    const report = await captureInstagramEngagement({
      repo: { recentPosted: async () => rows },
      fetchEngagement: async (mediaId) =>
        mediaId === 'ig_1' ? { ok: false, detail: 'HTTP 429' } : { ok: true, metrics: { saved: 5 } },
    })
    expect(report).toEqual([
      { postId: 1, externalPostId: 'ig_1', error: 'HTTP 429' },
      { postId: 2, externalPostId: 'ig_2', metrics: { saved: 5 } },
    ])
  })

  it('skips a row with no external post id rather than fetching for it', async () => {
    const rows = [row(1, null), row(2, 'ig_2')]
    const calls: string[] = []
    const report = await captureInstagramEngagement({
      repo: { recentPosted: async () => rows },
      fetchEngagement: async (mediaId) => { calls.push(mediaId); return { ok: true, metrics: {} } },
    })
    expect(calls).toEqual(['ig_2'])
    expect(report).toHaveLength(1)
  })

  it('asks the repo for at most CAPTURE_SAMPLE rows', async () => {
    let requested = 0
    await captureInstagramEngagement({
      repo: { recentPosted: async (limit) => { requested = limit; return [] } },
      fetchEngagement: async () => ({ ok: true, metrics: {} }),
    })
    expect(requested).toBe(CAPTURE_SAMPLE)
  })
})

describe('rankBySaves', () => {
  it('sorts descending by saves, putting errored/missing rows last', () => {
    const report: EngagementReportRow[] = [
      { postId: 1, externalPostId: 'ig_1', metrics: { saved: 3 } },
      { postId: 2, externalPostId: 'ig_2', metrics: { saved: 30 } },
      { postId: 3, externalPostId: 'ig_3', error: 'HTTP 500' },
      { postId: 4, externalPostId: 'ig_4', metrics: { saved: 10 } },
    ]
    expect(rankBySaves(report).map(r => r.postId)).toEqual([2, 4, 1, 3])
  })
})
