/**
 * Crop-to-zone pass, run BEFORE the vision gate on an on-skin social
 * composite (ticket #10999, "the crop is the closer" — owner direction
 * 2026-09-22, `docs/store-team/instagram-campaigns.md` section 3.2c).
 *
 * Evidence: briefed as a close bodyscape, the two-stage compositor renders
 * wide about half the time. Several 2026-09-22 batches (ROMP 2.0 on the
 * belly, Presto wand on the back) failed the vision gate on nipples/pubic
 * area present in the FULL, uncropped frame and were discarded outright, but
 * the owner cropped three of those exact renders to the briefed zone by hand
 * and every crop was clean and exactly the wanted frame. The fence never
 * needed to change; the pixels being judged did.
 *
 * The pass:
 *  1. Ask a vision model for the bounding box of the briefed body zone plus
 *     the product (`box`), AND the product's own box alone (`productBox`),
 *     with the stop-list regions (nipples/areola, labia/penis, anus)
 *     explicitly excluded from both. The same call reports whether the
 *     anatomy inside `box` actually belongs to the briefed zone
 *     (`zoneMatches`), so a navel cropped for a "small-of-back" brief rejects
 *     here rather than reaching the vision gate under the wrong label.
 *  2. Expand `box` to the platform's feed aspect (4:5 or 16:9), sized around
 *     its own centre but PLACED so `productBox` lands inside the frame,
 *     clamped to the image bounds, and crop with `sharp`. A crop whose short
 *     side would fall below the platform minimum is refused rather than
 *     upscaled — an invented 1080px is not a real 1080px.
 *  2b. Ticket #11486 ("the crop is not good... center cropped", owner
 *     2026-09-25): a 4:5 output additionally has to survive Instagram's own
 *     square profile-grid crop, which keeps only the middle 80% of the
 *     frame's height and discards the top/bottom 10% bands. Placing the
 *     window on `box`'s centre (the zone+product union) let a small product
 *     inside a large zone box land in one of those discarded bands. The
 *     window is now placed on `productBox`'s centre instead, and shifted
 *     (never resized) so `productBox` sits entirely inside that central 80%
 *     band; when no shift within the image bounds can do that, the crop is
 *     refused rather than shipping a frame the grid will cut the product out
 *     of.
 *  3. The caller runs the EXISTING eight-check vision gate
 *     (`social-vision-gate.server.ts`) on the returned crop buffer, not the
 *     full render, and only the crop is ever uploaded or ingested into the
 *     library: the fences do not change, only which pixels they see.
 *
 * FAILS CLOSED, matching every other gate in this file's family: a model
 * call that errors, a response that does not parse, an unbounded or
 * too-small crop region, a reported zone mismatch, or a product box that
 * cannot survive the Instagram square crop all refuse the crop
 * (`cropped: false`) rather than falling back to the uncropped frame. Falling
 * back would silently readmit the exact full-frame exposure this pass exists
 * to keep out of the vision gate's input.
 */

import sharp from 'sharp'
import { SONNET } from './models.server'

export interface CropBox {
  /** Fractions of the full image, 0 to 1, (0,0) at the top-left corner. */
  x0: number
  y0: number
  x1: number
  y1: number
}

export type CropRejectReason = 'uncroppable' | 'zone-miss' | 'model-error'

export interface CropToZoneResult {
  cropped: boolean
  /** Present only when `cropped` is true. */
  buffer?: Buffer
  /** The model's proposed zone+product box (pre-aspect-expansion), present whenever the model returned one. */
  box?: CropBox
  /** The model's proposed product-only box (ticket #11486), present whenever the model returned one. */
  productBox?: CropBox
  reason?: CropRejectReason
  notes: string
}

export interface CropToZoneOpts {
  /** The briefed body zone, e.g. one of `BODY_ZONES` in social-scene-vocab.ts. */
  bodyZone: string
  /** Platform feed shape. Only the two live feed shapes are supported. */
  aspectRatio: '4:5' | '16:9'
  /** Crop is refused as uncroppable below this short-side pixel size. Default 1080. */
  minShortSidePx?: number
}

interface RawCropResponse {
  box: CropBox
  /** The product alone, never the zone (ticket #11486). Used to PLACE the aspect-expanded window. */
  productBox: CropBox
  zoneAnatomy: string
  zoneMatches: boolean
  uncroppable: boolean
  notes: string
}

export interface CropToZoneDeps {
  callVision?: (imageBase64: string, mediaType: string, bodyZone: string) => Promise<unknown>
}

/** The prompt is a function of the briefed zone, exported so calibration is testable as text. */
export function cropZoneSystemPrompt(bodyZone: string): string {
  return `You are selecting the crop region for an on-skin sexual-wellness product photo. The brief's body zone is "${bodyZone}". You will be shown the full generated frame, which may render wider than briefed.

Return ONLY a JSON object, no prose before or after, in exactly this shape:
{"box": {"x0": number, "y0": number, "x1": number, "y1": number}, "productBox": {"x0": number, "y0": number, "x1": number, "y1": number}, "zoneAnatomy": "short phrase naming what body part(s) sit inside the box", "zoneMatches": true|false, "uncroppable": true|false, "notes": "one sentence"}

Coordinates are fractions of the full image, 0 to 1, with (0,0) at the top-left corner and (1,1) at the bottom-right. x0 < x1 and y0 < y1.

"box" must:
- Tightly frame the briefed body zone ("${bodyZone}") plus the product against it, with a small margin, not the whole figure.
- NEVER include, even partially, any of these stop-list regions if they are visible anywhere in the source image: nipples or areola, labia or penis, the anus. If the only way to frame the briefed zone would include a stop-list region, set "uncroppable": true.
- "zoneMatches" is true only when the anatomy actually visible inside your proposed box could plausibly belong to "${bodyZone}". A navel or stomach inside a small-of-back box, or a thigh inside a forearm box, is a mismatch: set "zoneMatches": false and name what you actually see in "notes".
- If the frame has no clear candidate region for "${bodyZone}" at all, set "uncroppable": true.

"productBox" is a SEPARATE, tighter box around the product alone, never the surrounding body zone. This is what the final crop is centred on, so it must contain the whole visible product and nothing but the product (a small margin is fine). If the product is not visible at all, set "productBox" equal to "box" and say so in "notes".

Always return your best-guess numeric boxes for both, even when "uncroppable" is true.`
}

function isFiniteFraction(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
}

function isValidBox(v: unknown): v is CropBox {
  if (!v || typeof v !== 'object') return false
  const b = v as Record<string, unknown>
  if (!isFiniteFraction(b['x0']) || !isFiniteFraction(b['y0'])) return false
  if (!isFiniteFraction(b['x1']) || !isFiniteFraction(b['y1'])) return false
  if (!((b['x1'] as number) > (b['x0'] as number))) return false
  if (!((b['y1'] as number) > (b['y0'] as number))) return false
  return true
}

/** Structural validation of a parsed model response before it is trusted. */
export function isValidCropShape(v: unknown): v is RawCropResponse {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (!isValidBox(o['box'])) return false
  if (!isValidBox(o['productBox'])) return false
  if (typeof o['zoneAnatomy'] !== 'string') return false
  if (typeof o['zoneMatches'] !== 'boolean') return false
  if (typeof o['uncroppable'] !== 'boolean') return false
  if (typeof o['notes'] !== 'string') return false
  return true
}

export interface PixelRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Fraction of a 4:5 output's height that Instagram's own 1:1 profile-grid
 * crop actually keeps. For a WxH=4:5 frame, H = W / 0.8, so the square the
 * grid crops to is the middle W-tall band: 80% of H, discarding 10% off the
 * top and 10% off the bottom (ticket #11486).
 */
const IG_SQUARE_CROP_SAFE_FRACTION = 0.8

/**
 * Expand a fractional box to the target feed aspect, sized around `box`'s own
 * centre but PLACED so `productBox` (when given) lands inside the frame,
 * clamped to the image bounds by shifting (never shrinking) where the
 * expansion would run past an edge. Returns null when the box degenerates
 * (zero width/height after clamping), or when a 4:5 frame cannot be shifted
 * to keep `productBox` inside the central band Instagram's own square-grid
 * crop actually keeps (ticket #11486) — a caller that gets null must refuse
 * the crop, not fall back to a half-computed rectangle.
 */
export function expandBoxToAspect(
  box: CropBox,
  imgWidth: number,
  imgHeight: number,
  aspectRatio: '4:5' | '16:9',
  productBox?: CropBox,
): PixelRect | null {
  const targetRatio = aspectRatio === '16:9' ? 16 / 9 : 4 / 5
  const bx0 = box.x0 * imgWidth
  const by0 = box.y0 * imgHeight
  const bx1 = box.x1 * imgWidth
  const by1 = box.y1 * imgHeight
  const bw = bx1 - bx0
  const bh = by1 - by0
  if (!(bw > 0) || !(bh > 0)) return null

  // Grow the box to the target ratio around its own centre: the shorter
  // dimension expands, the longer one stays put. Sizing still comes from
  // `box` (the zone+product union), which sets how tightly the frame is
  // held; only PLACEMENT below prefers the product.
  let w: number
  let h: number
  if (bw / bh > targetRatio) {
    w = bw
    h = bw / targetRatio
  } else {
    h = bh
    w = h * targetRatio
  }

  // The grown box can exceed the image on one axis when the source box is
  // large relative to the frame (an 800px-tall box needing 1422px of width
  // in a 1000px-wide image, for instance). Scaling both dimensions down
  // uniformly keeps the exact target ratio; clamping only the overflowing
  // axis would silently return the wrong ratio instead.
  const scale = Math.min(1, imgWidth / w, imgHeight / h)
  w *= scale
  h *= scale

  // Ticket #11486: centre on the PRODUCT box when one is given (and
  // non-degenerate), not the zone+product union. A small product inside a
  // large zone box used to inherit the union's centre and land wherever the
  // zone happened to put it.
  let px0: number | undefined
  let py0: number | undefined
  let px1: number | undefined
  let py1: number | undefined
  if (productBox) {
    const cpx0 = productBox.x0 * imgWidth
    const cpy0 = productBox.y0 * imgHeight
    const cpx1 = productBox.x1 * imgWidth
    const cpy1 = productBox.y1 * imgHeight
    if (cpx1 > cpx0 && cpy1 > cpy0) {
      px0 = cpx0
      py0 = cpy0
      px1 = cpx1
      py1 = cpy1
    }
  }
  const cx = px0 !== undefined && px1 !== undefined ? (px0 + px1) / 2 : (bx0 + bx1) / 2
  const cy = py0 !== undefined && py1 !== undefined ? (py0 + py1) / 2 : (by0 + by1) / 2

  let left = cx - w / 2
  let top = cy - h / 2
  // Shift (never shrink further) into bounds; `w`/`h` already fit by construction.
  if (left < 0) left = 0
  if (top < 0) top = 0
  if (left + w > imgWidth) left = imgWidth - w
  if (top + h > imgHeight) top = imgHeight - h
  left = Math.max(0, left)
  top = Math.max(0, top)

  const width = Math.round(Math.min(w, imgWidth - left))
  const height = Math.round(Math.min(h, imgHeight - top))
  if (width <= 0 || height <= 0) return null

  // Ticket #11486: for the Instagram feed shape, the product must survive
  // the platform's own 1:1 profile-grid crop, which keeps only the middle
  // 80% of a 4:5 frame's height. Shift the window vertically (never resize
  // it) so `productBox` lands entirely inside that central band; refuse
  // outright when no shift within the image bounds can do it, rather than
  // shipping a frame the grid will cut the product out of.
  if (aspectRatio === '4:5' && py0 !== undefined && py1 !== undefined) {
    const safeMargin = height * (1 - IG_SQUARE_CROP_SAFE_FRACTION) / 2
    // Valid top range so productBox's [py0,py1] sits inside [top+safeMargin, top+height-safeMargin].
    const tMin = py1 - height + safeMargin
    const tMax = py0 - safeMargin
    const bMin = 0
    const bMax = imgHeight - height
    const lo = Math.max(tMin, bMin)
    const hi = Math.min(tMax, bMax)
    if (lo > hi) {
      // The product cannot fit inside the safe band at this crop size,
      // however the window is shifted: refuse rather than ship a frame
      // whose product the grid will cut.
      return null
    }
    top = Math.min(Math.max(top, lo), hi)
  }

  return { left: Math.round(left), top: Math.round(top), width, height }
}

const defaultDeps: Required<CropToZoneDeps> = {
  callVision: async (imageBase64, mediaType, bodyZone) => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']?.trim() })
    const allowedMediaTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
    const media = (allowedMediaTypes as readonly string[]).includes(mediaType)
      ? (mediaType as (typeof allowedMediaTypes)[number])
      : 'image/jpeg'
    const msg = await client.messages.create({
      model: SONNET,
      max_tokens: 300,
      system: cropZoneSystemPrompt(bodyZone),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: media, data: imageBase64 } },
            { type: 'text', text: 'Return the JSON crop selection now.' },
          ],
        },
      ],
    })
    const block = msg.content[0]
    if (block?.type !== 'text') throw new Error('crop-to-zone: unexpected response block type')
    const cleaned = block.text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    return JSON.parse(cleaned)
  },
}

function resolve(deps?: CropToZoneDeps): Required<CropToZoneDeps> {
  return { ...defaultDeps, ...(deps ?? {}) }
}

/**
 * Run the crop-to-zone pass against an in-memory candidate buffer. Never
 * throws: every failure mode (model error, malformed response, an
 * unbounded/too-small crop, a reported zone mismatch) returns
 * `cropped: false` with a `reason`, matching the fail-closed contract every
 * other gate in this family holds — a caller must treat a refused crop
 * exactly like a rehost or vision-gate failure (drop the candidate, stay
 * billed).
 */
export async function cropImageToZone(
  image: { data: Buffer; mediaType: string },
  opts: CropToZoneOpts,
  deps?: CropToZoneDeps,
): Promise<CropToZoneResult> {
  const d = resolve(deps)
  const minShortSide = opts.minShortSidePx ?? 1080

  let imgWidth: number | undefined
  let imgHeight: number | undefined
  try {
    const meta = await sharp(image.data).metadata()
    imgWidth = meta.width
    imgHeight = meta.height
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { cropped: false, reason: 'model-error', notes: `Could not read image dimensions: ${message}` }
  }
  if (!imgWidth || !imgHeight) {
    return { cropped: false, reason: 'model-error', notes: 'Could not read image dimensions.' }
  }

  let parsed: unknown
  try {
    parsed = await d.callVision(image.data.toString('base64'), image.mediaType, opts.bodyZone)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { cropped: false, reason: 'model-error', notes: `Crop-to-zone check could not complete: ${message}` }
  }

  if (!isValidCropShape(parsed)) {
    return { cropped: false, reason: 'model-error', notes: 'Crop-to-zone response did not match the expected shape; failing closed.' }
  }

  if (parsed.uncroppable) {
    return {
      cropped: false,
      box: parsed.box,
      productBox: parsed.productBox,
      reason: 'uncroppable',
      notes: parsed.notes || 'Model reported no croppable region excluding stop-list anatomy.',
    }
  }
  if (!parsed.zoneMatches) {
    return {
      cropped: false,
      box: parsed.box,
      productBox: parsed.productBox,
      reason: 'zone-miss',
      notes: `Zone mismatch: briefed "${opts.bodyZone}" but box shows "${parsed.zoneAnatomy}". ${parsed.notes}`.trim(),
    }
  }

  const rect = expandBoxToAspect(parsed.box, imgWidth, imgHeight, opts.aspectRatio, parsed.productBox)
  if (!rect) {
    return {
      cropped: false,
      box: parsed.box,
      productBox: parsed.productBox,
      reason: 'uncroppable',
      notes: 'Could not compute a valid crop rectangle from the model box, or the product could not be kept ' +
        "inside Instagram's 1:1 profile-grid safe area at this crop size.",
    }
  }
  const shortSide = opts.aspectRatio === '16:9' ? rect.height : rect.width
  if (shortSide < minShortSide) {
    return {
      cropped: false,
      box: parsed.box,
      productBox: parsed.productBox,
      reason: 'uncroppable',
      notes: `Crop region too small (${shortSide}px short side, minimum ${minShortSide}px).`,
    }
  }

  try {
    const buffer = await sharp(image.data).extract(rect).jpeg().toBuffer()
    return { cropped: true, buffer, box: parsed.box, productBox: parsed.productBox, notes: parsed.notes }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { cropped: false, box: parsed.box, productBox: parsed.productBox, reason: 'model-error', notes: `Crop extraction failed: ${message}` }
  }
}

/**
 * Encode a crop box as a `social_media_assets.tags` entry, the same
 * no-migration convention `sceneAxisTags` uses in social-scene-vocab.ts.
 * Fixed 3-decimal precision keeps the tag short and diff-stable.
 */
export function formatCropBoxTag(box: CropBox): string {
  const f = (n: number) => n.toFixed(3)
  return `crop:box=${f(box.x0)},${f(box.y0)},${f(box.x1)},${f(box.y1)}`
}
