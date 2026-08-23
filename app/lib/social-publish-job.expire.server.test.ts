// Auto-expire of unapproved rows past their slot (Phase 4, #4939).
//
// Split from social-publish-job.server.test.ts so the live-path cases there
// stay byte-identical; the fake repo here mirrors that file's.
import { describe, it, expect, vi } from 'vitest'
import {
  runSocialPublishTick,
  expiredFeedback,
  EXPIRED_PREFIX,
  type PublishRepo,
  type PostRow,
} from './social-publish-job.server'

const CDN = 'https://cdn.shopify.com/s/files/1/0761/6872/4651/files'
const PASS_STAMP =
  '[publish-gate PASS by social-publish-gate on 2026-08-12, product: none]\nLooked at the frame.'

function post(over: Partial<PostRow> = {}): PostRow {
  return {
    id: 1, platform: 'instagram', postType: 'campaign', externalPostId: null,
    parentPostId: null, dealHistoryId: null,
    tweetText: 'a detail about silicone grades nobody mentions out loud',
    mediaUrls: [`${CDN}/social-rosales-cast-maya-20260812-1.jpg`],
    mediaIds: null, status: 'draft', errorMessage: null, postedAt: null,
    createdAt: new Date('2026-08-01'), createdBy: 'agent',
    reviewStatus: 'approved', feedback: PASS_STAMP, editedText: null,
    reviewedBy: null, reviewedAt: null, scheduledFor: '2026-08-12',
    reworkedFrom: null, videoJobId: null, posterUrl: null,
    metricsJson: null, shopifyProductId: null,
    ...over,
  } as PostRow
}

function fakeRepo(rows: PostRow[], over: Partial<PublishRepo> = {}) {
  const calls = { posted: [] as number[] }
  const repo: PublishRepo = {
    sweepAbandoned: async () => 0,
    countPublishedToday: async () => 0,
    listEligible: async (limit) => rows.slice(0, limit),
    recentCaptions: async () => [],
    claim: async (id) => rows.find(r => r.id === id) ?? null,
    markPosted: async (id) => { calls.posted.push(id) },
    markNeedsChanges: async () => {},
    markFailed: async () => {},
    ...over,
  }
  return { repo, calls }
}

const tick = (opts: Parameters<typeof runSocialPublishTick>[0]) =>
  runSocialPublishTick({ removalWatch: async () => null, ...opts })
const enabled = async () => true
const cap = (n: number) => async () => n
const publishOk = vi.fn(async () => ({ ok: true as const, externalPostId: 'ig_1' }))

describe('auto-expire in the tick', () => {
  it('runs the repo expiry right after the sweep and reports the count', async () => {
    const order: string[] = []
    const { repo, calls } = fakeRepo([post()], {
      sweepAbandoned: async () => { order.push('sweep'); return 0 },
      expireStale: async () => { order.push('expire'); return 2 },
    })
    const result = await tick({ isEnabled: enabled, maxPerDay: cap(3), publish: publishOk, repo })
    expect(order).toEqual(['sweep', 'expire'])
    expect(result.expired).toBe(2)
    // Expiry never touches the approved row the tick goes on to publish.
    expect(calls.posted).toEqual([1])
  })

  it('leaves the result free of a count when the repo has no expiry (legacy fakes)', async () => {
    const { repo } = fakeRepo([post()])
    const result = await tick({ isEnabled: enabled, maxPerDay: cap(3), publish: publishOk, repo })
    expect(result).not.toHaveProperty('expired')
  })

  it('does not run when the valve is off', async () => {
    const expireStale = vi.fn(async () => 1)
    const { repo } = fakeRepo([post()], { expireStale })
    await tick({ isEnabled: async () => false, maxPerDay: cap(3), publish: publishOk, repo })
    expect(expireStale).not.toHaveBeenCalled()
  })

  it('reports the count even when the tick then stops at the daily cap', async () => {
    const { repo } = fakeRepo([post()], { countPublishedToday: async () => 3, expireStale: async () => 1 })
    const result = await tick({ isEnabled: enabled, maxPerDay: cap(3), publish: publishOk, repo })
    expect(result.skipped).toBe('daily_cap')
    expect(result.expired).toBe(1)
  })
})

describe('expiredFeedback', () => {
  it('writes the missed slot on the LA wall clock ahead of the prior feedback', () => {
    const text = expiredFeedback(new Date('2026-08-23T16:00:00Z'), 'Gate: REVISE, packshot too dark.')
    expect(text.startsWith(
      `${EXPIRED_PREFIX} Slot Sun Aug 23, 9:00 AM PDT passed without approval; reschedule or re-draft.`,
    )).toBe(true)
    expect(text).toContain('Gate: REVISE, packshot too dark.')
  })

  it('keeps a gate stamp inside the prior text parseable (burn-in, #4913)', async () => {
    const { parseGateStamp } = await import('./social-publish-approve.server')
    const hold = '[publish-gate HOLD by social-publish-gate on 2026-08-12, product: dame-aer]\nNovel situation.'
    const text = expiredFeedback(new Date('2026-08-23T16:00:00Z'), hold)
    expect(text.startsWith(EXPIRED_PREFIX)).toBe(true)
    expect(parseGateStamp(text)?.verdict).toBe('HOLD')
    expect(parseGateStamp(text)?.productHandle).toBe('dame-aer')
  })

  it('labels PST in winter and stands alone when there was no prior feedback', () => {
    expect(expiredFeedback(new Date('2026-01-15T17:00:00Z'), null)).toBe(
      `${EXPIRED_PREFIX} Slot Thu Jan 15, 9:00 AM PST passed without approval; reschedule or re-draft.`,
    )
  })
})
