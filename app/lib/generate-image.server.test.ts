// Unit tests for generateImage() reference-image plumbing. The fal and token-log
// layers are mocked so these run without the network: we assert that multiple
// reference URLs reach falGenerate as refImageUrls (which routes to
// nano-banana/edit inside fal.server) and that the resulting spend is logged
// through the standard logImageCost path, and that single-ref callers are
// unchanged. Ticket #2222.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const falGenerate = vi.fn((..._args: unknown[]) => undefined as unknown)
const falConfigured = vi.fn((..._args: unknown[]) => true)
const logImageCost = vi.fn((..._args: unknown[]) => undefined as unknown)
const generateMoodImage = vi.fn((..._args: unknown[]) => undefined as unknown)

vi.mock('~/lib/fal.server', () => ({
  falConfigured: (...args: unknown[]) => falConfigured(...args),
  falGenerate: (...args: unknown[]) => falGenerate(...args),
}))
vi.mock('~/lib/token-log.server', () => ({
  logImageCost: (...args: unknown[]) => logImageCost(...args),
}))
vi.mock('~/lib/imagen.server', () => ({
  generateMoodImage: (...args: unknown[]) => generateMoodImage(...args),
}))

import { generateImage } from './generate-image.server'

describe('generateImage reference-image plumbing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    falConfigured.mockReturnValue(true)
  })

  it('passes two-or-more refs through as refImageUrls and logs the nano-banana cost', async () => {
    falGenerate.mockResolvedValue({ buffers: [Buffer.from('x')], costKey: 'fal/nano-banana' })

    const result = await generateImage({
      prompt: 'a vibrator and its lube bottle in one drawer scene',
      refImageUrls: ['https://img.test/toy.jpg', 'https://img.test/lube.jpg'],
      feature: 'social-images',
    })

    expect(falGenerate).toHaveBeenCalledTimes(1)
    expect(falGenerate.mock.calls[0]?.[0]).toMatchObject({
      refImageUrls: ['https://img.test/toy.jpg', 'https://img.test/lube.jpg'],
    })
    expect(result).toMatchObject({ provider: 'fal', model: 'fal/nano-banana' })
    // Cost logged through the standard path, keyed to the model fal reported.
    expect(logImageCost).toHaveBeenCalledTimes(1)
    expect(logImageCost.mock.calls[0]?.[0]).toMatchObject({
      model: 'fal/nano-banana',
      feature: 'social-images',
      count: 1,
    })
    // Multi-ref never touches the Imagen fallback.
    expect(generateMoodImage).not.toHaveBeenCalled()
  })

  it('leaves single-ref callers unchanged (refImageUrl only, no refImageUrls)', async () => {
    falGenerate.mockResolvedValue({ buffers: [Buffer.from('x')], costKey: 'fal/flux-kontext-dev' })

    await generateImage({
      prompt: 'the product in a scene',
      refImageUrl: 'https://img.test/p.jpg',
    })

    const opts = falGenerate.mock.calls[0]?.[0] as Record<string, unknown>
    expect(opts).toMatchObject({ refImageUrl: 'https://img.test/p.jpg' })
    expect(opts).not.toHaveProperty('refImageUrls')
  })

  it('does not set refImageUrls when the caller passes an empty array', async () => {
    falGenerate.mockResolvedValue({ buffers: [Buffer.from('x')], costKey: 'fal/flux-dev' })

    await generateImage({ prompt: 'a lamp on a table', refImageUrls: [] })

    const opts = falGenerate.mock.calls[0]?.[0] as Record<string, unknown>
    expect(opts).not.toHaveProperty('refImageUrls')
    expect(opts).not.toHaveProperty('refImageUrl')
  })
})
