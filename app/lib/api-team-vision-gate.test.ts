/**
 * Guard tests for POST /api/team/vision-gate (ticket #8989, extended #10511).
 * The gate functions are mocked; what's under test is the route contract:
 * field validation, the money gate, and the `assetId` re-gate opt-in.
 *
 * Lives in app/lib rather than next to the route: anything in app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gateMock = vi.hoisted(() => vi.fn())
const runVisionGateMock = vi.hoisted(() => vi.fn())
const runVisionGateOnImageMock = vi.hoisted(() => vi.fn())
const regateAssetMock = vi.hoisted(() => vi.fn())

vi.mock('~/lib/team.server', () => ({
  assertTeamAuth: vi.fn(),
  gate: gateMock,
}))
vi.mock('~/lib/social-vision-gate.server', () => ({
  runVisionGate: runVisionGateMock,
  runVisionGateOnImage: runVisionGateOnImageMock,
  regateAsset: regateAssetMock,
}))
vi.mock('~/lib/api-error.server', () => ({
  apiError: (_scope: string, err: unknown) =>
    Response.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 }),
}))

import { action } from '~/routes/api.team.vision-gate'

function post(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('http://localhost/api/team/vision-gate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

const VERDICT = {
  pass: true,
  checks: {
    limbCount: 'pass', handAnatomy: 'pass', faceBodyIntegrity: 'pass', extraOrMergedLimbs: 'pass',
    nippleOccluded: 'pass', genitaliaAbsent: 'pass', anusNotVisible: 'pass', adultUnambiguous: 'pass',
  },
  notes: 'Clean.',
  checkedAt: '2026-09-21T00:00:00Z',
  checkCompleted: true,
  legibleText: '',
}

beforeEach(() => {
  vi.clearAllMocks()
  gateMock.mockResolvedValue({ ok: true })
  runVisionGateMock.mockResolvedValue(VERDICT)
  runVisionGateOnImageMock.mockResolvedValue(VERDICT)
  regateAssetMock.mockResolvedValue(VERDICT)
})

describe('judge-only (no assetId)', () => {
  it('calls runVisionGate for an imageUrl and never re-gates', async () => {
    const res = await post({ imageUrl: 'https://cdn.shopify.com/files/x.jpg' })
    expect(res.status).toBe(200)
    expect(runVisionGateMock).toHaveBeenCalledWith('https://cdn.shopify.com/files/x.jpg')
    expect(regateAssetMock).not.toHaveBeenCalled()
    const body = await res.json() as { recorded?: boolean }
    expect(body.recorded).toBeUndefined()
  })

  it('calls runVisionGateOnImage for a base64 candidate', async () => {
    const res = await post({ imageBase64: 'abc', mediaType: 'image/jpeg' })
    expect(res.status).toBe(200)
    expect(runVisionGateOnImageMock).toHaveBeenCalledWith({ data: 'abc', mediaType: 'image/jpeg' })
  })

  it('rejects a request with neither imageUrl nor a base64 pair', async () => {
    const res = await post({})
    expect(res.status).toBe(400)
  })
})

// Ticket #10511: an assetId alongside imageUrl re-gates and records against
// that existing social_media_assets row instead of only judging.
describe('re-gate opt-in (assetId)', () => {
  it('calls regateAsset instead of runVisionGate when assetId is given', async () => {
    const res = await post({ imageUrl: 'https://cdn.shopify.com/files/onskin.jpg', assetId: 238 })
    expect(res.status).toBe(200)
    expect(regateAssetMock).toHaveBeenCalledWith(238, 'https://cdn.shopify.com/files/onskin.jpg')
    expect(runVisionGateMock).not.toHaveBeenCalled()
    const body = await res.json() as { recorded?: boolean; assetId?: number; pass?: boolean }
    expect(body.recorded).toBe(true)
    expect(body.assetId).toBe(238)
    expect(body.pass).toBe(true)
  })

  it('ignores assetId on a base64 candidate (no url to record against)', async () => {
    const res = await post({ imageBase64: 'abc', mediaType: 'image/jpeg', assetId: 238 })
    expect(res.status).toBe(200)
    expect(regateAssetMock).not.toHaveBeenCalled()
    expect(runVisionGateOnImageMock).toHaveBeenCalled()
  })
})

describe('money gate', () => {
  it('refuses when the content team is gated', async () => {
    gateMock.mockResolvedValue({ ok: false, reason: 'over_budget' })
    const res = await post({ imageUrl: 'https://cdn.shopify.com/files/x.jpg' })
    expect(res.status).toBe(403)
    expect(runVisionGateMock).not.toHaveBeenCalled()
  })
})
