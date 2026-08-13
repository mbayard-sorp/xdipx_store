// The Instagram scheduled-publish tick (ticket #2740).
//
// This is the code that puts a post on a public account with nobody watching,
// so the cases below are the ones where getting it wrong is expensive: double
// publishing, publishing past a cap, publishing something the gate blocked, and
// retrying forever against a live API.
import { describe, it, expect, vi } from 'vitest'
import {
  runSocialPublishTick,
  MAX_PER_TICK,
  type PublishRepo,
  type PostRow,
} from './social-publish-job.server'

const CDN = 'https://cdn.shopify.com/s/files/1/0761/6872/4651/files'

function post(over: Partial<PostRow> = {}): PostRow {
  return {
    id: 1, platform: 'instagram', postType: 'campaign', externalPostId: null,
    parentPostId: null, dealHistoryId: null,
    tweetText: 'a detail about silicone grades nobody mentions out loud',
    mediaUrls: [`${CDN}/social-rosales-cast-maya-20260812-1.jpg`],
    mediaIds: null, status: 'draft', errorMessage: null, postedAt: null,
    createdAt: new Date('2026-08-01'), createdBy: 'agent',
    reviewStatus: 'approved', feedback: null, editedText: null,
    reviewedBy: null, reviewedAt: null, scheduledFor: '2026-08-12',
    reworkedFrom: null, videoJobId: null, posterUrl: null,
    ...over,
  } as PostRow
}

/** An in-memory repo that records what the tick did. */
function fakeRepo(rows: PostRow[], over: Partial<PublishRepo> = {}) {
  const calls = {
    posted: [] as number[],
    needsChanges: [] as { id: number; feedback: string }[],
    failed: [] as { id: number; terminal: boolean }[],
    swept: 0,
  }
  const repo: PublishRepo = {
    sweepAbandoned: async () => { calls.swept++; return 0 },
    countPublishedToday: async () => 0,
    listEligible: async (limit) => rows.slice(0, limit),
    recentCaptions: async () => [],
    claim: async (id) => rows.find(r => r.id === id) ?? null,
    markPosted: async (id) => { calls.posted.push(id) },
    markNeedsChanges: async (id, feedback) => { calls.needsChanges.push({ id, feedback }) },
    markFailed: async (id, _d, terminal) => { calls.failed.push({ id, terminal }) },
    ...over,
  }
  return { repo, calls }
}

const enabled = async () => true
const cap = (n: number) => async () => n
const publishOk = vi.fn(async () => ({ ok: true as const, externalPostId: 'ig_1' }))

describe('the valve', () => {
  it('does nothing at all when off, which is how it ships', async () => {
    const { repo, calls } = fakeRepo([post()])
    const publish = vi.fn()
    const r = await runSocialPublishTick({
      isEnabled: async () => false, maxPerDay: cap(3), publish, repo,
    })
    expect(r.skipped).toBe('valve_off')
    expect(publish).not.toHaveBeenCalled()
    // Not even the sweep runs: off means off.
    expect(calls.swept).toBe(0)
  })
})

describe('caps', () => {
  it('stops at the daily cap', async () => {
    const { repo } = fakeRepo([post()], { countPublishedToday: async () => 3 })
    const publish = vi.fn()
    const r = await runSocialPublishTick({ isEnabled: enabled, maxPerDay: cap(3), publish, repo })
    expect(r.skipped).toBe('daily_cap')
    expect(publish).not.toHaveBeenCalled()
  })

  it('never asks for more rows than the day has room for', async () => {
    // Two already out, cap of 3: one slot left even though the tick allows more.
    const seen: number[] = []
    const { repo } = fakeRepo([], {
      countPublishedToday: async () => 2,
      listEligible: async (limit) => { seen.push(limit); return [] },
    })
    await runSocialPublishTick({ isEnabled: enabled, maxPerDay: cap(3), publish: publishOk, repo })
    expect(seen).toEqual([1])
  })

  it('never exceeds the per-tick ceiling even with a large backlog', async () => {
    const seen: number[] = []
    const { repo } = fakeRepo([], {
      listEligible: async (limit) => { seen.push(limit); return [] },
    })
    await runSocialPublishTick({ isEnabled: enabled, maxPerDay: cap(50), publish: publishOk, repo })
    expect(seen).toEqual([MAX_PER_TICK])
  })
})

describe('claiming', () => {
  it('skips a row another tick already took, instead of publishing it twice', async () => {
    const { repo } = fakeRepo([post()], { claim: async () => null })
    const publish = vi.fn()
    const r = await runSocialPublishTick({ isEnabled: enabled, maxPerDay: cap(3), publish, repo })
    expect(r.attempts).toEqual([{ postId: 1, outcome: 'claim_lost' }])
    expect(publish).not.toHaveBeenCalled()
  })
})

describe('the gate runs at publish time', () => {
  it('does not publish a post carrying a retired packshot', async () => {
    const { repo, calls } = fakeRepo([post({ mediaUrls: [`${CDN}/77292A.jpg`] })])
    const publish = vi.fn()
    const r = await runSocialPublishTick({ isEnabled: enabled, maxPerDay: cap(3), publish, repo })
    expect(publish).not.toHaveBeenCalled()
    expect(r.attempts[0]?.outcome).toBe('blocked_by_gate')
    // Returned to the queue with a reason, not silently dropped.
    expect(calls.needsChanges[0]?.feedback).toContain('image-provenance')
  })

  it('does not publish a product that went out of stock after approval', async () => {
    // The 2026-08-09 incident: approved when in stock, published when not.
    const { repo, calls } = fakeRepo([post()])
    const publish = vi.fn()
    await runSocialPublishTick({
      isEnabled: enabled, maxPerDay: cap(3), publish, repo,
      productHandleFor: async () => 'gone-oos',
      gateDeps: { getAvailability: async () => false },
    })
    expect(publish).not.toHaveBeenCalled()
    expect(calls.needsChanges[0]?.feedback).toContain('stock-out')
  })

  it('publishes a clean post', async () => {
    const { repo, calls } = fakeRepo([post()])
    const r = await runSocialPublishTick({
      isEnabled: enabled, maxPerDay: cap(3), publish: publishOk, repo,
    })
    expect(r.attempts).toEqual([{ postId: 1, outcome: 'published' }])
    expect(calls.posted).toEqual([1])
  })
})

describe('failure handling', () => {
  it('returns a first failure to the queue rather than giving up', async () => {
    const { repo, calls } = fakeRepo([post({ errorMessage: null })])
    const r = await runSocialPublishTick({
      isEnabled: enabled, maxPerDay: cap(3), repo,
      publish: async () => ({ ok: false, detail: 'Meta 500' }),
    })
    expect(calls.failed).toEqual([{ id: 1, terminal: false }])
    expect(r.attempts[0]?.detail).toContain('will retry')
  })

  it('goes terminal on the second failure instead of retrying forever', async () => {
    // A row already carrying an error message is on its second attempt.
    const { repo, calls } = fakeRepo([post({ errorMessage: 'Meta 500' })])
    const r = await runSocialPublishTick({
      isEnabled: enabled, maxPerDay: cap(3), repo,
      publish: async () => ({ ok: false, detail: 'Meta 500 again' }),
    })
    expect(calls.failed).toEqual([{ id: 1, terminal: true }])
    expect(r.attempts[0]?.detail).toContain('terminal')
  })
})

describe('the owner edit wins', () => {
  it('gates and publishes the edited caption, not the original draft', async () => {
    // If he rewrote it, the rewrite is what ships and what gets checked.
    const { repo } = fakeRepo([post({
      tweetText: 'original',
      editedText: 'his rewrite, $19.99 today only',
    })])
    const publish = vi.fn()
    const r = await runSocialPublishTick({ isEnabled: enabled, maxPerDay: cap(3), publish, repo })
    expect(publish).not.toHaveBeenCalled()
    expect(r.attempts[0]?.findings?.map(f => f.check)).toContain('sale-price')
  })
})
