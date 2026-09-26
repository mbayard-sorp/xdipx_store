/**
 * Guard tests for POST /api/team/social-image (ticket #4133). The generation
 * functions are mocked; what's under test is the route contract: field
 * validation, the money gate, and exact pass-through to
 * generateAndUploadSocialImage / generateCastComposite.
 *
 * Lives in app/lib rather than next to the route: anything in app/routes is
 * picked up by flatRoutes/typegen as a route module, tests included.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const gateMock = vi.hoisted(() => vi.fn())
const genMock = vi.hoisted(() => vi.fn())
const castMock = vi.hoisted(() => vi.fn())
const logImageCostMock = vi.hoisted(() => vi.fn())
const rosterMock = vi.hoisted(() => vi.fn())
const productByHandleMock = vi.hoisted(() => vi.fn())
const recordEventMock = vi.hoisted(() => vi.fn())
const captureMessageMock = vi.hoisted(() => vi.fn())

vi.mock('~/lib/team.server', () => ({
  assertTeamAuth: vi.fn(),
  gate: gateMock,
  recordEvent: recordEventMock,
}))
vi.mock('~/lib/sentry.server', () => ({
  Sentry: { captureMessage: captureMessageMock },
}))
vi.mock('~/lib/social-media.server', async () => {
  // Ticket #10981: lengthInchesFromSpecifications/scaleCueFromLengthInches are
  // left REAL, same reasoning as social-cast-reference.server below — the
  // derivation is what several tests here exercise, not a fake to stub out.
  const actual = await vi.importActual<typeof import('~/lib/social-media.server')>('~/lib/social-media.server')
  return {
    ...actual,
    // Real values: the route validates the archetype against this list.
    SOCIAL_ARCHETYPES: ['scene', 'cast', 'metaphor', 'macro', 'plate'],
    generateAndUploadSocialImage: genMock,
    generateCastComposite: castMock,
  }
})
vi.mock('~/lib/api-error.server', () => ({
  apiError: (_scope: string, err: unknown) =>
    Response.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 }),
}))
vi.mock('~/lib/token-log.server', () => ({
  logImageCost: logImageCostMock,
}))
// Ticket #10336/#10341: the cast op now resolves its own presenter reference
// from the roster and can walk a product's media list for a bare-product
// frame, so both reads are mocked. `social-cast-reference.server` is left REAL
// on purpose: the selection rule is what is under test here.
vi.mock('~/lib/sanity.server', () => ({
  getApprovedCastMembers: rosterMock,
  presenterPhotoUrlForCrop: (
    m: { photoUrl: string; bodyReferencePhotoUrl: string | null },
    cropScale: string | null | undefined,
  ) => ((cropScale === 'macro' || cropScale === 'close') && m.bodyReferencePhotoUrl
    ? m.bodyReferencePhotoUrl
    : m.photoUrl),
}))
vi.mock('~/lib/shopify.server', async () => {
  const actual = await vi.importActual<typeof import('~/lib/shopify.server')>('~/lib/shopify.server')
  return { ...actual, getProductByHandle: productByHandleMock }
})

import { action } from '~/routes/api.team.social-image'

function post(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('http://localhost/api/team/social-image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

const validGenerate = {
  op: 'generate',
  prompt: 'nightstand still, warm daylight',
  handle: 'we-vibe-chorus',
  archetype: 'scene',
  mood: 'nightstand',
  date: '2026-08-18',
  imageSize: { width: 1080, height: 1350 },
  refImageUrl: 'https://cdn.shopify.com/files/real-packshot.jpg',
  // Required on every generation call since ticket #10501.
  sceneLocation: 'bedroom-loft',
}

const validCast = {
  op: 'cast',
  prompt: 'held in hand, editorial',
  handle: 'we-vibe-chorus',
  mood: 'daylight',
  date: '2026-08-18',
  presenterImageUrl: 'https://cdn/presenter.jpg',
  productImageUrl: 'https://cdn/product.jpg',
  scale: 'palm',
  // Required on every generation call since ticket #10501.
  sceneLocation: 'bedroom-loft',
}

const MAYA = {
  slug: 'maya', name: 'Maya',
  photoUrl: 'https://cdn/maya-portrait.jpg',
  bodyReferencePhotoUrl: 'https://cdn/maya-body.jpg',
  skinToneNote: 'deep brown skin with warm undertones',
  handReferencePhotoUrl: 'https://cdn/maya-hand.jpg',
}
const RUTH = {
  slug: 'ruth', name: 'Ruth',
  photoUrl: 'https://cdn/ruth-portrait.jpg',
  bodyReferencePhotoUrl: null,
  skinToneNote: null,
  handReferencePhotoUrl: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  logImageCostMock.mockResolvedValue(undefined)
  recordEventMock.mockResolvedValue(undefined)
  gateMock.mockResolvedValue({ ok: true })
  rosterMock.mockResolvedValue([MAYA, RUTH])
  productByHandleMock.mockResolvedValue(null)
  genMock.mockResolvedValue({
    url: 'https://cdn.shopify.com/files/social-we-vibe-chorus-scene-nightstand-20260818.jpg',
    filename: 'social-we-vibe-chorus-scene-nightstand-20260818.jpg',
    provider: 'fal',
    model: 'flux',
  })
  castMock.mockResolvedValue({
    urls: ['https://cdn.shopify.com/files/social-we-vibe-chorus-cast-daylight-20260818-1.jpg'],
    filenames: ['social-we-vibe-chorus-cast-daylight-20260818-1.jpg'],
    costs: [{ costKey: 'fal/flux-2-edit', count: 1 }],
    requestIds: ['req-1'],
  })
})

describe('generate', () => {
  it('passes validated fields through and returns the generation result', async () => {
    const res = await post(validGenerate)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ provider: 'fal' })
    expect(genMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'nightstand still, warm daylight',
      handle: 'we-vibe-chorus',
      archetype: 'scene',
      mood: 'nightstand',
      date: '2026-08-18',
      imageSize: { width: 1080, height: 1350 },
      refImageUrl: 'https://cdn.shopify.com/files/real-packshot.jpg',
    }))
    // The route owns the spend row now, not the CLI (#8032: a sandbox call
    // with no node_modules never reaches the CLI's own spend step, so this
    // route must log its own cost or a sandbox-originated run bills for free).
    expect(genMock.mock.calls[0]![0]).toHaveProperty('logCost', true)
  })

  it('rejects a missing prompt', async () => {
    const res = await post({ ...validGenerate, prompt: undefined })
    expect(res.status).toBe(400)
    expect(genMock).not.toHaveBeenCalled()
  })

  it('rejects an unknown archetype', async () => {
    const res = await post({ ...validGenerate, archetype: 'billboard' })
    expect(res.status).toBe(400)
    expect(genMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed date', async () => {
    const res = await post({ ...validGenerate, date: '08/18/2026' })
    expect(res.status).toBe(400)
    expect(genMock).not.toHaveBeenCalled()
  })

  it('returns 403 with the gate payload when the money gate says no', async () => {
    gateMock.mockResolvedValue({ ok: false, reason: 'over_budget' })
    const res = await post(validGenerate)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'gated', reason: 'over_budget' })
    expect(genMock).not.toHaveBeenCalled()
  })

  // Ticket #10501: a caller could hit this route directly and route around
  // scripts/gen-social-image.ts's own requirement, so the route must refuse
  // on its own — before the money gate, so a refusal never reaches spend.
  it('rejects a generation call with no sceneLocation, before the money gate runs', async () => {
    const res = await post({ ...validGenerate, sceneLocation: undefined })
    expect(res.status).toBe(400)
    expect(genMock).not.toHaveBeenCalled()
    expect(gateMock).not.toHaveBeenCalled()
  })

  it('rejects a macro/close crop missing bodyZone or contactMode', async () => {
    const macro = await post({ ...validGenerate, cropScale: 'macro' })
    expect(macro.status).toBe(400)
    const closeOnly = await post({ ...validGenerate, cropScale: 'close', bodyZone: 'hip-hollow' })
    expect(closeOnly.status).toBe(400)
    expect(genMock).not.toHaveBeenCalled()
  })

  it('accepts a macro crop that supplies bodyZone and contactMode', async () => {
    const res = await post({ ...validGenerate, cropScale: 'macro', bodyZone: 'hip-hollow', contactMode: 'resting' })
    expect(res.status).toBe(200)
  })

  it('accepts a medium/wide crop with only sceneLocation', async () => {
    const res = await post({ ...validGenerate, cropScale: 'wide' })
    expect(res.status).toBe(200)
  })
})

describe('generate spend', () => {
  it('does not log spend when the provider generated nothing (#8032)', async () => {
    genMock.mockResolvedValue({ url: null, filename: 'x.jpg', provider: 'none', model: 'none' })
    const res = await post(validGenerate)
    expect(res.status).toBe(200)
    // generateAndUploadSocialImage owns the "did it actually bill" decision
    // internally via logCost:true; the route itself never calls logImageCost
    // for the generate op, only for cast (see below).
    expect(logImageCostMock).not.toHaveBeenCalled()
  })
})

describe('cast', () => {
  it('passes references and scale through to generateCastComposite', async () => {
    const res = await post(validCast)
    expect(res.status).toBe(200)
    expect((await res.json() as { urls: string[] }).urls).toHaveLength(1)
    expect(castMock).toHaveBeenCalledWith(expect.objectContaining({
      presenterImageUrl: 'https://cdn/presenter.jpg',
      productImageUrl: 'https://cdn/product.jpg',
      scale: 'palm',
    }))
  })

  it('logs one spend row per surviving candidate (#8032)', async () => {
    const res = await post(validCast)
    expect(res.status).toBe(200)
    expect(logImageCostMock).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'social-images',
      model: 'fal/flux-2-edit',
      count: 1,
      caller: 'social-media-manager',
      refId: 'social-we-vibe-chorus-cast-daylight-20260818-1.jpg',
      requestId: 'req-1',
    }))
  })

  it('logs a remainder row for a billed candidate dropped by rehost/vision-gate', async () => {
    castMock.mockResolvedValue({
      urls: ['https://cdn.shopify.com/files/only-survivor.jpg'],
      filenames: ['only-survivor.jpg'],
      costs: [{ costKey: 'fal/flux-2-edit', count: 2 }],
      requestIds: ['req-1'],
    })
    await post(validCast)
    // One row for the surviving candidate, one remainder row for the billed
    // candidate that got dropped (framesBilled 2 - urls.length 1 = 1).
    expect(logImageCostMock).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'social-images', model: 'fal/flux-2-edit', count: 1, refId: 'only-survivor.jpg',
    }))
    expect(logImageCostMock).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'social-images', model: 'fal/flux-2-edit', count: 1,
    }))
    expect(logImageCostMock).not.toHaveBeenCalledWith(expect.objectContaining({ refId: expect.anything(), count: 2 }))
    expect(logImageCostMock).toHaveBeenCalledTimes(2)
  })

  it('logs the stage-1 plate cost when the composite built one', async () => {
    castMock.mockResolvedValue({
      urls: ['https://cdn.shopify.com/files/frame.jpg'],
      filenames: ['frame.jpg'],
      costs: [{ costKey: 'fal/flux-2-edit', count: 1 }, { costKey: 'qwen/plate', count: 1 }],
      requestIds: ['req-1'],
      plateRequestId: 'req-plate-1',
    })
    await post(validCast)
    expect(logImageCostMock).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'social-images', model: 'qwen/plate', count: 1, requestId: 'req-plate-1',
    }))
  })

  it('rejects a cast op without a presenter reference', async () => {
    const res = await post({ ...validCast, presenterImageUrl: undefined })
    expect(res.status).toBe(400)
    expect(castMock).not.toHaveBeenCalled()
  })
})

/**
 * Ticket #10336. Before this, the route took `presenterImageUrl` from the
 * caller and never asked which reference the crop needs, so a close crop was
 * anchored to a portrait and the model invented the body and skin tone under a
 * named persona's name. `skinToneNote` was fetched from Sanity and used
 * nowhere, and `castSlugs` never reached the composite.
 */
describe('cast: body reference + skin tone + castSlugs (#10336)', () => {
  const castBySlug = {
    op: 'cast',
    prompt: 'held at the collarbone, window light',
    handle: 'we-vibe-chorus',
    mood: 'daylight',
    date: '2026-08-18',
    productImageUrl: 'https://cdn/product.jpg',
    scale: 'palm',
    // Required on every generation call since ticket #10501.
    sceneLocation: 'bedroom-loft',
  }
  // A macro/close crop additionally requires bodyZone/contactMode (#10501).
  const ON_SKIN_AXES = { bodyZone: 'hip-hollow', contactMode: 'resting' }

  it('passes the body reference for a close crop', async () => {
    const res = await post({ ...castBySlug, ...ON_SKIN_AXES, castSlug: 'maya', cropScale: 'close' })
    expect(res.status).toBe(200)
    expect(castMock).toHaveBeenCalledWith(expect.objectContaining({
      presenterImageUrl: 'https://cdn/maya-body.jpg',
      castSlugs: ['maya'],
    }))
    expect(await res.json()).not.toHaveProperty('bodyReferenceMissing')
  })

  it('prepends the skin-tone note to the scene prompt', async () => {
    await post({ ...castBySlug, ...ON_SKIN_AXES, castSlug: 'maya', cropScale: 'close' })
    expect(castMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Skin tone: deep brown skin with warm undertones. held at the collarbone, window light',
    }))
  })

  it('keeps the portrait for a medium crop', async () => {
    await post({ ...castBySlug, castSlug: 'maya', cropScale: 'medium' })
    expect(castMock).toHaveBeenCalledWith(expect.objectContaining({
      presenterImageUrl: 'https://cdn/maya-portrait.jpg',
    }))
  })

  it('returns bodyReferenceMissing and a warning when a close crop has no body reference', async () => {
    const res = await post({ ...castBySlug, ...ON_SKIN_AXES, castSlug: 'ruth', cropScale: 'close' })
    expect(res.status).toBe(200)
    const body = await res.json() as { bodyReferenceMissing?: boolean; warning?: string }
    expect(body.bodyReferenceMissing).toBe(true)
    expect(body.warning).toContain('Ruth')
    // Still generated: a route refusal would kill the whole scheduled run.
    expect(castMock).toHaveBeenCalledWith(expect.objectContaining({
      presenterImageUrl: 'https://cdn/ruth-portrait.jpg',
    }))
  })

  // Ticket #10560: the response field alone reached zero code, so a missing
  // body reference is now also a run event (when a runId is given) and a
  // Sentry message, in addition to the field the response still carries.
  it('records a run event and a Sentry message when the body reference falls back, and threads the flag into generateCastComposite', async () => {
    const res = await post({ ...castBySlug, ...ON_SKIN_AXES, castSlug: 'ruth', cropScale: 'close', runId: 42 })
    expect(res.status).toBe(200)
    expect(recordEventMock).toHaveBeenCalledWith(expect.objectContaining({
      runId: 42,
      eventType: 'error',
      summary: expect.stringContaining('Ruth'),
    }))
    expect(captureMessageMock).toHaveBeenCalledWith(expect.stringContaining('Ruth'), 'warning')
    expect(castMock).toHaveBeenCalledWith(expect.objectContaining({ bodyReferenceMissing: true }))
  })

  it('skips the run-event write but still logs to Sentry when no runId is given', async () => {
    const res = await post({ ...castBySlug, ...ON_SKIN_AXES, castSlug: 'ruth', cropScale: 'close' })
    expect(res.status).toBe(200)
    expect(recordEventMock).not.toHaveBeenCalled()
    expect(captureMessageMock).toHaveBeenCalled()
  })

  it('still returns 200 with the result when both telemetry writes throw', async () => {
    recordEventMock.mockRejectedValue(new Error('neon down'))
    captureMessageMock.mockImplementation(() => { throw new Error('sentry down') })
    const res = await post({ ...castBySlug, ...ON_SKIN_AXES, castSlug: 'ruth', cropScale: 'close', runId: 42 })
    expect(res.status).toBe(200)
    const body = await res.json() as { bodyReferenceMissing?: boolean }
    expect(body.bodyReferenceMissing).toBe(true)
  })

  it('does not record an event or a Sentry message when no fallback happened', async () => {
    const res = await post({ ...castBySlug, ...ON_SKIN_AXES, castSlug: 'maya', cropScale: 'close', runId: 42 })
    expect(res.status).toBe(200)
    expect(recordEventMock).not.toHaveBeenCalled()
    expect(captureMessageMock).not.toHaveBeenCalled()
  })

  it('rejects an unknown crop scale', async () => {
    const res = await post({ ...castBySlug, castSlug: 'maya', cropScale: 'tight' })
    expect(res.status).toBe(400)
    expect(castMock).not.toHaveBeenCalled()
  })

  it('rejects a castSlug that is not on the approved roster', async () => {
    const res = await post({ ...castBySlug, ...ON_SKIN_AXES, castSlug: 'nobody', cropScale: 'close' })
    expect(res.status).toBe(400)
    expect(castMock).not.toHaveBeenCalled()
  })

  it('refuses to read an empty roster as "there are none"', async () => {
    rosterMock.mockResolvedValue([])
    const res = await post({ ...castBySlug, ...ON_SKIN_AXES, castSlug: 'maya', cropScale: 'close' })
    expect(res.status).toBe(400)
    expect(castMock).not.toHaveBeenCalled()
  })

  it('forwards an explicit castSlugs list when given', async () => {
    await post({ ...castBySlug, castSlug: 'maya', cropScale: 'medium', castSlugs: ['maya', 'ruth'] })
    expect(castMock).toHaveBeenCalledWith(expect.objectContaining({ castSlugs: ['maya', 'ruth'] }))
  })

  it('refuses a close crop missing bodyZone/contactMode, before ever resolving the reference', async () => {
    const res = await post({ ...castBySlug, castSlug: 'maya', cropScale: 'close' })
    expect(res.status).toBe(400)
    expect(castMock).not.toHaveBeenCalled()
  })
})

/**
 * Ticket #11476: the cast member's own handReferencePhoto rides alongside
 * (never instead of) the presenter reference, attached automatically for a
 * held contact mode via extraImageUrls, since a briefed grip cannot escape
 * the body plate's own static pose.
 */
describe('cast: hand reference for held contact modes (#11476)', () => {
  const castBySlug = {
    op: 'cast',
    prompt: 'held at the collarbone, window light',
    handle: 'we-vibe-chorus',
    mood: 'daylight',
    date: '2026-08-18',
    productImageUrl: 'https://cdn/product.jpg',
    scale: 'palm',
    sceneLocation: 'bedroom-loft',
  }

  it('attaches the hand reference via extraImageUrls for a held contact mode', async () => {
    const res = await post({ ...castBySlug, castSlug: 'maya', cropScale: 'medium', contactMode: 'self-held' })
    expect(res.status).toBe(200)
    expect(castMock).toHaveBeenCalledWith(expect.objectContaining({
      extraImageUrls: ['https://cdn/maya-hand.jpg'],
    }))
    expect(await res.json()).not.toHaveProperty('handReferenceMissing')
  })

  it('attaches nothing extra for a non-held contact mode', async () => {
    await post({ ...castBySlug, castSlug: 'maya', cropScale: 'medium', contactMode: 'resting' })
    expect(castMock).toHaveBeenCalledWith(expect.not.objectContaining({ extraImageUrls: expect.anything() }))
  })

  it('merges with, and dedupes against, a caller-supplied extraImageUrls', async () => {
    await post({
      ...castBySlug, castSlug: 'maya', cropScale: 'medium', contactMode: 'other-held',
      extraImageUrls: ['https://cdn/maya-hand.jpg', 'https://cdn/plate.jpg'],
    })
    expect(castMock).toHaveBeenCalledWith(expect.objectContaining({
      extraImageUrls: ['https://cdn/maya-hand.jpg', 'https://cdn/plate.jpg'],
    }))
  })

  it('returns handReferenceMissing and a warning for a held contact mode with no hand reference', async () => {
    const res = await post({ ...castBySlug, castSlug: 'ruth', cropScale: 'medium', contactMode: 'drawn' })
    expect(res.status).toBe(200)
    const body = await res.json() as { handReferenceMissing?: boolean; warning?: string }
    expect(body.handReferenceMissing).toBe(true)
    expect(body.warning).toContain('Ruth')
    // Still generated: a route refusal would kill the whole scheduled run.
    expect(castMock).toHaveBeenCalledWith(expect.not.objectContaining({ extraImageUrls: expect.anything() }))
  })
})

/**
 * Ticket #10341, tightened by #11474: featuredMedia is sometimes the retail
 * carton, so the route now reads the stored, once-resolved
 * `xdipx.bare_product_reference` metafield rather than walking the media
 * list live, and refuses (400) instead of falling back when it is null or
 * unresolved.
 */
describe('cast: bare-product reference (#10341, #11474)', () => {
  it('uses the resolved bare-product reference when productImageUrl is omitted', async () => {
    productByHandleMock.mockResolvedValue({
      images: [
        { url: 'https://cdn/96203-box-front.jpg', altText: 'Retail box' },
        { url: 'https://cdn/96203-product.jpg', altText: 'Chorus' },
      ],
      bareProductReference: {
        url: 'https://cdn/96203-product.jpg', index: 1, reason: 'confirmed bare frame',
        resolvedAt: '2026-09-25T00:00:00.000Z', method: 'heuristic',
      },
    })
    const res = await post({ ...validCast, productImageUrl: undefined })
    expect(res.status).toBe(200)
    expect(castMock).toHaveBeenCalledWith(expect.objectContaining({
      productImageUrl: 'https://cdn/96203-product.jpg',
    }))
  })

  it('refuses with a clear reason when the reference resolved to no bare frame', async () => {
    productByHandleMock.mockResolvedValue({
      images: [{ url: 'https://cdn/96203-box-front.jpg', altText: 'Retail box' }],
      bareProductReference: {
        url: null, index: null, reason: 'every non-AI-generated frame looks like packaging',
        resolvedAt: '2026-09-25T00:00:00.000Z', method: 'heuristic',
      },
    })
    const res = await post({ ...validCast, productImageUrl: undefined })
    expect(res.status).toBe(400)
    expect(castMock).not.toHaveBeenCalled()
    expect(await res.text()).toContain('every non-AI-generated frame looks like packaging')
  })

  it('refuses with a clear reason when the reference has never been resolved', async () => {
    productByHandleMock.mockResolvedValue({ images: [] })
    const res = await post({ ...validCast, productImageUrl: undefined })
    expect(res.status).toBe(400)
    expect(castMock).not.toHaveBeenCalled()
    expect(await res.text()).toContain('has not been resolved yet')
  })

  it('never falls back to media[0]: a caller must pass productImageUrl explicitly to override', async () => {
    productByHandleMock.mockResolvedValue({
      images: [{ url: 'https://cdn/96203-box-front.jpg', altText: 'Retail box' }],
    })
    const res = await post({ ...validCast, productImageUrl: 'https://cdn/explicit-override.jpg' })
    expect(res.status).toBe(200)
    expect(castMock).toHaveBeenCalledWith(expect.objectContaining({
      productImageUrl: 'https://cdn/explicit-override.jpg',
    }))
  })
})

/**
 * Ticket #10981. Root cause of the product-size-plausibility blocks (row 285,
 * a Womanizer Beauty rendered ~2x real size on a forearm): this route asked
 * for a free-text `scale` and never consulted the real dimensions already in
 * Shopify, so a composite with no hand in frame had no anchor at all.
 */
describe('cast: derived scale cue from real dimensions (#10981)', () => {
  it('derives a scale cue from specifications and prepends it to the prompt', async () => {
    productByHandleMock.mockResolvedValue({
      images: [{ url: 'https://cdn/product.jpg', altText: 'Chorus' }],
      specifications: ['Length: 3.5 inches'],
    })
    const res = await post({ ...validCast, bodyZone: 'forearm' })
    expect(res.status).toBe(200)
    expect(castMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('forearm'),
    }))
    // The caller's own free-text scale still rides through unchanged
    // (additive, not replaced) — `withProductScale` applies it downstream.
    expect(castMock).toHaveBeenCalledWith(expect.objectContaining({ scale: 'palm' }))
    const body = await res.json() as { derivedLengthInches?: number; derivedScaleCue?: string }
    expect(body.derivedLengthInches).toBe(3.5)
    expect(body.derivedScaleCue).toContain('3.5 inches')
  })

  it('derives a womanizer-beauty-lilac call with bodyZone forearm and returns a derived length', async () => {
    productByHandleMock.mockResolvedValue({
      images: [{ url: 'https://cdn/womanizer.jpg', altText: 'Womanizer Beauty' }],
      specifications: ['Length: 3.9 inches'],
    })
    const res = await post({ ...validCast, handle: 'womanizer-beauty-lilac', bodyZone: 'forearm' })
    const body = await res.json() as { derivedLengthInches?: number; derivedScaleCue?: string }
    expect(res.status).toBe(200)
    expect(body.derivedLengthInches).toBe(3.9)
    expect(body.derivedScaleCue).toBeTruthy()
  })

  it('falls back to the hand-relative cue when no bodyZone is given', async () => {
    productByHandleMock.mockResolvedValue({
      images: [{ url: 'https://cdn/product.jpg', altText: 'Chorus' }],
      specifications: ['Length: 4.7 inches'],
    })
    const res = await post(validCast)
    const body = await res.json() as { derivedScaleCue?: string }
    expect(body.derivedScaleCue).toContain('two thirds')
  })

  it('derives the cue even when the caller already supplied an explicit productImageUrl', async () => {
    productByHandleMock.mockResolvedValue({
      images: [{ url: 'https://cdn/other.jpg' }],
      specifications: ['Length: 2 inches'],
    })
    const res = await post(validCast)
    // The caller's explicit productImageUrl is untouched by the product fetch.
    expect(castMock).toHaveBeenCalledWith(expect.objectContaining({ productImageUrl: 'https://cdn/product.jpg' }))
    const body = await res.json() as { derivedLengthInches?: number }
    expect(body.derivedLengthInches).toBe(2)
  })

  it('omits the derived fields when the product has no specifications', async () => {
    productByHandleMock.mockResolvedValue({ images: [{ url: 'https://cdn/product.jpg' }] })
    const res = await post(validCast)
    const body = await res.json() as { derivedLengthInches?: number; derivedScaleCue?: string }
    expect(body.derivedLengthInches).toBeUndefined()
    expect(body.derivedScaleCue).toBeUndefined()
    expect(castMock).toHaveBeenCalledWith(expect.objectContaining({ prompt: validCast.prompt }))
  })

  it('omits the derived fields when the product lookup returns null (no handle match)', async () => {
    productByHandleMock.mockResolvedValue(null)
    const res = await post(validCast)
    const body = await res.json() as { derivedLengthInches?: number }
    expect(body.derivedLengthInches).toBeUndefined()
  })
})

describe('method + op guards', () => {
  it('rejects a non-POST method', async () => {
    const request = new Request('http://localhost/api/team/social-image', { method: 'GET' })
    const res = await action({ request, params: {}, context: {} } as never) as Response
    expect(res.status).toBe(405)
  })

  it('rejects an unknown op', async () => {
    const res = await post({ ...validGenerate, op: 'delete' })
    expect(res.status).toBe(400)
    expect(genMock).not.toHaveBeenCalled()
    expect(castMock).not.toHaveBeenCalled()
  })
})
