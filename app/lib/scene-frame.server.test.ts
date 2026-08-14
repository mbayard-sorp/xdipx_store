// Unit tests for the two-stage scene-frame composition (bake-off 2026-08-10).
//
// The one-shot composite put the retail CARTON in the presenter's hand with the
// manufacturer's brand name legible on it, because Shopify packshots include the
// box. Stage 1 now renders a packaging-free product plate and stage 2 composites
// against that. These lock in the staging, the model routing, and the cost
// reporting that the per-video ceiling depends on.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
    return new Response(JSON.stringify({ images }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

describe('composeSceneFrame (two-stage)', () => {
  const realFetch = globalThis.fetch

  beforeEach(() => {
    process.env['FAL_KEY'] = 'test-key'
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

describe('scene-frame cost keys', () => {
  it('prices both stages so the per-video ceiling does not under-report', async () => {
    const { estimateImageCostUsd } = await import('./model-pricing.server')
    const { SCENE_FRAME_COST_KEY, SCENE_PLATE_COST_KEY } = await import('./fal-video.server')

    // Both keys must be known, or DEFAULT_IMAGE_RATE silently stands in.
    expect(estimateImageCostUsd(SCENE_PLATE_COST_KEY, 1)).toBe(0.035)
    expect(estimateImageCostUsd(SCENE_FRAME_COST_KEY, 1)).toBe(0.07)
    expect(estimateImageCostUsd(SCENE_FRAME_COST_KEY, 3)).toBeCloseTo(0.21, 5)
  })
})
