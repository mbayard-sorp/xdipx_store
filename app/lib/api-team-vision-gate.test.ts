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
const runProductFidelityCheckOnImagesMock = vi.hoisted(() => vi.fn())
const isValidVerdictShapeMock = vi.hoisted(() => vi.fn())
const enforceEnumeratedAnatomyMock = vi.hoisted(() => vi.fn())
const recordVisionVerdictMock = vi.hoisted(() => vi.fn())

const TEAM_IDS = ['homepage', 'social', 'ads', 'email', 'strategy', 'content', 'product', 'video', 'support']
vi.mock('~/lib/team.server', () => ({
  assertTeamAuth: vi.fn(),
  gate: gateMock,
  isTeamId: (v: unknown): boolean => typeof v === 'string' && TEAM_IDS.includes(v),
}))
vi.mock('~/lib/social-vision-gate.server', () => ({
  runVisionGate: runVisionGateMock,
  runVisionGateOnImage: runVisionGateOnImageMock,
  regateAsset: regateAssetMock,
  isValidVerdictShape: isValidVerdictShapeMock,
  enforceEnumeratedAnatomy: enforceEnumeratedAnatomyMock,
  recordVisionVerdict: recordVisionVerdictMock,
}))
vi.mock('~/lib/social-product-fidelity.server', () => ({
  runProductFidelityCheckOnImages: runProductFidelityCheckOnImagesMock,
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

const FIDELITY_VERDICT = {
  silhouette: 'match', colour: 'match', finish: 'match', brandMark: 'match',
  notes: 'faithful to reference', checkedAt: '2026-10-03T00:00:00Z', checkCompleted: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  gateMock.mockResolvedValue({ ok: true })
  runVisionGateMock.mockResolvedValue(VERDICT)
  runVisionGateOnImageMock.mockResolvedValue(VERDICT)
  regateAssetMock.mockResolvedValue(VERDICT)
  runProductFidelityCheckOnImagesMock.mockResolvedValue(FIDELITY_VERDICT)
  isValidVerdictShapeMock.mockReturnValue(true)
  enforceEnumeratedAnatomyMock.mockImplementation((v: unknown) => v)
  recordVisionVerdictMock.mockResolvedValue(undefined)
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

// Ticket #11856: the route used to hardcode gate('content', runId) for every
// caller, so a homepage-team candidate was judged against the unrelated
// content team's run_in_progress lock and failed closed whenever any content
// run happened to be active (run 1099, 2026-09-27: 4 slots attempted, 0
// placed). `team` in the body picks which team's lock/budget gate() checks.
describe('calling team (ticket #11856)', () => {
  it('defaults to gate("content", ...) when no team is given, for back-compat', async () => {
    const res = await post({ imageUrl: 'https://cdn.shopify.com/files/x.jpg', runId: 42 })
    expect(res.status).toBe(200)
    expect(gateMock).toHaveBeenCalledWith('content', 42)
  })

  it('gates on the given team instead of content', async () => {
    const res = await post({ imageUrl: 'https://cdn.shopify.com/files/x.jpg', runId: 7, team: 'homepage' })
    expect(res.status).toBe(200)
    expect(gateMock).toHaveBeenCalledWith('homepage', 7)
  })

  it('falls back to content on an unrecognised team value rather than passing it through unchecked', async () => {
    const res = await post({ imageUrl: 'https://cdn.shopify.com/files/x.jpg', team: 'not-a-real-team' })
    expect(res.status).toBe(200)
    expect(gateMock).toHaveBeenCalledWith('content', undefined)
  })

  it('a content run in progress no longer blocks a homepage-team call', async () => {
    gateMock.mockImplementation(async (team: string) =>
      team === 'content'
        ? { ok: false, reason: 'run_in_progress', blockingRun: { id: 900, runType: 'dev', idleMinutes: 2 } }
        : { ok: true },
    )
    const res = await post({ imageUrl: 'https://cdn.shopify.com/files/x.jpg', runId: 1099, team: 'homepage' })
    expect(res.status).toBe(200)
    expect(runVisionGateMock).toHaveBeenCalled()
  })
})

// Ticket #13526 (split 1-of-3 off #13398): the already-extracted `runId`
// now also flows into the vision-check calls themselves as `refId`, not
// only into `gate()`, so a spend row can be correlated back to the run that
// produced it.
describe('refId forwarding (ticket #13526)', () => {
  it('passes runId (stringified) as refId to runVisionGate', async () => {
    const res = await post({ imageUrl: 'https://cdn.shopify.com/files/x.jpg', runId: 42 })
    expect(res.status).toBe(200)
    expect(runVisionGateMock).toHaveBeenCalledWith('https://cdn.shopify.com/files/x.jpg', undefined, '42')
  })

  it('passes runId (stringified) as refId to runVisionGateOnImage', async () => {
    const res = await post({ imageBase64: 'abc', mediaType: 'image/jpeg', runId: 7 })
    expect(res.status).toBe(200)
    expect(runVisionGateOnImageMock).toHaveBeenCalledWith({ data: 'abc', mediaType: 'image/jpeg' }, undefined, '7')
  })

  it('passes runId (stringified) as refId to regateAsset', async () => {
    const res = await post({ imageUrl: 'https://cdn.shopify.com/files/onskin.jpg', assetId: 238, runId: 99 })
    expect(res.status).toBe(200)
    expect(regateAssetMock).toHaveBeenCalledWith(238, 'https://cdn.shopify.com/files/onskin.jpg', undefined, '99')
  })

  it('passes runId (stringified) as refId to runProductFidelityCheckOnImages', async () => {
    const res = await post({
      mode: 'fidelity',
      imageBase64: 'rendered-b64',
      mediaType: 'image/png',
      referenceImageBase64: 'reference-b64',
      referenceMediaType: 'image/jpeg',
      runId: 13,
    })
    expect(res.status).toBe(200)
    expect(runProductFidelityCheckOnImagesMock).toHaveBeenCalledWith(
      { data: 'rendered-b64', mediaType: 'image/png' },
      { data: 'reference-b64', mediaType: 'image/jpeg' },
      undefined,
      '13',
    )
  })

  it('omits refId entirely (no trailing args) when no runId is given', async () => {
    const res = await post({ imageUrl: 'https://cdn.shopify.com/files/x.jpg' })
    expect(res.status).toBe(200)
    expect(runVisionGateMock).toHaveBeenCalledWith('https://cdn.shopify.com/files/x.jpg')
  })
})

// Ticket #13333: the product-fidelity mode, the server-side sibling of the
// anatomy branch above for gateProductFidelityBuffer's own remote fallback.
// A cloud content run has no ANTHROPIC_API_KEY, so without this route
// support the fidelity check failed closed on every run.
// Ticket #13524 (split off #13397 1-of-5): a pre-computed verdict skips the
// in-process Anthropic call entirely and is written straight through
// recordVisionVerdict, shape-validated against the same contract a model
// response has to pass.
describe('record-only mode (ticket #13524)', () => {
  const PRECOMPUTED_VERDICT = {
    pass: true,
    checks: {
      limbCount: 'pass', handAnatomy: 'pass', faceBodyIntegrity: 'pass', extraOrMergedLimbs: 'pass',
      nippleOccluded: 'pass', genitaliaAbsent: 'pass', anusNotVisible: 'pass', adultUnambiguous: 'pass',
    },
    notes: 'Judged elsewhere.',
    legibleText: '',
    skinMarks: '',
    productPhysics: 'not_applicable',
    handDigitCounts: [],
    backAnatomyRead: '',
    frontWaistbandRead: '',
  }

  it('(a) accepts a well-formed pre-computed verdict, records it, and never calls the model', async () => {
    const res = await post({ verdict: PRECOMPUTED_VERDICT, assetId: 500 })
    expect(res.status).toBe(200)
    expect(isValidVerdictShapeMock).toHaveBeenCalledWith(PRECOMPUTED_VERDICT)
    expect(recordVisionVerdictMock).toHaveBeenCalledWith(
      500,
      expect.objectContaining({ pass: true, checkCompleted: true }),
    )
    expect(runVisionGateMock).not.toHaveBeenCalled()
    expect(runVisionGateOnImageMock).not.toHaveBeenCalled()
    expect(regateAssetMock).not.toHaveBeenCalled()
    const body = await res.json() as { recorded?: boolean; assetId?: number; pass?: boolean }
    expect(body.recorded).toBe(true)
    expect(body.assetId).toBe(500)
    expect(body.pass).toBe(true)
  })

  it('applies the enumerated-anatomy override to a pre-computed verdict before recording it', async () => {
    await post({ verdict: PRECOMPUTED_VERDICT, assetId: 500 })
    expect(enforceEnumeratedAnatomyMock).toHaveBeenCalledWith(
      expect.objectContaining({ ...PRECOMPUTED_VERDICT, checkCompleted: true }),
    )
  })

  it('(b) rejects a malformed verdict (400, fail closed) without recording anything', async () => {
    isValidVerdictShapeMock.mockReturnValue(false)
    const res = await post({ verdict: { nonsense: true }, assetId: 500 })
    expect(res.status).toBe(400)
    expect(recordVisionVerdictMock).not.toHaveBeenCalled()
  })

  it('rejects a pre-computed verdict with no assetId to record against', async () => {
    const res = await post({ verdict: PRECOMPUTED_VERDICT })
    expect(res.status).toBe(400)
    expect(recordVisionVerdictMock).not.toHaveBeenCalled()
    expect(isValidVerdictShapeMock).not.toHaveBeenCalled()
  })

  it('still runs the money gate, and refuses before recording when gated', async () => {
    gateMock.mockResolvedValue({ ok: false, reason: 'over_budget' })
    const res = await post({ verdict: PRECOMPUTED_VERDICT, assetId: 500 })
    expect(res.status).toBe(403)
    expect(recordVisionVerdictMock).not.toHaveBeenCalled()
  })

  // (c) every existing test below (and above) exercises the route with no
  // `verdict` field at all and is unaffected by this branch.
  it('(c) does not take the record-only branch when verdict is omitted', async () => {
    const res = await post({ imageUrl: 'https://cdn.shopify.com/files/x.jpg', assetId: 238 })
    expect(res.status).toBe(200)
    expect(isValidVerdictShapeMock).not.toHaveBeenCalled()
    expect(recordVisionVerdictMock).not.toHaveBeenCalled()
    expect(regateAssetMock).toHaveBeenCalledWith(238, 'https://cdn.shopify.com/files/x.jpg')
  })
})

describe('fidelity mode (ticket #13333)', () => {
  it('runs the fidelity check and returns the ProductFidelityVerdict unchanged', async () => {
    const res = await post({
      mode: 'fidelity',
      imageBase64: 'rendered-b64',
      mediaType: 'image/png',
      referenceImageBase64: 'reference-b64',
      referenceMediaType: 'image/jpeg',
    })
    expect(res.status).toBe(200)
    expect(runProductFidelityCheckOnImagesMock).toHaveBeenCalledWith(
      { data: 'rendered-b64', mediaType: 'image/png' },
      { data: 'reference-b64', mediaType: 'image/jpeg' },
    )
    const body = await res.json()
    expect(body).toEqual(FIDELITY_VERDICT)
    expect(runVisionGateOnImageMock).not.toHaveBeenCalled()
  })

  it('rejects a fidelity request with no reference image', async () => {
    const res = await post({ mode: 'fidelity', imageBase64: 'rendered-b64', mediaType: 'image/png' })
    expect(res.status).toBe(400)
    expect(runProductFidelityCheckOnImagesMock).not.toHaveBeenCalled()
  })

  it('rejects a fidelity request with no candidate image', async () => {
    const res = await post({ mode: 'fidelity', referenceImageBase64: 'reference-b64', referenceMediaType: 'image/jpeg' })
    expect(res.status).toBe(400)
    expect(runProductFidelityCheckOnImagesMock).not.toHaveBeenCalled()
  })

  it('gates on the calling team like the anatomy branch, defaulting to content', async () => {
    const res = await post({
      mode: 'fidelity',
      imageBase64: 'rendered-b64',
      mediaType: 'image/png',
      referenceImageBase64: 'reference-b64',
      referenceMediaType: 'image/jpeg',
      runId: 1220,
    })
    expect(res.status).toBe(200)
    expect(gateMock).toHaveBeenCalledWith('content', 1220)
  })

  it('refuses when the team is gated, without ever running the fidelity check', async () => {
    gateMock.mockResolvedValue({ ok: false, reason: 'over_budget' })
    const res = await post({
      mode: 'fidelity',
      imageBase64: 'rendered-b64',
      mediaType: 'image/png',
      referenceImageBase64: 'reference-b64',
      referenceMediaType: 'image/jpeg',
    })
    expect(res.status).toBe(403)
    expect(runProductFidelityCheckOnImagesMock).not.toHaveBeenCalled()
  })

  it('does not take the fidelity branch when mode is omitted, preserving the anatomy default', async () => {
    const res = await post({ imageBase64: 'rendered-b64', mediaType: 'image/png' })
    expect(res.status).toBe(200)
    expect(runVisionGateOnImageMock).toHaveBeenCalled()
    expect(runProductFidelityCheckOnImagesMock).not.toHaveBeenCalled()
  })
})
