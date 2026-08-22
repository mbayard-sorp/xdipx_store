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
const reworkParseMock = vi.hoisted(() => vi.fn())
const reworkMock = vi.hoisted(() => vi.fn())

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
  parseReworkInput: reworkParseMock,
  reworkSocialPost: reworkMock,
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

// Ticket #2212: the durable product link the publish-time stock guard reads.
describe('draft op — shopifyProductId pass-through', () => {
  it('threads a supplied shopifyProductId to createDraftSocialPost', async () => {
    const res = await post({
      op: 'draft', platform: 'instagram', tweetText: 'A fresh line about the wand', voiceGate,
      shopifyProductId: 'gid://shopify/Product/123',
    })
    expect(res.status).toBe(200)
    expect(createDraftMock).toHaveBeenCalledWith(expect.objectContaining({
      shopifyProductId: 'gid://shopify/Product/123',
    }))
  })

  it('is optional: a draft with no featured product omits it rather than forcing one', async () => {
    const res = await post({ op: 'draft', platform: 'instagram', tweetText: 'License D, no product', voiceGate })
    expect(res.status).toBe(200)
    expect(createDraftMock).toHaveBeenCalledWith(expect.objectContaining({
      shopifyProductId: undefined,
    }))
  })

  it('drops a non-string shopifyProductId rather than passing it through', async () => {
    const res = await post({
      op: 'draft', platform: 'instagram', tweetText: 'bad type', voiceGate, shopifyProductId: 12345,
    })
    expect(res.status).toBe(200)
    expect(createDraftMock).toHaveBeenCalledWith(expect.objectContaining({
      shopifyProductId: undefined,
    }))
  })
})

// Migration 083 (owner direction 2026-08-22): altText/imageBrief/subject pass
// through draft and rework so the accessibility description has somewhere to
// live other than the caption.
describe('draft op, altText/imageBrief/subject pass-through (migration 083)', () => {
  it('threads altText/imageBrief/subject to createDraftSocialPost', async () => {
    const res = await post({
      op: 'draft', platform: 'instagram', tweetText: 'A fresh line about the wand', voiceGate,
      altText: 'Jade holding the wand at a sunlit bathroom sink.',
      imageBrief: 'cast member with product, warm light, no text',
      subject: 'jade + wand, morning light',
    })
    expect(res.status).toBe(200)
    expect(createDraftMock).toHaveBeenCalledWith(expect.objectContaining({
      altText: 'Jade holding the wand at a sunlit bathroom sink.',
      imageBrief: 'cast member with product, warm light, no text',
      subject: 'jade + wand, morning light',
    }))
  })

  it('is optional: a draft with none of them omits all three', async () => {
    const res = await post({ op: 'draft', platform: 'instagram', tweetText: 'no brief here', voiceGate })
    expect(res.status).toBe(200)
    expect(createDraftMock).toHaveBeenCalledWith(expect.objectContaining({
      altText: undefined,
      imageBrief: undefined,
      subject: undefined,
    }))
  })
})

describe('rework op — wiring (#4351)', () => {
  it('rejects a rework with no id', async () => {
    const res = await post({ op: 'rework', mediaUrls: ['https://cdn/x.jpg'] })
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/id required/)
    expect(reworkMock).not.toHaveBeenCalled()
  })

  it('returns the parse error and does not call reworkSocialPost when the payload is invalid', async () => {
    reworkParseMock.mockReturnValue({ ok: false, status: 400, error: 'rework must change something' })
    const res = await post({ op: 'rework', id: 61 })
    expect(res.status).toBe(400)
    expect(await res.text()).toMatch(/change something/)
    expect(reworkMock).not.toHaveBeenCalled()
  })

  it('passes the parsed input to reworkSocialPost and returns its success result', async () => {
    reworkParseMock.mockReturnValue({ ok: true, input: { mediaUrls: ['https://cdn/reworked.jpg'] } })
    reworkMock.mockResolvedValue({ ok: true, reviewStatus: 'pending_review' })
    const res = await post({ op: 'rework', id: 61, mediaUrls: ['https://cdn/reworked.jpg'] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, reviewStatus: 'pending_review' })
    expect(reworkMock).toHaveBeenCalledWith(61, { mediaUrls: ['https://cdn/reworked.jpg'] })
  })

  it('relays a 409 (e.g. the row is not needs_changes) from reworkSocialPost', async () => {
    reworkParseMock.mockReturnValue({ ok: true, input: { tweetText: 'x' } })
    reworkMock.mockResolvedValue({ ok: false, status: 409, error: 'Post 61 is draft/approved, not */needs_changes.' })
    const res = await post({ op: 'rework', id: 61, tweetText: 'x' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/needs_changes/)
  })

  it('passes altText/imageBrief/subject through to parseReworkInput (migration 083)', async () => {
    reworkParseMock.mockReturnValue({ ok: true, input: { mediaUrls: ['https://cdn/reworked.jpg'], altText: 'a', imageBrief: 'b', subject: 'c' } })
    reworkMock.mockResolvedValue({ ok: true, reviewStatus: 'pending_review' })
    const res = await post({
      op: 'rework', id: 61, mediaUrls: ['https://cdn/reworked.jpg'],
      altText: 'a', imageBrief: 'b', subject: 'c',
    })
    expect(res.status).toBe(200)
    expect(reworkParseMock).toHaveBeenCalledWith(expect.objectContaining({
      altText: 'a', imageBrief: 'b', subject: 'c',
    }))
  })
})
