// Unit tests for the provider-neutral image entry point.
//
// The admin and Sanity Studio image paths used to call Imagen directly, so an
// operator typing a prompt got Google's filter with no fal attempt at all. These
// lock in the routing those callers now depend on: Atlas Cloud first (owner
// direction 2026-08-15), fal as fallback, Imagen last; a real prompt even when
// the caller supplies only categories; and reference bytes reaching the
// image-conditioned endpoints rather than being dropped on the floor.
//
// The multi-reference cases (ticket #2222) also live here: two or more URLs
// must reach the primary provider as refImageUrls and log spend through the
// standard logImageCost path, while single-ref callers keep their shape.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const atlasGenerate = vi.fn()
const atlasConfigured = vi.fn(() => true)
const falGenerate = vi.fn()
const generateMoodImage = vi.fn()

vi.mock('~/lib/atlas.server', () => ({
  atlasConfigured: () => atlasConfigured(),
  atlasGenerate: (...args: unknown[]) => atlasGenerate(...args),
}))

vi.mock('~/lib/fal.server', () => ({
  falConfigured: () => true,
  falGenerate: (...args: unknown[]) => falGenerate(...args),
}))

vi.mock('~/lib/imagen.server', () => ({
  generateMoodImage: (...args: unknown[]) => generateMoodImage(...args),
  defaultMoodPrompt: (cats: string[]) => `MOOD_BRIEF(${cats.join(',')})`,
}))

const logGenerationBlock = vi.fn()
const logImageCost = vi.fn()
vi.mock('~/lib/token-log.server', () => ({
  logImageCost: (...args: unknown[]) => logImageCost(...args),
  logGenerationBlock: (...args: unknown[]) => logGenerationBlock(...args),
}))

const ATLAS_OK = { buffers: [Buffer.from('img')], costKey: 'atlas/seedream-4.5' }
const FAL_OK = { buffers: [Buffer.from('img')], costKey: 'fal/flux-dev' }

describe('generateImage', () => {
  beforeEach(() => {
    atlasGenerate.mockReset().mockResolvedValue(ATLAS_OK)
    atlasConfigured.mockReset().mockReturnValue(true)
    falGenerate.mockReset().mockResolvedValue(FAL_OK)
    generateMoodImage.mockReset().mockResolvedValue([Buffer.from('imagen')])
    logGenerationBlock.mockReset()
    logImageCost.mockReset()
  })
  afterEach(() => vi.resetModules())

  it('sends a category-derived prompt to Atlas instead of skipping straight to a fallback', async () => {
    const { generateImage } = await import('./generate-image.server')
    const res = await generateImage({ categories: ['Wands'] })

    expect(atlasGenerate).toHaveBeenCalledTimes(1)
    expect(atlasGenerate.mock.calls[0]![0]).toMatchObject({ prompt: 'MOOD_BRIEF(Wands)' })
    expect(falGenerate).not.toHaveBeenCalled()
    expect(generateMoodImage).not.toHaveBeenCalled()
    expect(res.provider).toBe('atlas')
  })

  it('inlines an improvement-mode original as a data URI so the edit endpoint can use it', async () => {
    const { generateImage } = await import('./generate-image.server')
    await generateImage({ prompt: 'brighter room', originalImageBuffer: Buffer.from('orig') })

    const arg = atlasGenerate.mock.calls[0]![0] as { refImageUrl?: string }
    expect(arg.refImageUrl).toBe(`data:image/jpeg;base64,${Buffer.from('orig').toString('base64')}`)
  })

  it('inlines the first product reference buffer when no explicit URL is given', async () => {
    const { generateImage } = await import('./generate-image.server')
    await generateImage({ prompt: 'p', referenceImageBuffers: [Buffer.from('ref1'), Buffer.from('ref2')] })

    const arg = atlasGenerate.mock.calls[0]![0] as { refImageUrl?: string }
    expect(arg.refImageUrl).toBe(`data:image/jpeg;base64,${Buffer.from('ref1').toString('base64')}`)
  })

  it('prefers an explicit refImageUrl over inlined buffers', async () => {
    const { generateImage } = await import('./generate-image.server')
    await generateImage({
      prompt: 'p',
      refImageUrl: 'https://cdn.shopify.com/real.jpg',
      originalImageBuffer: Buffer.from('orig'),
    })

    const arg = atlasGenerate.mock.calls[0]![0] as { refImageUrl?: string }
    expect(arg.refImageUrl).toBe('https://cdn.shopify.com/real.jpg')
  })

  it('resolves an aspect ratio to a provider image_size', async () => {
    const { generateImage } = await import('./generate-image.server')
    await generateImage({ prompt: 'p', aspectRatio: '9:16' })

    expect(atlasGenerate.mock.calls[0]![0]).toMatchObject({ imageSize: 'portrait_16_9' })
  })

  it('falls back to fal when Atlas fails, preserving the reference args', async () => {
    atlasGenerate.mockRejectedValue(new Error('atlas down'))
    const { generateImage } = await import('./generate-image.server')
    const res = await generateImage({ prompt: 'p', refImageUrl: 'https://cdn.shopify.com/real.jpg' })

    expect(falGenerate).toHaveBeenCalledTimes(1)
    expect(falGenerate.mock.calls[0]![0]).toMatchObject({ refImageUrl: 'https://cdn.shopify.com/real.jpg' })
    expect(res.provider).toBe('fal')
  })

  it('skips Atlas entirely when it is unconfigured', async () => {
    atlasConfigured.mockReturnValue(false)
    const { generateImage } = await import('./generate-image.server')
    const res = await generateImage({ prompt: 'p' })

    expect(atlasGenerate).not.toHaveBeenCalled()
    expect(res.provider).toBe('fal')
  })

  it("only:'fal' pins the fal path and never calls Atlas or Imagen", async () => {
    const { generateImage } = await import('./generate-image.server')
    const res = await generateImage({ prompt: 'p', only: 'fal' })

    expect(atlasGenerate).not.toHaveBeenCalled()
    expect(generateMoodImage).not.toHaveBeenCalled()
    expect(res.provider).toBe('fal')
  })

  it("only:'atlas' pins the Atlas path with no fal or Imagen fallback", async () => {
    atlasGenerate.mockRejectedValue(new Error('atlas down'))
    const { generateImage } = await import('./generate-image.server')
    const res = await generateImage({ prompt: 'p', only: 'atlas' })

    expect(falGenerate).not.toHaveBeenCalled()
    expect(generateMoodImage).not.toHaveBeenCalled()
    expect(res.provider).toBe('none')
  })

  it('passes the improvement original through to Imagen when Atlas and fal both fail', async () => {
    atlasGenerate.mockRejectedValue(new Error('atlas down'))
    falGenerate.mockRejectedValue(new Error('fal down'))
    const { generateImage } = await import('./generate-image.server')
    const original = Buffer.from('orig')
    const res = await generateImage({ prompt: 'p', originalImageBuffer: original })

    expect(generateMoodImage).toHaveBeenCalledTimes(1)
    expect(generateMoodImage.mock.calls[0]![0]).toMatchObject({ originalImageBuffer: original })
    expect(res.provider).toBe('imagen')
  })

  it('returns an empty result rather than throwing when every provider fails', async () => {
    atlasGenerate.mockRejectedValue(new Error('atlas down'))
    falGenerate.mockRejectedValue(new Error('fal down'))
    generateMoodImage.mockRejectedValue(new Error('blocked by safety filters'))
    const { generateImage } = await import('./generate-image.server')

    await expect(generateImage({ prompt: 'p' })).resolves.toEqual({
      buffers: [], provider: 'none', model: 'none',
    })
  })

  it('records an Imagen refusal as a content block, classified and attributed', async () => {
    // Atlas and fal report their own blocks inside their clients. Imagen throws
    // prose, so if this call site did not classify it the last-resort provider's
    // refusals would stay invisible.
    atlasGenerate.mockRejectedValue(new Error('atlas down'))
    falGenerate.mockRejectedValue(new Error('fal down'))
    generateMoodImage.mockRejectedValue(new Error('Image blocked by safety filters'))
    const { generateImage } = await import('./generate-image.server')

    await generateImage({ prompt: 'p', count: 3, feature: 'studio-images', caller: 'test-caller' })

    expect(logGenerationBlock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'imagen',
      reason: 'content_policy',
      count: 3,
      ofFeature: 'studio-images',
      caller: 'test-caller',
    }))
  })

  it('does not record a block when a provider succeeds', async () => {
    const { generateImage } = await import('./generate-image.server')
    await generateImage({ prompt: 'p' })
    expect(logGenerationBlock).not.toHaveBeenCalled()
  })

  it('passes two-or-more refs through as refImageUrls and logs the edit-model cost', async () => {
    atlasGenerate.mockResolvedValue({ buffers: [Buffer.from('x')], costKey: 'atlas/seedream-4.5-edit' })
    const { generateImage } = await import('./generate-image.server')

    const result = await generateImage({
      prompt: 'a vibrator and its lube bottle in one drawer scene',
      refImageUrls: ['https://img.test/toy.jpg', 'https://img.test/lube.jpg'],
      feature: 'social-images',
    })

    expect(atlasGenerate).toHaveBeenCalledTimes(1)
    expect(atlasGenerate.mock.calls[0]![0]).toMatchObject({
      refImageUrls: ['https://img.test/toy.jpg', 'https://img.test/lube.jpg'],
    })
    expect(result).toMatchObject({ provider: 'atlas', model: 'atlas/seedream-4.5-edit' })
    // Cost logged through the standard path, keyed to the model the provider reported.
    expect(logImageCost).toHaveBeenCalledTimes(1)
    expect(logImageCost.mock.calls[0]![0]).toMatchObject({
      model: 'atlas/seedream-4.5-edit',
      feature: 'social-images',
      count: 1,
    })
    // Multi-ref never touches the Imagen fallback.
    expect(generateMoodImage).not.toHaveBeenCalled()
  })

  it('multi-ref falls back to fal FLUX.2 edit when Atlas fails (ticket #2222 lineage)', async () => {
    atlasGenerate.mockRejectedValue(new Error('atlas down'))
    falGenerate.mockResolvedValue({ buffers: [Buffer.from('x')], costKey: 'fal/flux-2-edit' })
    const { generateImage } = await import('./generate-image.server')

    const result = await generateImage({
      prompt: 'two products in one scene',
      refImageUrls: ['https://img.test/toy.jpg', 'https://img.test/lube.jpg'],
    })

    expect(falGenerate.mock.calls[0]![0]).toMatchObject({
      refImageUrls: ['https://img.test/toy.jpg', 'https://img.test/lube.jpg'],
    })
    expect(result).toMatchObject({ provider: 'fal', model: 'fal/flux-2-edit' })
  })

  it('leaves single-ref callers unchanged (refImageUrl only, no refImageUrls)', async () => {
    const { generateImage } = await import('./generate-image.server')
    await generateImage({ prompt: 'the product in a scene', refImageUrl: 'https://img.test/p.jpg' })

    const arg = atlasGenerate.mock.calls[0]![0] as Record<string, unknown>
    expect(arg).toMatchObject({ refImageUrl: 'https://img.test/p.jpg' })
    expect(arg).not.toHaveProperty('refImageUrls')
  })

  it('does not set refImageUrls when the caller passes an empty array', async () => {
    const { generateImage } = await import('./generate-image.server')
    await generateImage({ prompt: 'a lamp on a table', refImageUrls: [] })

    const arg = atlasGenerate.mock.calls[0]![0] as Record<string, unknown>
    expect(arg).not.toHaveProperty('refImageUrls')
    expect(arg).not.toHaveProperty('refImageUrl')
  })
})

describe('falImageSizeForAspect', () => {
  it('maps every aspect the admin and Studio callers can send', async () => {
    const { falImageSizeForAspect } = await import('./generate-image.server')
    expect(falImageSizeForAspect('1:1')).toBe('square_hd')
    expect(falImageSizeForAspect('4:3')).toBe('landscape_4_3')
    expect(falImageSizeForAspect('3:4')).toBe('portrait_4_3')
    expect(falImageSizeForAspect('16:9')).toBe('landscape_16_9')
    expect(falImageSizeForAspect('9:16')).toBe('portrait_16_9')
    expect(falImageSizeForAspect('21:9')).toBeUndefined()
  })
})
