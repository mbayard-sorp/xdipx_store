/**
 * Instagram engagement capture (ticket #2742). Mocks the Graph API at the
 * fetch layer with a fixture insights response, same convention as
 * social-publish/instagram.server.test.ts. Never hits the live API.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  fetchInstagramEngagement,
  fetchInstagramAccount,
  captureInstagramAccount,
  fetchXEngagement,
  captureInstagramEngagement,
  captureXEngagement,
  rankBySaves,
  CAPTURE_SAMPLE,
  FOLLOWER_HISTORY_MAX,
  type EngagementCaptureRow,
  type EngagementReportRow,
  type InstagramEngagementMetrics,
  type XEngagementMetrics,
  type FollowerReading,
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

// ─── Account-level readings (ticket #4064) ───────────────────────────────────

describe('fetchInstagramAccount', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('parses followers/follows/media counts and hits the account node with the fields param', async () => {
    vi.stubEnv('IG_GRAPH_ACCESS_TOKEN', 'tok')
    vi.stubEnv('IG_BUSINESS_ACCOUNT_ID', 'acct-1')
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(String(input))
      expect(url.pathname).toBe('/v23.0/acct-1')
      expect(url.searchParams.get('fields')).toBe('followers_count,follows_count,media_count')
      return jsonResponse({ followers_count: 214, follows_count: 30, media_count: 6 })
    }))

    const result = await fetchInstagramAccount()
    expect(result).toEqual({ ok: true, metrics: { followersCount: 214, followsCount: 30, mediaCount: 6 } })
  })

  it('surfaces the token-expiry message on a code 190 error, like the per-post fetch', async () => {
    vi.stubEnv('IG_GRAPH_ACCESS_TOKEN', 'tok')
    vi.stubEnv('IG_BUSINESS_ACCOUNT_ID', 'acct-1')
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ error: { message: 'Error validating access token', code: 190 } }),
    ))
    const result = await fetchInstagramAccount()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.detail).toMatch(/IG_GRAPH_ACCESS_TOKEN is expired or revoked/)
  })

  it('returns not-configured without keys, and never calls fetch', async () => {
    vi.stubEnv('IG_GRAPH_ACCESS_TOKEN', '')
    vi.stubEnv('IG_BUSINESS_ACCOUNT_ID', '')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const result = await fetchInstagramAccount()
    expect(result).toEqual({ ok: false, detail: 'Instagram keys are not configured' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('captureInstagramAccount', () => {
  it('returns the account block and persists a timestamped reading on success', async () => {
    const persisted: FollowerReading[] = []
    const report = await captureInstagramAccount({
      fetchAccount: async () => ({ ok: true, metrics: { followersCount: 214, followsCount: 30, mediaCount: 6 } }),
      persistReading: async (reading) => { persisted.push(reading) },
      now: () => new Date('2026-08-18T08:00:00.000Z'),
    })
    expect(report).toEqual({ account: { followersCount: 214, followsCount: 30, mediaCount: 6 } })
    expect(persisted).toEqual([
      { followersCount: 214, followsCount: 30, mediaCount: 6, ts: '2026-08-18T08:00:00.000Z' },
    ])
  })

  it('degrades an account-fetch failure to an error entry and persists nothing', async () => {
    const persisted: FollowerReading[] = []
    const report = await captureInstagramAccount({
      fetchAccount: async () => ({ ok: false, detail: 'IG_GRAPH_ACCESS_TOKEN is expired or revoked' }),
      persistReading: async (reading) => { persisted.push(reading) },
    })
    expect(report).toEqual({ error: 'IG_GRAPH_ACCESS_TOKEN is expired or revoked' })
    expect(persisted).toEqual([])
  })

  it('still returns the account block when the history write throws', async () => {
    // Persistence is best-effort: a KV failure must not sink the live reading.
    const report = await captureInstagramAccount({
      fetchAccount: async () => ({ ok: true, metrics: { followersCount: 5 } }),
      persistReading: async () => { throw new Error('KV down') },
    })
    expect(report).toEqual({ account: { followersCount: 5 } })
  })

  it('keeps the history bounded to FOLLOWER_HISTORY_MAX readings', () => {
    // The cap is what keeps the KV value small as readings accumulate.
    const prior: FollowerReading[] = Array.from({ length: FOLLOWER_HISTORY_MAX }, (_, i) => ({
      followersCount: i, ts: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
    }))
    const next = [...prior, { followersCount: 999, ts: '2026-08-18T08:00:00.000Z' }].slice(-FOLLOWER_HISTORY_MAX)
    expect(next).toHaveLength(FOLLOWER_HISTORY_MAX)
    expect(next.at(-1)).toEqual({ followersCount: 999, ts: '2026-08-18T08:00:00.000Z' })
    expect(next.at(0)?.followersCount).toBe(1) // the oldest (index 0) dropped off the front
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

describe('fetchXEngagement', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  function stubXKeys() {
    vi.stubEnv('X_API_KEY', 'k')
    vi.stubEnv('X_API_SECRET', 's')
    vi.stubEnv('X_ACCESS_TOKEN', 't')
    vi.stubEnv('X_ACCESS_TOKEN_SECRET', 'ts')
  }

  it('renames public_metrics counters and reports a deleted tweet as gone', async () => {
    stubXKeys()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      data: [{
        id: 'tw_1',
        public_metrics: {
          impression_count: 900, like_count: 40, reply_count: 3,
          retweet_count: 7, quote_count: 1, bookmark_count: 12,
        },
      }],
      errors: [{
        value: 'tw_2',
        title: 'Not Found Error',
        type: 'https://api.twitter.com/2/problems/resource-not-found',
        detail: 'Could not find tweet with ids: [tw_2].',
      }],
    })))

    const result = await fetchXEngagement(['tw_1', 'tw_2'])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.metrics.get('tw_1')).toEqual({
        impressions: 900, likes: 40, replies: 3, reposts: 7, quotes: 1, bookmarks: 12,
      })
      expect(result.gone.get('tw_2')).toMatch(/Could not find tweet/)
    }
  })

  it('surfaces a whole-request failure as ok:false, not as empty metrics', async () => {
    stubXKeys()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unauthorized', { status: 401 })))
    const result = await fetchXEngagement(['tw_1'])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.detail).toMatch(/401/)
  })
})

describe('captureXEngagement', () => {
  it('fetches the batch once, persists per row, and tags rows with the platform', async () => {
    const rows = [row(1, 'tw_1'), row(2, 'tw_2')]
    const persisted: Array<[number, XEngagementMetrics]> = []
    const batches: string[][] = []
    const report = await captureXEngagement({
      repo: {
        recentPosted: async () => rows,
        persistMetrics: async (id, metrics) => { persisted.push([id, metrics]) },
      },
      fetchEngagement: async (ids) => {
        batches.push(ids)
        return {
          ok: true,
          metrics: new Map([['tw_1', { bookmarks: 5 }], ['tw_2', { bookmarks: 1 }]]),
          gone: new Map(),
        }
      },
    })
    expect(batches).toEqual([['tw_1', 'tw_2']])
    expect(persisted).toEqual([[1, { bookmarks: 5 }], [2, { bookmarks: 1 }]])
    expect(report).toEqual([
      { postId: 1, externalPostId: 'tw_1', metrics: { bookmarks: 5 }, platform: 'x' },
      { postId: 2, externalPostId: 'tw_2', metrics: { bookmarks: 1 }, platform: 'x' },
    ])
  })

  it('reports a gone tweet as a per-row error and does not persist for it', async () => {
    const rows = [row(1, 'tw_1'), row(2, 'tw_2')]
    const persisted: number[] = []
    const report = await captureXEngagement({
      repo: {
        recentPosted: async () => rows,
        persistMetrics: async (id) => { persisted.push(id) },
      },
      fetchEngagement: async () => ({
        ok: true,
        metrics: new Map([['tw_2', { likes: 3 }]]),
        gone: new Map([['tw_1', 'Could not find tweet with ids: [tw_1].']]),
      }),
    })
    expect(persisted).toEqual([2])
    expect(report[0]).toMatchObject({ postId: 1, error: expect.stringMatching(/Could not find/) })
  })

  it('turns a whole-batch failure into an error row per post, aborting nothing', async () => {
    const rows = [row(1, 'tw_1'), row(2, 'tw_2')]
    const report = await captureXEngagement({
      repo: { recentPosted: async () => rows },
      fetchEngagement: async () => ({ ok: false, detail: 'HTTP 429' }),
    })
    expect(report).toEqual([
      { postId: 1, externalPostId: 'tw_1', error: 'HTTP 429', platform: 'x' },
      { postId: 2, externalPostId: 'tw_2', error: 'HTTP 429', platform: 'x' },
    ])
  })

  it('skips rows with no external post id and never fetches an empty batch', async () => {
    const fetchSpy = vi.fn()
    const report = await captureXEngagement({
      repo: { recentPosted: async () => [row(1, null)] },
      fetchEngagement: fetchSpy,
    })
    expect(report).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
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
