// Unit tests for kontextResolutionMode() — the FLUX Kontext (ref-image) endpoint
// has no image_size param, so a caller's imageSize must resolve to a string
// aspect. A {width,height} object used to fall through to a hardcoded '16:9',
// silently generating the wrong aspect (ticket #152). These lock in the mapping.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { kontextResolutionMode, falGenerate } from './fal.server'

describe('kontextResolutionMode', () => {
  it('maps the string image_size enums to their aspect', () => {
    expect(kontextResolutionMode('square_hd')).toBe('1:1')
    expect(kontextResolutionMode('square')).toBe('1:1')
    expect(kontextResolutionMode('portrait_4_3')).toBe('3:4')
    expect(kontextResolutionMode('portrait_16_9')).toBe('9:16')
    expect(kontextResolutionMode('landscape_4_3')).toBe('4:3')
    expect(kontextResolutionMode('landscape_16_9')).toBe('16:9')
  })

  it('maps a {width,height} object to the nearest aspect instead of defaulting to 16:9', () => {
    // The exact bug from #152: a 4:3 brief (1200x900) came back 16:9.
    expect(kontextResolutionMode({ width: 1200, height: 900 })).toBe('4:3')
    expect(kontextResolutionMode({ width: 1024, height: 1024 })).toBe('1:1')
    expect(kontextResolutionMode({ width: 1200, height: 1500 })).toBe('3:4')
    expect(kontextResolutionMode({ width: 1920, height: 1080 })).toBe('16:9')
    expect(kontextResolutionMode({ width: 1080, height: 1920 })).toBe('9:16')
  })

  it('snaps a near-but-not-exact ratio to the closest supported aspect', () => {
    // 1392x752 (~1.85) is the frame #152 flagged: nearest supported is 16:9.
    expect(kontextResolutionMode({ width: 1392, height: 752 })).toBe('16:9')
    // 4:5 (0.8) has no exact match; nearest is 3:4 (0.75), not 9:16 (0.5625).
    expect(kontextResolutionMode({ width: 800, height: 1000 })).toBe('3:4')
  })

  it('throws on an unmapped string rather than silently defaulting', () => {
    expect(() => kontextResolutionMode('cinematic_21_9')).toThrow(/unmapped image_size/)
  })

  it('throws on a degenerate object', () => {
    expect(() => kontextResolutionMode({ width: 0, height: 900 })).toThrow(/invalid image_size/)
    expect(() => kontextResolutionMode({ width: 1200, height: -1 })).toThrow(/invalid image_size/)
  })
})

describe('falGenerate reference-image routing', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  // Capture the request the generator POSTs to fal, without hitting the network.
  // First fetch = the generation call (we assert its URL + body); any follow-up
  // fetch = the image download, which we stub to a tiny buffer.
  function stubFal() {
    vi.stubEnv('FAL_KEY', 'test-key')
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        calls.push({ url: String(url), body: JSON.parse(String(init.body)) })
        return new Response(JSON.stringify({ images: [{ url: 'https://fal.test/out' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      // image download
      return new Response(new ArrayBuffer(4), { status: 200 })
    }))
    return calls
  }

  it('routes two-or-more refs to nano-banana/edit with an image_urls array', async () => {
    const calls = stubFal()
    const result = await falGenerate({
      prompt: 'a vibrator and its lube bottle in one drawer scene',
      refImageUrls: ['https://img.test/toy.jpg', 'https://img.test/lube.jpg'],
      imageSize: 'portrait_16_9',
    })
    expect(calls[0]?.url).toContain('fal-ai/nano-banana/edit')
    expect(calls[0]?.body).toMatchObject({
      image_urls: ['https://img.test/toy.jpg', 'https://img.test/lube.jpg'],
      aspect_ratio: '9:16',
      output_format: 'jpeg',
    })
    // Multi-ref must not fall through to the Kontext single-ref shape.
    expect(calls[0]?.body).not.toHaveProperty('image_url')
    // Cost logs against nano-banana, not the flux-dev default.
    expect(result.costKey).toBe('fal/nano-banana')
  })

  it('keeps a single refImageUrl on the unchanged Kontext single-ref path', async () => {
    const calls = stubFal()
    const result = await falGenerate({
      prompt: 'the product in a scene',
      refImageUrl: 'https://img.test/p.jpg',
    })
    expect(calls[0]?.url).toContain('flux-kontext/dev')
    expect(calls[0]?.body).toMatchObject({ image_url: 'https://img.test/p.jpg' })
    expect(calls[0]?.body).not.toHaveProperty('image_urls')
    expect(result.costKey).toBe('fal/flux-kontext-dev')
  })

  it('treats a single-element refImageUrls like the single-ref Kontext path', async () => {
    const calls = stubFal()
    await falGenerate({
      prompt: 'the product in a scene',
      refImageUrls: ['https://img.test/only.jpg'],
    })
    expect(calls[0]?.url).toContain('flux-kontext/dev')
    expect(calls[0]?.body).toMatchObject({ image_url: 'https://img.test/only.jpg' })
    expect(calls[0]?.body).not.toHaveProperty('image_urls')
  })

  it('routes no refs to the text-to-image endpoint unchanged', async () => {
    const calls = stubFal()
    await falGenerate({ prompt: 'a lamp on a table' })
    expect(calls[0]?.body).toMatchObject({ image_size: 'landscape_16_9' })
    expect(calls[0]?.body).not.toHaveProperty('image_url')
    expect(calls[0]?.body).not.toHaveProperty('image_urls')
  })
})
