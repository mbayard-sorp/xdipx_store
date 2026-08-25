/**
 * Guard tests for POST /api/admin/social-rework (ticket #5414). The four
 * social-admin-rework.server functions are mocked; what's under test is the
 * route contract: intent dispatch, field validation, the money gate on
 * regenerate-image only, and pass-through to each function.
 *
 * Lives in app/lib rather than next to the route: anything in app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included (see
 * api-team-social-image.test.ts for the same convention).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireAdminMock = vi.hoisted(() => vi.fn(async () => {}))
const getAdminUserMock = vi.hoisted(() => vi.fn(async () => ({ name: 'Mike' })))
const gateMock = vi.hoisted(() => vi.fn())
const reworkCaptionMock = vi.hoisted(() => vi.fn())
const regenerateSocialImageMock = vi.hoisted(() => vi.fn())
const createOwnerReworkRowMock = vi.hoisted(() => vi.fn())
const ownerApprovePostMock = vi.hoisted(() => vi.fn())

vi.mock('~/lib/session.server', () => ({
  requireAdmin: requireAdminMock,
  getAdminUser: getAdminUserMock,
}))
vi.mock('~/lib/team.server', () => ({ gate: gateMock }))
vi.mock('~/lib/social-media.server', () => ({
  SOCIAL_ARCHETYPES: ['scene', 'cast', 'metaphor', 'macro', 'plate'],
}))
vi.mock('~/lib/social-admin-rework.server', () => ({
  reworkCaption: reworkCaptionMock,
  regenerateSocialImage: regenerateSocialImageMock,
  createOwnerReworkRow: createOwnerReworkRowMock,
  ownerApprovePost: ownerApprovePostMock,
}))
vi.mock('~/lib/api-error.server', () => ({
  apiError: (_tag: string, err: unknown) =>
    Response.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 }),
}))

import { action } from '~/routes/api.admin.social-rework'

function post(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('http://localhost/api/admin/social-rework', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAdminMock.mockResolvedValue(undefined)
  getAdminUserMock.mockResolvedValue({ name: 'Mike' })
  gateMock.mockResolvedValue({ ok: true, spentCents: 0, dailyCents: 500, imagesToday: 0, maxImagesPerDay: 0 })
})

describe('method guard', () => {
  it('rejects a non-POST method', async () => {
    const request = new Request('http://localhost/api/admin/social-rework', { method: 'GET' })
    const res = await action({ request, params: {}, context: {} } as never) as Response
    expect(res.status).toBe(405)
  })

  it('rejects an unknown intent', async () => {
    const res = await post({ intent: 'delete-everything' })
    expect(res.status).toBe(400)
  })
})

describe('rework-caption', () => {
  it('validates postId and feedback', async () => {
    const res1 = await post({ intent: 'rework-caption', feedback: 'x' })
    expect(res1.status).toBe(400)
    const res2 = await post({ intent: 'rework-caption', postId: 61 })
    expect(res2.status).toBe(400)
    expect(reworkCaptionMock).not.toHaveBeenCalled()
  })

  it('passes postId, feedback, and the resolved actor through', async () => {
    reworkCaptionMock.mockResolvedValue({ ok: true, caption: 'a fixed line', altText: 'a', hashtags: [] })
    const res = await post({ intent: 'rework-caption', postId: 61, feedback: 'tighten it up' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, caption: 'a fixed line' })
    expect(reworkCaptionMock).toHaveBeenCalledWith({ postId: 61, feedback: 'tighten it up', actor: 'Mike' })
  })

  it('returns 422 when the redraft is blocked', async () => {
    reworkCaptionMock.mockResolvedValue({ ok: false, error: 'still blocked' })
    const res = await post({ intent: 'rework-caption', postId: 61, feedback: 'x' })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ ok: false, error: 'still blocked' })
  })
})

describe('regenerate-image', () => {
  it('validates postId and feedback before ever checking the gate', async () => {
    const res = await post({ intent: 'regenerate-image', postId: 61 })
    expect(res.status).toBe(400)
    expect(gateMock).not.toHaveBeenCalled()
    expect(regenerateSocialImageMock).not.toHaveBeenCalled()
  })

  it('calls gate("social") and generates when open', async () => {
    regenerateSocialImageMock.mockResolvedValue({ ok: true, url: 'https://cdn/x.jpg', prompt: 'p' })
    const res = await post({ intent: 'regenerate-image', postId: 61, feedback: 'warmer light' })
    expect(res.status).toBe(200)
    expect(gateMock).toHaveBeenCalledWith('social')
    expect(regenerateSocialImageMock).toHaveBeenCalledWith({ postId: 61, feedback: 'warmer light', actor: 'Mike' })
  })

  it('returns an explicit 403 reason, never a silent no-op, when the budget gate is closed', async () => {
    gateMock.mockResolvedValue({ ok: false, reason: 'over_budget', spentCents: 500, dailyCents: 500, imagesToday: 0, maxImagesPerDay: 0 })
    const res = await post({ intent: 'regenerate-image', postId: 61, feedback: 'x' })
    expect(res.status).toBe(403)
    const body = await res.json() as { ok: boolean; reason: string; message: string }
    expect(body.ok).toBe(false)
    expect(body.reason).toBe('over_budget')
    expect(body.message).toMatch(/over its daily budget/)
    expect(regenerateSocialImageMock).not.toHaveBeenCalled()
  })

  it('refuses over the image cap even when ok:true (ticket #5429 fix 4 semantics)', async () => {
    gateMock.mockResolvedValue({ ok: true, spentCents: 0, dailyCents: 500, imagesToday: 12, maxImagesPerDay: 12 })
    const res = await post({ intent: 'regenerate-image', postId: 61, feedback: 'x' })
    expect(res.status).toBe(403)
    expect((await res.json() as { reason: string }).reason).toBe('over_image_cap')
    expect(regenerateSocialImageMock).not.toHaveBeenCalled()
  })

  it('surfaces a backend failure honestly rather than appearing to succeed', async () => {
    regenerateSocialImageMock.mockResolvedValue({ ok: false, error: 'The provider returned nothing.' })
    const res = await post({ intent: 'regenerate-image', postId: 61, feedback: 'x' })
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ ok: false, error: 'The provider returned nothing.' })
  })
})

describe('create-rework-row', () => {
  it('validates fromPostId and caption', async () => {
    const res = await post({ intent: 'create-rework-row', caption: 'x' })
    expect(res.status).toBe(400)
    expect(createOwnerReworkRowMock).not.toHaveBeenCalled()
  })

  it('creates the row and returns its id, filtering mediaUrls to strings', async () => {
    createOwnerReworkRowMock.mockResolvedValue({ id: 77 })
    const res = await post({
      intent: 'create-rework-row',
      fromPostId: 61,
      caption: 'the new caption',
      altText: 'alt',
      mediaUrls: ['https://cdn/a.jpg', 42],
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, id: 77 })
    expect(createOwnerReworkRowMock).toHaveBeenCalledWith(expect.objectContaining({
      fromPostId: 61,
      caption: 'the new caption',
      altText: 'alt',
      mediaUrls: ['https://cdn/a.jpg'],
      actor: 'Mike',
    }))
  })

  it('returns 404 with the source-missing message when the function throws', async () => {
    createOwnerReworkRowMock.mockRejectedValue(new Error('No social post 999 to rework from'))
    const res = await post({ intent: 'create-rework-row', fromPostId: 999, caption: 'x' })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ ok: false, error: 'No social post 999 to rework from' })
  })
})

describe('owner-approve', () => {
  it('validates postId', async () => {
    const res = await post({ intent: 'owner-approve' })
    expect(res.status).toBe(400)
    expect(ownerApprovePostMock).not.toHaveBeenCalled()
  })

  it('approves and returns ok:true', async () => {
    ownerApprovePostMock.mockResolvedValue({ ok: true })
    const res = await post({ intent: 'owner-approve', postId: 61 })
    expect(res.status).toBe(200)
    expect(ownerApprovePostMock).toHaveBeenCalledWith({ postId: 61, actor: 'Mike' })
  })

  it('returns 409 with findings when deterministic checks block it', async () => {
    ownerApprovePostMock.mockResolvedValue({ ok: false, error: 'blocked', findings: [{ check: 'x' }] })
    const res = await post({ intent: 'owner-approve', postId: 61 })
    expect(res.status).toBe(409)
  })
})

describe('auth', () => {
  it('calls requireAdmin before doing anything else', async () => {
    await post({ intent: 'rework-caption', postId: 61, feedback: 'x' })
    expect(requireAdminMock).toHaveBeenCalled()
  })
})
