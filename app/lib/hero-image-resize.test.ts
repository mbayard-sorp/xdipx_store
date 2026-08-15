import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { HERO_TARGET, resizeToExactCover } from './hero-image-resize'

/** A solid-colour test image at arbitrary dimensions. */
async function makeImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 90, b: 54 } },
  }).png().toBuffer()
}

describe('resizeToExactCover', () => {
  // The stage-2 compositor drifts ~1% off requested pixels (the live test saw
  // 1088x1376 for a requested 1080x1350), so the returned dimensions are never
  // trusted — every candidate is forced to exactly 1200x900.
  it.each([
    ['compositor drift', 1088, 1376],
    ['exact target already', 1200, 900],
    ['square', 500, 500],
    ['tall portrait', 1080, 1920],
    ['wide panorama', 3000, 800],
  ])('forces %s (%ix%i) to exactly 1200x900', async (_label, w, h) => {
    const out = await resizeToExactCover(await makeImage(w, h))
    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(1200)
    expect(meta.height).toBe(900)
    expect(meta.format).toBe('png')
  })

  it('honours HERO_TARGET as the default and matches an explicit target', async () => {
    expect(HERO_TARGET).toEqual({ width: 1200, height: 900 })
    const out = await resizeToExactCover(await makeImage(640, 480), 300, 200)
    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(300)
    expect(meta.height).toBe(200)
  })
})
