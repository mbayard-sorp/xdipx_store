import sharp from 'sharp'
import { getSiteSettings } from '~/lib/sanity.server'

let logoCache: { buffer: Buffer; ts: number } | null = null
const CACHE_TTL = 1000 * 60 * 60 // 1 hour

async function getLogo(): Promise<Buffer | null> {
  if (logoCache && Date.now() - logoCache.ts < CACHE_TTL) return logoCache.buffer
  const settings = await getSiteSettings()
  if (!settings?.logoUrl) return null
  const res = await fetch(settings.logoUrl)
  if (!res.ok) return null
  const buffer = Buffer.from(await res.arrayBuffer())
  logoCache = { buffer, ts: Date.now() }
  return buffer
}

export async function applyWatermark(imageBuffer: Buffer): Promise<Buffer> {
  try {
    return await applyWatermarkUnsafe(imageBuffer)
  } catch {
    // If watermarking fails for any reason, return the original image
    return imageBuffer
  }
}

async function applyWatermarkUnsafe(imageBuffer: Buffer): Promise<Buffer> {
  const logo = await getLogo()
  if (!logo) return imageBuffer

  const { width, height } = await sharp(imageBuffer).metadata()
  if (!width || !height) return imageBuffer

  // Scale logo to ~12% of image width, semi-transparent at 35% opacity
  const logoWidth = Math.round(width * 0.12)
  const preparedLogo = await sharp(logo)
    .resize(logoWidth)
    .ensureAlpha()
    .composite([{
      input: Buffer.from([255, 255, 255, Math.round(255 * 0.35)]),
      raw: { width: 1, height: 1, channels: 4 },
      tile: true,
      blend: 'dest-in',
    }])
    .png()
    .toBuffer()

  // Position: bottom-right, inset so it overlaps product content
  const logoMeta = await sharp(preparedLogo).metadata()
  const logoHeight = logoMeta.height ?? 0

  return sharp(imageBuffer)
    .composite([{
      input: preparedLogo,
      top: height - logoHeight - Math.round(height * 0.06),
      left: width - logoWidth - Math.round(width * 0.04),
    }])
    .jpeg({ quality: 92 })
    .toBuffer()
}
