/**
 * Guard tests for POST /api/team/social-post's `draft` op X-media preflight
 * (ticket #4140, split from #4131). The pre-publish gate blocks a media-less X
 * post, so the write path must refuse one too — failing closed like the
 * voiceGate check. The rule is X-scoped; other platforms keep their existing
 * draft behavior (their media requirement is enforced at the gate).
 *
 * Lives in app/lib rather than next to the route: anything in app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const createDraftMock = vi.hoisted(() => vi.fn())
const voiceGateMock = vi.hoisted(() => vi.fn())

vi.mock('~/lib/team.server', () => ({
  assertTeamAuth: vi.fn(),
  createDraftSocialPost: createDraftMock,
  listSocialPosts: vi.fn().mockResolvedValue([]),
  getSocialFrequencies: vi.fn().mockResolvedValue({}),
  getValve: vi.fn().mockResolvedValue(false),
  VALVE_KEYS: { socialAutopost: 'social_autopost' },
}))
vi.mock('~/lib/team-keys', () => ({
  SOCIAL_PLATFORMS: ['x', 'instagram', 'tiktok', 'facebook', 'youtube', 'linkedin'],
  SOCIAL_REVIEW_STATUSES: ['pending_review', 'approved', 'needs_changes', 'rejected'],
}))
vi.mock('~/lib/social-voice-gate.server', () => ({ parseVoiceGateVerdict: voiceGateMock }))
vi.mock('~/lib/social-publish-approve.server', () => ({
  applyPublishGateVerdict: vi.fn(),
  parsePublishGateVerdict: vi.fn(),
}))
vi.mock('~/lib/social-engagement.server', () => ({
  captureSocialEngagement: vi.fn().mockResolvedValue([]),
  captureInstagramAccount: vi.fn().mockResolvedValue({}),
  rankBySaves: (r: unknown[]) => r,
}))

import { action } from '~/routes/api.team.social-post'

function post(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('http://localhost/api/team/social-post', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

const voiceGate = { verdict: 'PASS', reviewer: 'emma-empathy-reviewer' }

beforeEach(() => {
  vi.clearAllMocks()
  voiceGateMock.mockReturnValue({ ok: true, verdict: voiceGate })
  createDraftMock.mockResolvedValue({ id: 42, deduped: false })
})

describe('draft op — X media preflight', () => {
  it('rejects an X draft with no mediaUrls', async () => {
    const res = await post({ op: 'draft', platform: 'x', tweetText: 'A fresh line about the wand', voiceGate })
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/mediaUrls/)
    expect(createDraftMock).not.toHaveBeenCalled()
  })

  it('rejects an X draft with an empty mediaUrls array', async () => {
    const res = await post({ op: 'draft', platform: 'x', tweetText: 'A fresh line', voiceGate, mediaUrls: [] })
    expect(res.status).toBe(400)
    expect(createDraftMock).not.toHaveBeenCalled()
  })

  it('accepts an X draft that carries a media URL', async () => {
    const res = await post({
      op: 'draft', platform: 'x', tweetText: 'A fresh line', voiceGate,
      mediaUrls: ['https://cdn.shopify.com/files/social-x-scene-20260818.jpg'],
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 42, deduped: false })
    expect(createDraftMock).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'x',
      mediaUrls: ['https://cdn.shopify.com/files/social-x-scene-20260818.jpg'],
    }))
  })

  it('leaves non-X drafts unchanged (Instagram media is gated elsewhere, not at write time)', async () => {
    const res = await post({ op: 'draft', platform: 'instagram', tweetText: 'IG caption', voiceGate })
    expect(res.status).toBe(200)
    expect(createDraftMock).toHaveBeenCalledWith(expect.objectContaining({ platform: 'instagram' }))
  })

  it('still fails closed on the voice gate before reaching the media preflight', async () => {
    voiceGateMock.mockReturnValue({ ok: false, status: 400, error: 'Bad Request: voiceGate must be an object' })
    const res = await post({ op: 'draft', platform: 'x', tweetText: 'no gate' })
    expect(res.status).toBe(400)
    expect(createDraftMock).not.toHaveBeenCalled()
  })
})

// Ticket #4069: the route surfaces whatever createDraftSocialPost decides —
// a fresh row or the existing open duplicate — verbatim, so a caller can tell
// the two apart instead of always seeing a bare `{ id }`.
describe('draft op — idempotency surfacing (#4069)', () => {
  it('passes through deduped:true and the existing row id unchanged', async () => {
    createDraftMock.mockResolvedValue({ id: 46, deduped: true })
    const res = await post({
      op: 'draft', platform: 'instagram', tweetText: 'starting a little series', voiceGate,
      mediaUrls: ['https://cdn.shopify.com/files/ig-scene.jpg'], scheduledFor: '2026-08-16',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 46, deduped: true })
  })
})
