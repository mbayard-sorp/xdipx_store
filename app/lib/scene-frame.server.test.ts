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
function mockFal(calls: Call[], opts: { failPlate?: boolean } = {}) {
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
    const n = isPlate ? 1 : Number(body['num_images'] ?? 1)
    const images = isPlate
      ? [{ url: PLATE }]
      : Array.from({ length: n }, (_, i) => ({ url: `https://fal.media/frame-${i}.jpg` }))
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

    expect(calls).toHaveLength(2)

    // Stage 1: the raw packshot goes to the plate model, alone.
    expect(calls[0]!.url).toContain('qwen-image-edit-2511')
    expect(calls[0]!.body['image_urls']).toEqual([PRODUCT])
    expect(calls[0]!.body['num_images']).toBe(1)

    // Stage 2: the presenter composites against the PLATE, never the packshot.
    expect(calls[1]!.url).toContain('flux-2/lora/edit')
    expect(calls[1]!.body['image_urls']).toEqual([PRESENTER, PLATE])
    expect(calls[1]!.body['image_urls']).not.toContain(PRODUCT)
    expect(calls[1]!.body['num_images']).toBe(3)

    expect(res.urls).toHaveLength(3)
    expect(res.costKey).toBe('fal/flux-2-edit')
    expect(res.plate).toEqual({ costKey: 'fal/qwen-image-edit', count: 1 })
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

    const res = await composeSceneFrame({ prompt: 'p', presenterImageUrl: PRESENTER })

    expect(calls).toHaveLength(1)
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
    })

    expect(calls).toHaveLength(1)
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
