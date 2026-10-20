/**
 * Keep a rendered banner under a network's file-size cap (ExoClick: 150 KB for
 * any image under 1,000,000 pixels, see EXOCLICK_MAX_IMAGE_BYTES).
 *
 * Two entry points:
 *   fitPngUnderBytes   PNG in, PNG out. Steps down to a palette PNG. Used by the
 *                      compositor, whose caller stores the file as .png.
 *   fitImageUnderBytes PNG steps first, then JPEG with falling quality. Used by
 *                      the banner zip, which names each file by what it holds.
 *
 * Neither ever upscales or crops: the pixel size stays exactly what the format
 * says. When nothing gets under the cap, the smallest attempt comes back with
 * withinLimit false and the caller decides (the zip refuses).
 */
import sharp from 'sharp'

export interface FittedImage {
  bytes: Buffer
  ext: 'png' | 'jpg'
  contentType: 'image/png' | 'image/jpeg'
  withinLimit: boolean
  /** Which encode got it under, for the manifest: 'original', 'png-q80-c256', 'jpeg-q70'. */
  encoding: string
}

/** Palette PNG steps, gentlest first. */
const PNG_STEPS: ReadonlyArray<{ quality: number; colours: number }> = [
  { quality: 90, colours: 256 },
  { quality: 75, colours: 256 },
  { quality: 60, colours: 128 },
  { quality: 50, colours: 64 },
]

const JPEG_QUALITIES: readonly number[] = [88, 80, 72, 64, 56, 48, 40]

function original(bytes: Buffer, max: number): FittedImage {
  return { bytes, ext: 'png', contentType: 'image/png', withinLimit: bytes.length <= max, encoding: 'original' }
}

export async function fitPngUnderBytes(png: Buffer, maxBytes: number): Promise<FittedImage> {
  if (png.length <= maxBytes) return original(png, maxBytes)
  let best = original(png, maxBytes)
  for (const s of PNG_STEPS) {
    const out = await sharp(png).png({ palette: true, quality: s.quality, colours: s.colours, compressionLevel: 9, effort: 7 }).toBuffer()
    const cand: FittedImage = { bytes: out, ext: 'png', contentType: 'image/png', withinLimit: out.length <= maxBytes, encoding: `png-q${s.quality}-c${s.colours}` }
    if (cand.withinLimit) return cand
    if (out.length < best.bytes.length) best = cand
  }
  return best
}

export async function fitImageUnderBytes(bytes: Buffer, maxBytes: number): Promise<FittedImage> {
  if (bytes.length <= maxBytes) return original(bytes, maxBytes)
  const png = await fitPngUnderBytes(bytes, maxBytes)
  if (png.withinLimit) return png
  let best = png
  for (const q of JPEG_QUALITIES) {
    // Banners are opaque; flatten on paper white in case an alpha channel came through.
    const out = await sharp(bytes).flatten({ background: '#FFFFFF' }).jpeg({ quality: q, mozjpeg: true }).toBuffer()
    const cand: FittedImage = { bytes: out, ext: 'jpg', contentType: 'image/jpeg', withinLimit: out.length <= maxBytes, encoding: `jpeg-q${q}` }
    if (cand.withinLimit) return cand
    if (out.length < best.bytes.length) best = cand
  }
  return best
}
