// Unit tests for the two-stage scene-frame composition (bake-off 2026-08-10).
//
// The one-shot composite put the retail CARTON in the presenter's hand with the
// manufacturer's brand name legible on it, because Shopify packshots include the
// box. Stage 1 now renders a packaging-free product plate and stage 2 composites
// against that. These lock in the staging, the model routing, and the cost
// reporting that the per-video ceiling depends on.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Atlas Cloud is mocked so the provider routing is deterministic regardless of
// whether ATLAS_CLOUD_API_KEY is present in the test env (#3570). Default
// atlasConfigured=false exercises the fal two-stage path the tests below assert;
// the Atlas describe flips it on and stubs atlasGenerate.
const atlasConfigured = vi.fn(() => false)
const atlasGenerate = vi.fn()
vi.mock('~/lib/atlas.server', () => ({
  atlasConfigured: () => atlasConfigured(),
  atlasGenerate: (...args: unknown[]) => atlasGenerate(...args),
}))

const PRESENTER = 'https://cdn.sanity.io/presenter.jpg'
const PRODUCT = 'https://cdn.shopify.com/packshot.jpg'
const PLATE = 'https://fal.media/plate.jpg'

type Call = { url: string; body: Record<string, unknown> }

/**
 * Records every fal call and replies with `count` fake image urls.
 *
 * Only fal.run traffic is recorded. Block telemetry writes through the Neon
 * driver, which is itself fetch-based, so an unfiltered recorder counts a
 * swallowed DB insert as a generation call.
 */
function mockFal(
  calls: Call[],
  opts: { failPlate?: boolean; failFrameCalls?: number } = {},
) {
  let frameCall = 0
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (!String(url).startsWith('https://fal.run/')) {
      return new Response('', { status: 500 })
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    calls.push({ url: String(url), body })

    const isPlate = String(url).includes('qwen-image-edit')
    if (isPlate && opts.failPlate) {
      return new Response('blocked', { status: 422 })
    }
    // Fail the first N stage-2 candidate calls, to exercise partial-failure
    // tolerance (ticket #3045).
    if (!isPlate && opts.failFrameCalls && frameCall < opts.failFrameCalls) {
      frameCall++
      return new Response('frame blocked', { status: 422 })
    }
    // Each candidate is its own single-image stage-2 call now (ticket #3045), so
    // give every frame call a distinct url the way fal would return distinct
    // composites.
    const n = isPlate ? 1 : Number(body['num_images'] ?? 1)
    const images = isPlate
      ? [{ url: PLATE }]
      : Array.from({ length: n }, () => ({ url: `https://fal.media/frame-${frameCall++}.jpg` }))
    // fal returns the request id in the x-fal-request-id response header on the
    // sync endpoint (ticket #3046). Give each candidate a distinct, url-derived
    // id so a test can assert the id threads through aligned to its frame.
    const reqId = isPlate
      ? 'rid-plate'
      : `rid-${(images[0]!.url).split('/').pop()!.replace('.jpg', '')}`
    return new Response(JSON.stringify({ images }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'x-fal-request-id': reqId },
    })
  })
}

describe('composeSceneFrame (fal two-stage — Atlas fallback path)', () => {
  const realFetch = globalThis.fetch

  beforeEach(() => {
    process.env['FAL_KEY'] = 'test-key'
    // Atlas unconfigured → the fal two-stage path runs. These tests assert that
    // path; the Atlas describe below covers the primary route.
    atlasConfigured.mockReturnValue(false)
    atlasGenerate.mockReset()
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    vi.resetModules()
  })

  it('builds a product plate first, then composites the presenter against the plate', async () => {
    const calls: Call[] = []
    globalThis.fetch = mockFal(calls) as unknown as typeof fetch
    const { composeSceneFrame } = await import('./fal-video.server')

    const res = await composeSceneFrame({
      prompt: 'sunlit bedroom corner',
      presenterImageUrl: PRESENTER,
      productImageUrl: PRODUCT,
      count: 3,
    })

    // One plate call, then one single-image stage-2 call per candidate.
    expect(calls).toHaveLength(4)

    // Stage 1: the raw packshot goes to the plate model, alone.
    const plate = calls.filter(c => c.url.includes('qwen-image-edit-2511'))
    expect(plate).toHaveLength(1)
    expect(plate[0]!.body['image_urls']).toEqual([PRODUCT])
    expect(plate[0]!.body['num_images']).toBe(1)

    // Stage 2: three separate single-image composites, each against the PLATE,
    // never the packshot (ticket #3045).
    const frames = calls.filter(c => c.url.includes('flux-2/lora/edit'))
    expect(frames).toHaveLength(3)
    for (const f of frames) {
      expect(f.body['image_urls']).toEqual([PRESENTER, PLATE])
      expect(f.body['image_urls']).not.toContain(PRODUCT)
      expect(f.body['num_images']).toBe(1)
    }

    // Distinct candidates come back, one per request.
    expect(res.urls).toHaveLength(3)
    expect(new Set(res.urls).size).toBe(3)
    expect(res.costKey).toBe('fal/flux-2-edit')
    expect(res.plate).toEqual({ costKey: 'fal/qwen-image-edit', count: 1 })
  })

  it('generates each candidate as its own single-image call, not one num_images:N batch (ticket #3045)', async () => {
    const calls: Call[] = []
    globalThis.fetch = mockFal(calls) as unknown as typeof fetch
    const { composeSceneFrame } = await import('./fal-video.server')

    const res = await composeSceneFrame({
      prompt: 'sunlit bedroom corner',
      presenterImageUrl: PRESENTER,
      productImageUrl: PRODUCT,
      count: 4,
    })

    // A batched num_images:N call re-interprets the shared plate independently
    // per image and the candidates drifted apart; one request per candidate
    // re-anchors each. Four candidates => four stage-2 calls, each num_images 1.
    const frames = calls.filter(c => c.url.includes('flux-2/lora/edit'))
    expect(frames).toHaveLength(4)
    expect(frames.every(f => f.body['num_images'] === 1)).toBe(true)
    expect(res.urls).toHaveLength(4)
  })

  it('returns the successful candidates when some stage-2 calls fail, and throws only when all fail (ticket #3045)', async () => {
    // Two of three candidates fail: a partial set is still useful for review.
    const partialCalls: Call[] = []
    globalThis.fetch = mockFal(partialCalls, { failFrameCalls: 2 }) as unknown as typeof fetch
    const mod = await import('./fal-video.server')

    const res = await mod.composeSceneFrame({
      prompt: 'p',
      presenterImageUrl: PRESENTER,
      productImageUrl: PRODUCT,
      count: 3,
    })
    expect(res.urls).toHaveLength(1)

    // Every candidate fails: surface the error rather than a heroless run.
    vi.resetModules()
    const allFailCalls: Call[] = []
    globalThis.fetch = mockFal(allFailCalls, { failFrameCalls: 3 }) as unknown as typeof fetch
    const mod2 = await import('./fal-video.server')
    await expect(
      mod2.composeSceneFrame({
        prompt: 'p',
        presenterImageUrl: PRESENTER,
        productImageUrl: PRODUCT,
        count: 3,
      }),
    ).rejects.toThrow(/flux-2\/lora\/edit error: 422/)
  })

  it('threads the fal request id per candidate and for the plate (ticket #3046)', async () => {
    const calls: Call[] = []
    globalThis.fetch = mockFal(calls) as unknown as typeof fetch
    const { composeSceneFrame } = await import('./fal-video.server')

    const res = await composeSceneFrame({
      prompt: 'sunlit bedroom corner',
      presenterImageUrl: PRESENTER,
      productImageUrl: PRODUCT,
      count: 3,
    })

    // One request id per candidate, index-aligned with urls, each distinct.
    expect(res.requestIds).toHaveLength(res.urls.length)
    expect(res.requestIds.every(id => typeof id === 'string')).toBe(true)
    expect(new Set(res.requestIds).size).toBe(3)
    // Each candidate's id is the one fal returned for that frame's own call.
    res.urls.forEach((url, i) => {
      const frameKey = url.split('/').pop()!.replace('.jpg', '')
      expect(res.requestIds[i]).toBe(`rid-${frameKey}`)
    })
    // The stage-1 plate call's id is captured too.
    expect(res.plateRequestId).toBe('rid-plate')
  })

  it('leaves candidate request ids undefined when fal omits the header', async () => {
    // A Response without x-fal-request-id must not throw; the id is best-effort.
    globalThis.fetch = vi.fn(async (url: string) => {
      if (!String(url).startsWith('https://fal.run/')) return new Response('', { status: 500 })
      const isPlate = String(url).includes('qwen-image-edit')
      const images = isPlate ? [{ url: PLATE }] : [{ url: 'https://fal.media/frame-x.jpg' }]
      return new Response(JSON.stringify({ images }), { status: 200 })
    }) as unknown as typeof fetch
    const { composeSceneFrame } = await import('./fal-video.server')

    const res = await composeSceneFrame({
      prompt: 'p',
      presenterImageUrl: PRESENTER,
      productImageUrl: PRODUCT,
      count: 1,
    })
    expect(res.urls).toHaveLength(1)
    expect(res.requestIds).toEqual([undefined])
    expect(res.plateRequestId).toBeUndefined()
  })

  it('appends a real-world scale cue to the composite prompt when a product is present (ticket #2761)', async () => {
    const calls: Call[] = []
    globalThis.fetch = mockFal(calls) as unknown as typeof fetch
    const { composeSceneFrame } = await import('./fal-video.server')

    await composeSceneFrame({
      prompt: 'sunlit bedroom corner',
      presenterImageUrl: PRESENTER,
      productImageUrl: PRODUCT,
    })

    // Stage 2 is the composite call; its prompt keeps the caller's scaffold and
    // adds the scale cue so the product no longer renders oversized in-hand.
    const stage2 = calls.find(c => c.url.includes('flux-2/lora/edit'))!
    const prompt = String(stage2.body['prompt'])
    expect(prompt).toContain('sunlit bedroom corner')
    expect(prompt).toContain('true real-world size')
    expect(prompt).toContain('not oversized')
  })

  it('does not add the scale cue to a talking-head frame that carries no product', async () => {
    const calls: Call[] = []
    globalThis.fetch = mockFal(calls) as unknown as typeof fetch
    const { composeSceneFrame } = await import('./fal-video.server')

    await composeSceneFrame({ prompt: 'sunlit bedroom corner', presenterImageUrl: PRESENTER })

    expect(String(calls[0]!.body['prompt'])).toBe('sunlit bedroom corner')
  })

  it('never routes the scene frame through the Google-filtered nano-banana endpoint', async () => {
    const calls: Call[] = []
    globalThis.fetch = mockFal(calls) as unknown as typeof fetch
    const { composeSceneFrame } = await import('./fal-video.server')

    await composeSceneFrame({ prompt: 'p', presenterImageUrl: PRESENTER, productImageUrl: PRODUCT })

    // nano-banana returned 422 content_policy for ordinary catalog products at
    // every safety_tolerance, so it must not reappear on this path.
    expect(calls.some(c => c.url.includes('nano-banana'))).toBe(false)
  })

  it('skips the plate stage for talking-head frames, which carry no product', async () => {
    const calls: Call[] = []
    globalThis.fetch = mockFal(calls) as unknown as typeof fetch
    const { composeSceneFrame } = await import('./fal-video.server')

    const res = await composeSceneFrame({ prompt: 'p', presenterImageUrl: PRESENTER, count: 1 })

    // No plate call; the single stage-2 candidate composites the presenter alone.
    expect(calls).toHaveLength(1)
    expect(calls.some(c => c.url.includes('qwen-image-edit'))).toBe(false)
    expect(calls[0]!.url).toContain('flux-2/lora/edit')
    expect(calls[0]!.body['image_urls']).toEqual([PRESENTER])
    expect(res.plate).toBeUndefined()
  })

  it('skips the plate when the product photo is also the base image (no presenter)', async () => {
    const calls: Call[] = []
    globalThis.fetch = mockFal(calls) as unknown as typeof fetch
    const { composeSceneFrame } = await import('./fal-video.server')

    const res = await composeSceneFrame({
      prompt: 'p',
      presenterImageUrl: PRODUCT,
      productImageUrl: PRODUCT,
      count: 1,
    })

    expect(calls).toHaveLength(1)
    expect(calls.some(c => c.url.includes('qwen-image-edit'))).toBe(false)
    expect(res.plate).toBeUndefined()
  })

  it('fails loudly when the plate stage is rejected instead of falling back to the packshot', async () => {
    const calls: Call[] = []
    globalThis.fetch = mockFal(calls, { failPlate: true }) as unknown as typeof fetch
    const { composeSceneFrame } = await import('./fal-video.server')

    await expect(
      composeSceneFrame({ prompt: 'p', presenterImageUrl: PRESENTER, productImageUrl: PRODUCT }),
    ).rejects.toThrow(/qwen-image-edit-2511 error: 422/)

    // Silently compositing the packshot is what shipped boxes; no stage 2 ran.
    expect(calls).toHaveLength(1)
  })
})

describe('composeSceneFrame (Atlas one-stage, #3570)', () => {
  const realFetch = globalThis.fetch

  beforeEach(() => {
    process.env['FAL_KEY'] = 'test-key'
    atlasConfigured.mockReturnValue(true)
    atlasGenerate.mockReset().mockResolvedValue({
      buffers: [],
      urls: ['https://cdn.atlas/a.jpg', 'https://cdn.atlas/b.jpg', 'https://cdn.atlas/c.jpg'],
      requestIds: ['pred-a', 'pred-b', 'pred-c'],
      costKey: 'atlas/seedream-4.5-edit',
      requestId: 'pred-a',
    })
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    vi.resetModules()
  })

  it('composites presenter + product in ONE Atlas call (no plate) and returns the Atlas cost key', async () => {
    // Fail loudly if the fal path is touched: the whole point is one stage.
    globalThis.fetch = vi.fn(async () => {
      throw new Error('fal must not be called when Atlas is configured')
    }) as unknown as typeof fetch
    const { composeSceneFrame } = await import('./fal-video.server')

    const res = await composeSceneFrame({
      prompt: 'sunlit bedroom corner',
      presenterImageUrl: PRESENTER,
      productImageUrl: PRODUCT,
      count: 3,
    })

    expect(atlasGenerate).toHaveBeenCalledTimes(1)
    const arg = atlasGenerate.mock.calls[0]![0] as {
      refImageUrls: string[]
      prompt: string
      count: number
      download: boolean
      imageSize: { width: number; height: number }
    }
    // Presenter + product in a single reference array — no separate plate call.
    expect(arg.refImageUrls).toEqual([PRESENTER, PRODUCT])
    expect(arg.count).toBe(3)
    expect(arg.download).toBe(false)
    expect(arg.imageSize).toEqual({ width: 1080, height: 1920 }) // default 9:16
    // The no-carton rule moved into the prompt (there is no plate to strip it).
    expect(arg.prompt).toContain('sunlit bedroom corner')
    expect(arg.prompt).toContain('bare product itself exactly')
    expect(arg.prompt).toContain('true real-world size') // scale cue kept

    expect(res.urls).toEqual(['https://cdn.atlas/a.jpg', 'https://cdn.atlas/b.jpg', 'https://cdn.atlas/c.jpg'])
    expect(res.requestIds).toEqual(['pred-a', 'pred-b', 'pred-c'])
    expect(res.costKey).toBe('atlas/seedream-4.5-edit')
    expect(res.plate).toBeUndefined() // one stage, no plate spend
  })

  it('passes the 4:5 pixel dims through to Atlas', async () => {
    globalThis.fetch = realFetch
    const { composeSceneFrame } = await import('./fal-video.server')
    await composeSceneFrame({
      prompt: 'p',
      presenterImageUrl: PRESENTER,
      productImageUrl: PRODUCT,
      aspectRatio: '4:5',
    })
    const arg = atlasGenerate.mock.calls[0]![0] as { imageSize: { width: number; height: number } }
    expect(arg.imageSize).toEqual({ width: 1080, height: 1350 })
  })

  it('does not add the scale cue or carton clause to a talking-head frame (no product)', async () => {
    const { composeSceneFrame } = await import('./fal-video.server')
    await composeSceneFrame({ prompt: 'sunlit bedroom corner', presenterImageUrl: PRESENTER })
    const arg = atlasGenerate.mock.calls[0]![0] as { prompt: string; refImageUrls: string[] }
    expect(arg.prompt).toBe('sunlit bedroom corner')
    expect(arg.refImageUrls).toEqual([PRESENTER])
  })

  it('falls back to the fal two-stage path when the Atlas call throws', async () => {
    atlasGenerate.mockReset().mockRejectedValue(new Error('atlas boom'))
    const calls: Call[] = []
    globalThis.fetch = mockFal(calls) as unknown as typeof fetch
    const { composeSceneFrame } = await import('./fal-video.server')

    const res = await composeSceneFrame({
      prompt: 'p',
      presenterImageUrl: PRESENTER,
      productImageUrl: PRODUCT,
      count: 2,
    })

    // Atlas was tried, then the fal two-stage path produced the frames.
    expect(atlasGenerate).toHaveBeenCalledTimes(1)
    expect(calls.some(c => c.url.includes('qwen-image-edit'))).toBe(true) // plate ran
    expect(res.costKey).toBe('fal/flux-2-edit')
    expect(res.plate).toEqual({ costKey: 'fal/qwen-image-edit', count: 1 })
  })

  it('uses fal directly, never Atlas, when Atlas is unconfigured', async () => {
    atlasConfigured.mockReturnValue(false)
    const calls: Call[] = []
    globalThis.fetch = mockFal(calls) as unknown as typeof fetch
    const { composeSceneFrame } = await import('./fal-video.server')

    await composeSceneFrame({ prompt: 'p', presenterImageUrl: PRESENTER, productImageUrl: PRODUCT, count: 1 })
    expect(atlasGenerate).not.toHaveBeenCalled()
    expect(calls.some(c => c.url.includes('flux-2/lora/edit'))).toBe(true)
  })
})

describe('scene-frame cost keys', () => {
  it('prices both stages so the per-video ceiling does not under-report', async () => {
    const { estimateImageCostUsd } = await import('./model-pricing.server')
    const { SCENE_FRAME_COST_KEY, SCENE_PLATE_COST_KEY } = await import('./fal-video.server')

    // Both keys must be known, or DEFAULT_IMAGE_RATE silently stands in.
    expect(estimateImageCostUsd(SCENE_PLATE_COST_KEY, 1)).toBe(0.035)
    expect(estimateImageCostUsd(SCENE_FRAME_COST_KEY, 1)).toBe(0.07)
    expect(estimateImageCostUsd(SCENE_FRAME_COST_KEY, 3)).toBeCloseTo(0.21, 5)
  })

  it('prices the Atlas one-stage cost key so its spend does not under-report (#3570)', async () => {
    const { estimateImageCostUsd } = await import('./model-pricing.server')
    // The Atlas path returns this key; it must be known to model-pricing.
    expect(estimateImageCostUsd('atlas/seedream-4.5-edit', 1)).toBe(0.036)
    expect(estimateImageCostUsd('atlas/seedream-4.5-edit', 3)).toBeCloseTo(0.108, 5)
  })
})
