// Crop-to-zone pass, run before the vision gate on an on-skin composite
// (ticket #10999). Every seam is injected except `sharp` itself, which runs
// for real against small synthetic images so the geometry math is proven
// against actual pixels, not just fractions.
import { describe, it, expect, vi } from 'vitest'
import sharp from 'sharp'
import {
  cropImageToZone,
  cropZoneSystemPrompt,
  expandBoxToAspect,
  formatCropBoxTag,
  isValidCropShape,
  type CropToZoneDeps,
} from './social-crop-to-zone.server'

/** A real, decodable JPEG at the given size, for exercising sharp's extract(). */
async function fakeImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 150, b: 150 } },
  })
    .jpeg()
    .toBuffer()
}

const CLEAN_BOX = {
  box: { x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.7 },
  productBox: { x0: 0.45, y0: 0.45, x1: 0.55, y1: 0.55 },
  zoneAnatomy: 'small of back',
  zoneMatches: true,
  uncroppable: false,
  notes: 'clean, zone matches',
}

function deps(over: Partial<CropToZoneDeps> = {}): CropToZoneDeps {
  return {
    callVision: vi.fn(async () => CLEAN_BOX),
    ...over,
  }
}

describe('cropZoneSystemPrompt', () => {
  it('names the briefed zone and the stop-list regions', () => {
    const prompt = cropZoneSystemPrompt('small-of-back')
    expect(prompt).toContain('small-of-back')
    expect(prompt).toContain('nipples or areola')
    expect(prompt).toContain('labia or penis')
    expect(prompt).toContain('the anus')
    expect(prompt).toContain('uncroppable')
    expect(prompt).toContain('zoneMatches')
  })
})

describe('isValidCropShape', () => {
  it('accepts a well-formed response', () => {
    expect(isValidCropShape(CLEAN_BOX)).toBe(true)
  })

  it('rejects a box with x1 <= x0', () => {
    expect(isValidCropShape({ ...CLEAN_BOX, box: { x0: 0.5, y0: 0.3, x1: 0.5, y1: 0.7 } })).toBe(false)
  })

  it('rejects a fraction outside 0..1', () => {
    expect(isValidCropShape({ ...CLEAN_BOX, box: { ...CLEAN_BOX.box, x1: 1.2 } })).toBe(false)
  })

  it('rejects a missing zoneMatches', () => {
    const { zoneMatches: _zoneMatches, ...rest } = CLEAN_BOX
    expect(isValidCropShape(rest)).toBe(false)
  })

  it('rejects a missing uncroppable', () => {
    const { uncroppable: _uncroppable, ...rest } = CLEAN_BOX
    expect(isValidCropShape(rest)).toBe(false)
  })

  it('rejects a missing productBox (ticket #11486)', () => {
    const { productBox: _productBox, ...rest } = CLEAN_BOX
    expect(isValidCropShape(rest)).toBe(false)
  })

  it('rejects a productBox with x1 <= x0', () => {
    expect(isValidCropShape({ ...CLEAN_BOX, productBox: { x0: 0.5, y0: 0.45, x1: 0.5, y1: 0.55 } })).toBe(false)
  })

  it('rejects null and non-objects', () => {
    expect(isValidCropShape(null)).toBe(false)
    expect(isValidCropShape('nope')).toBe(false)
  })
})

describe('expandBoxToAspect', () => {
  it('grows height when the box is wider than the 4:5 target', () => {
    // 1000x1000 image, a wide box (800x200): 4:5 wants height > width.
    const rect = expandBoxToAspect({ x0: 0.1, y0: 0.4, x1: 0.9, y1: 0.6 }, 1000, 1000, '4:5')
    expect(rect).not.toBeNull()
    expect(rect!.width / rect!.height).toBeCloseTo(4 / 5, 2)
  })

  it('grows width when the box is narrower than the 16:9 target', () => {
    const rect = expandBoxToAspect({ x0: 0.4, y0: 0.1, x1: 0.6, y1: 0.9 }, 1000, 1000, '16:9')
    expect(rect).not.toBeNull()
    expect(rect!.width / rect!.height).toBeCloseTo(16 / 9, 2)
  })

  it('clamps and shifts rather than shrinking when the expansion would run past an edge', () => {
    // Box already touches the top edge; expanding height must shift down, not go negative.
    const rect = expandBoxToAspect({ x0: 0.3, y0: 0, y1: 0.3, x1: 0.7 }, 1000, 1000, '4:5')
    expect(rect).not.toBeNull()
    expect(rect!.top).toBeGreaterThanOrEqual(0)
    expect(rect!.top + rect!.height).toBeLessThanOrEqual(1000)
  })

  it('returns null for a degenerate zero-area box', () => {
    expect(expandBoxToAspect({ x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.9 }, 1000, 1000, '4:5')).toBeNull()
  })

  // Ticket #11486 DONE WHEN: "a unit test proves that for a product box near
  // the top or bottom of a render, the returned 4:5 window puts the product
  // inside the central square" (the middle 80% of the output's height, the
  // band Instagram's own 1:1 profile-grid crop keeps).
  describe('product safe-area placement (ticket #11486)', () => {
    // A 4000px image, a zone box that expands to an 800x1000 4:5 window
    // (comfortable slack on every side), and a small product tucked near the
    // top or bottom of that zone: centring on the zone union (the old
    // behaviour) put the product wherever the union's own centre fell, not
    // where the product actually was.
    const zoneBox = { x0: 0.35, y0: 0.35, x1: 0.55, y1: 0.45 }
    const productNearTop = { x0: 0.45, y0: 0.36, x1: 0.55, y1: 0.385 }
    const productNearBottom = { x0: 0.45, y0: 0.415, x1: 0.55, y1: 0.44 }

    it('places a product near the top of the render inside the central safe band', () => {
      const rect = expandBoxToAspect(zoneBox, 4000, 4000, '4:5', productNearTop)
      expect(rect).not.toBeNull()
      const safeMargin = rect!.height * 0.1
      const productTopPx = productNearTop.y0 * 4000
      const productBottomPx = productNearTop.y1 * 4000
      expect(productTopPx).toBeGreaterThanOrEqual(rect!.top + safeMargin - 0.5)
      expect(productBottomPx).toBeLessThanOrEqual(rect!.top + rect!.height - safeMargin + 0.5)
    })

    it('places a product near the bottom of the render inside the central safe band', () => {
      const rect = expandBoxToAspect(zoneBox, 4000, 4000, '4:5', productNearBottom)
      expect(rect).not.toBeNull()
      const safeMargin = rect!.height * 0.1
      const productTopPx = productNearBottom.y0 * 4000
      const productBottomPx = productNearBottom.y1 * 4000
      expect(productTopPx).toBeGreaterThanOrEqual(rect!.top + safeMargin - 0.5)
      expect(productBottomPx).toBeLessThanOrEqual(rect!.top + rect!.height - safeMargin + 0.5)
    })

    it('centres the window on the product rather than the zone+product union', () => {
      // A wide, short zone box whose own centre sits far from a product
      // tucked into its right-hand side.
      const rect = expandBoxToAspect(
        { x0: 0.2, y0: 0.45, x1: 0.8, y1: 0.55 },
        4000, 4000, '4:5',
        { x0: 0.65, y0: 0.48, x1: 0.75, y1: 0.52 },
      )
      expect(rect).not.toBeNull()
      const productCx = 0.5 * (0.65 + 0.75) * 4000
      const zoneCx = 0.5 * (0.2 + 0.8) * 4000
      const windowCx = rect!.left + rect!.width / 2
      // The window's own centre lands on the product's centre, not the
      // zone's centre (2000px away).
      expect(Math.abs(windowCx - productCx)).toBeLessThan(1)
      expect(Math.abs(windowCx - zoneCx)).toBeGreaterThan(500)
    })

    // Ticket #11486 DONE WHEN: "a test proves refusal when it cannot."
    it('refuses the crop when the product cannot fit inside the safe band at this crop size', () => {
      // The product itself is taller than the 80%-of-height safe band could
      // ever be for a tightly-sized 4:5 window: no shift can rescue it.
      const tallProduct = { x0: 0.45, y0: 0.05, x1: 0.55, y1: 0.95 }
      const rect = expandBoxToAspect(
        { x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.7 },
        2000, 2000, '4:5',
        tallProduct,
      )
      expect(rect).toBeNull()
    })

    it('does not enforce the safe area for 16:9 (not an Instagram feed shape)', () => {
      // Same geometry that would refuse at 4:5 must still produce a rect at 16:9.
      const rect = expandBoxToAspect(
        { x0: 0.1, y0: 0.05, x1: 0.9, y1: 0.95 },
        2000, 2000, '16:9',
        { x0: 0.4, y0: 0.06, x1: 0.6, y1: 0.16 },
      )
      expect(rect).not.toBeNull()
    })

    it('falls back to zone-centred placement when no productBox is given (unchanged behaviour)', () => {
      const rect = expandBoxToAspect({ x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.7 }, 1000, 1000, '4:5')
      expect(rect).not.toBeNull()
    })
  })
})

describe('formatCropBoxTag', () => {
  it('encodes the box as a fixed-precision social_media_assets tag', () => {
    expect(formatCropBoxTag({ x0: 0.1, y0: 0.2, x1: 0.8, y1: 0.9 })).toBe('crop:box=0.100,0.200,0.800,0.900')
  })
})

describe('cropImageToZone', () => {
  it('crops a clean candidate to the briefed zone at the platform aspect', async () => {
    // Large enough that the box (0.3-0.7 of each side) still clears the
    // 1080px minimum short side once expanded to 4:5.
    const image = await fakeImage(4000, 4000)
    const result = await cropImageToZone(
      { data: image, mediaType: 'image/jpeg' },
      { bodyZone: 'small-of-back', aspectRatio: '4:5' },
      deps(),
    )
    expect(result.cropped).toBe(true)
    expect(result.buffer).toBeInstanceOf(Buffer)
    expect(result.box).toEqual(CLEAN_BOX.box)
    // The cropped output must itself decode and match the 4:5 aspect.
    const meta = await sharp(result.buffer!).metadata()
    expect(meta.width! / meta.height!).toBeCloseTo(4 / 5, 1)
  })

  it('passes the briefed zone and image bytes to callVision', async () => {
    const image = await fakeImage(1500, 1500)
    const callVision = vi.fn(async () => CLEAN_BOX)
    await cropImageToZone({ data: image, mediaType: 'image/jpeg' }, { bodyZone: 'forearm', aspectRatio: '16:9' }, { callVision })
    expect(callVision).toHaveBeenCalledWith(image.toString('base64'), 'image/jpeg', 'forearm')
  })

  // DONE WHEN criterion: box-outside-stop-regions. The model cannot frame the
  // briefed zone without including a stop-list region (nipples/genitals/anus)
  // and says so; the pass must refuse rather than crop anyway.
  it('refuses as uncroppable when the model reports no box excludes the stop-list regions', async () => {
    const image = await fakeImage(2000, 2000)
    const result = await cropImageToZone(
      { data: image, mediaType: 'image/jpeg' },
      { bodyZone: 'sternum', aspectRatio: '4:5' },
      deps({
        callVision: vi.fn(async () => ({
          box: { x0: 0.2, y0: 0.1, x1: 0.8, y1: 0.6 },
          productBox: { x0: 0.4, y0: 0.3, x1: 0.6, y1: 0.5 },
          zoneAnatomy: 'sternum and breast',
          zoneMatches: true,
          uncroppable: true,
          notes: 'cannot frame the sternum without including the nipple',
        })),
      }),
    )
    expect(result.cropped).toBe(false)
    expect(result.reason).toBe('uncroppable')
    expect(result.notes).toContain('nipple')
  })

  // DONE WHEN criterion: the zone-miss reject.
  it('refuses as zone-miss when the anatomy in the box does not belong to the briefed zone', async () => {
    const image = await fakeImage(2000, 2000)
    const result = await cropImageToZone(
      { data: image, mediaType: 'image/jpeg' },
      { bodyZone: 'small-of-back', aspectRatio: '4:5' },
      deps({
        callVision: vi.fn(async () => ({
          box: { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 },
          productBox: { x0: 0.4, y0: 0.4, x1: 0.6, y1: 0.6 },
          zoneAnatomy: 'navel and stomach',
          zoneMatches: false,
          uncroppable: false,
          notes: 'this is the front of the torso, not the small of the back',
        })),
      }),
    )
    expect(result.cropped).toBe(false)
    expect(result.reason).toBe('zone-miss')
    expect(result.notes).toContain('small-of-back')
    expect(result.notes).toContain('navel and stomach')
  })

  it('refuses as uncroppable when the resulting crop would be smaller than the minimum short side', async () => {
    const image = await fakeImage(1000, 1000)
    const result = await cropImageToZone(
      { data: image, mediaType: 'image/jpeg' },
      { bodyZone: 'ankle', aspectRatio: '4:5', minShortSidePx: 1080 },
      deps({
        callVision: vi.fn(async () => ({
          box: { x0: 0.45, y0: 0.45, x1: 0.55, y1: 0.55 },
          productBox: { x0: 0.47, y0: 0.47, x1: 0.53, y1: 0.53 },
          zoneAnatomy: 'ankle',
          zoneMatches: true,
          uncroppable: false,
          notes: 'small candidate region',
        })),
      }),
    )
    expect(result.cropped).toBe(false)
    expect(result.reason).toBe('uncroppable')
    expect(result.notes).toContain('too small')
  })

  it('fails closed with model-error when the model call throws', async () => {
    const image = await fakeImage(1500, 1500)
    const result = await cropImageToZone(
      { data: image, mediaType: 'image/jpeg' },
      { bodyZone: 'forearm', aspectRatio: '4:5' },
      deps({ callVision: vi.fn(async () => { throw new Error('anthropic 529') }) }),
    )
    expect(result.cropped).toBe(false)
    expect(result.reason).toBe('model-error')
    expect(result.notes).toContain('anthropic 529')
  })

  it('fails closed with model-error when the response does not match the expected shape', async () => {
    const image = await fakeImage(1500, 1500)
    const result = await cropImageToZone(
      { data: image, mediaType: 'image/jpeg' },
      { bodyZone: 'forearm', aspectRatio: '4:5' },
      deps({ callVision: vi.fn(async () => ({ garbage: true })) }),
    )
    expect(result.cropped).toBe(false)
    expect(result.reason).toBe('model-error')
    expect(result.notes).toContain('expected shape')
  })

  it('fails closed with model-error when the buffer is not a decodable image', async () => {
    const result = await cropImageToZone(
      { data: Buffer.from('not an image'), mediaType: 'image/jpeg' },
      { bodyZone: 'forearm', aspectRatio: '4:5' },
      deps(),
    )
    expect(result.cropped).toBe(false)
    expect(result.reason).toBe('model-error')
  })

  it('never throws, even when every dep throws', async () => {
    const image = await fakeImage(1500, 1500)
    await expect(
      cropImageToZone(
        { data: image, mediaType: 'image/jpeg' },
        { bodyZone: 'forearm', aspectRatio: '4:5' },
        deps({ callVision: vi.fn(async () => { throw new Error('boom') }) }),
      ),
    ).resolves.toMatchObject({ cropped: false })
  })
})
