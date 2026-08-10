// Unit tests for the provider-neutral image entry point.
//
// The admin and Sanity Studio image paths used to call Imagen directly, so an
// operator typing a prompt got Google's filter with no fal attempt at all. These
// lock in the routing those callers now depend on: fal first, a real prompt even
// when the caller supplies only categories, and reference bytes reaching fal's
// image-conditioned endpoint rather than being dropped on the floor.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const falGenerate = vi.fn()
const generateMoodImage = vi.fn()

vi.mock('~/lib/fal.server', () => ({
  falConfigured: () => true,
  falGenerate: (...args: unknown[]) => falGenerate(...args),
}))

vi.mock('~/lib/imagen.server', () => ({
  generateMoodImage: (...args: unknown[]) => generateMoodImage(...args),
  defaultMoodPrompt: (cats: string[]) => `MOOD_BRIEF(${cats.join(',')})`,
}))

const logGenerationBlock = vi.fn()
vi.mock('~/lib/token-log.server', () => ({
  logImageCost: vi.fn(),
  logGenerationBlock: (...args: unknown[]) => logGenerationBlock(...args),
}))

const OK = { buffers: [Buffer.from('img')], costKey: 'fal/flux-dev' }

describe('generateImage', () => {
  beforeEach(() => {
    falGenerate.mockReset().mockResolvedValue(OK)
    generateMoodImage.mockReset().mockResolvedValue([Buffer.from('imagen')])
    logGenerationBlock.mockReset()
  })
  afterEach(() => vi.resetModules())

  it('sends a category-derived prompt to fal instead of skipping straight to Imagen', async () => {
    const { generateImage } = await import('./generate-image.server')
    const res = await generateImage({ categories: ['Wands'] })

    expect(falGenerate).toHaveBeenCalledTimes(1)
    expect(falGenerate.mock.calls[0]![0]).toMatchObject({ prompt: 'MOOD_BRIEF(Wands)' })
    expect(generateMoodImage).not.toHaveBeenCalled()
    expect(res.provider).toBe('fal')
  })

  it('inlines an improvement-mode original as a data URI so fal can edit it', async () => {
    const { generateImage } = await import('./generate-image.server')
    await generateImage({ prompt: 'brighter room', originalImageBuffer: Buffer.from('orig') })

    const arg = falGenerate.mock.calls[0]![0] as { refImageUrl?: string }
    expect(arg.refImageUrl).toBe(`data:image/jpeg;base64,${Buffer.from('orig').toString('base64')}`)
  })

  it('inlines the first product reference buffer when no explicit URL is given', async () => {
    const { generateImage } = await import('./generate-image.server')
    await generateImage({ prompt: 'p', referenceImageBuffers: [Buffer.from('ref1'), Buffer.from('ref2')] })

    const arg = falGenerate.mock.calls[0]![0] as { refImageUrl?: string }
    expect(arg.refImageUrl).toBe(`data:image/jpeg;base64,${Buffer.from('ref1').toString('base64')}`)
  })

  it('prefers an explicit refImageUrl over inlined buffers', async () => {
    const { generateImage } = await import('./generate-image.server')
    await generateImage({
      prompt: 'p',
      refImageUrl: 'https://cdn.shopify.com/real.jpg',
      originalImageBuffer: Buffer.from('orig'),
    })

    const arg = falGenerate.mock.calls[0]![0] as { refImageUrl?: string }
    expect(arg.refImageUrl).toBe('https://cdn.shopify.com/real.jpg')
  })

  it('resolves an aspect ratio to a fal image_size', async () => {
    const { generateImage } = await import('./generate-image.server')
    await generateImage({ prompt: 'p', aspectRatio: '9:16' })

    expect(falGenerate.mock.calls[0]![0]).toMatchObject({ imageSize: 'portrait_16_9' })
  })

  it('passes the improvement original through to Imagen when fal fails', async () => {
    falGenerate.mockRejectedValue(new Error('fal down'))
    const { generateImage } = await import('./generate-image.server')
    const original = Buffer.from('orig')
    const res = await generateImage({ prompt: 'p', originalImageBuffer: original })

    expect(generateMoodImage).toHaveBeenCalledTimes(1)
    expect(generateMoodImage.mock.calls[0]![0]).toMatchObject({ originalImageBuffer: original })
    expect(res.provider).toBe('imagen')
  })

  it('returns an empty result rather than throwing when both providers fail', async () => {
    falGenerate.mockRejectedValue(new Error('fal down'))
    generateMoodImage.mockRejectedValue(new Error('blocked by safety filters'))
    const { generateImage } = await import('./generate-image.server')

    await expect(generateImage({ prompt: 'p' })).resolves.toEqual({
      buffers: [], provider: 'none', model: 'none',
    })
  })

  it('records an Imagen refusal as a content block, classified and attributed', async () => {
    // fal reports its own blocks inside falGenerate. Imagen throws prose, so if
    // this call site did not classify it the fallback provider's refusals, which
    // is most of what an operator hits, would stay invisible.
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
