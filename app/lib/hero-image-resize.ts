/**
 * hero-image-resize.ts
 *
 * Pure image-sizing helper for the Notebook hero composite path (ticket #2752).
 *
 * The stage-2 compositor (composeSceneFrame) drifts ~1% off the pixel
 * dimensions it is sent — the live test observed 1088x1376 for a requested
 * 1080x1350 — so a caller must never trust the returned dimensions. Every hero
 * candidate is forced to EXACTLY the target before the vision gate and before
 * upload. `cover` + centre position crops the overflow rather than distorting
 * the composite (a squished cast member is worse than a tighter crop).
 *
 * Kept dependency-light (sharp only, no server/db imports) so it is unit-testable
 * without network or env, the way blog-hero-embed-audit.ts is.
 */

import sharp from 'sharp'

/** Notebook hero target: landscape 4:3 at 1200x900 (image-brief §0). */
export const HERO_TARGET = { width: 1200, height: 900 } as const

/**
 * Center-crop-resize a buffer to exactly `width` x `height`, returning PNG bytes.
 * Defaults to HERO_TARGET.
 */
export async function resizeToExactCover(
  buf: Buffer,
  width: number = HERO_TARGET.width,
  height: number = HERO_TARGET.height,
): Promise<Buffer> {
  return sharp(buf)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer()
}
