/**
 * Ad Studio format matrix (wires section 5.2) and the lane to formats map
 * (plan section 4, ads-policy.md). Shared by the render pipeline, the team
 * endpoint and the Creatives tab, so it is NOT server-only and imports nothing.
 *
 * `id` is what lands in ad_creatives.format (varchar(8)). The three pre-v2 ids
 * ('1:1', '4:5', '9:16') are kept so old rows stay valid. Tailwind class
 * strings are written out in full so the scanner finds them.
 */

export type FormatFamily = 'square' | 'portrait' | 'story' | 'wide' | 'banner' | 'text'

export interface AdFormat {
  id: string
  label: string
  width: number
  height: number
  family: FormatFamily
  /** Plate generation bucket: formats in one bucket share one plate per idea. */
  plateBucket: 'square' | 'portrait' | 'story' | 'wide'
  /** Spans two columns at lg in the Creatives grid. */
  spanWide: boolean
  /** Aspect-true well classes (wires 5.2). */
  wellClass: string
  /** Largest slogan, in characters, the template can set legibly at this size. */
  maxSloganChars: number
  /**
   * Largest file the network accepts at this size, in bytes. The compositor and
   * the banner zip re-encode until the image is under it. Unset means no cap.
   */
  maxBytes?: number
}

/**
 * ExoClick's static image cap. Its Ad Formats page says 300 KB for banner and
 * mobile banner images, its Media Library page says 150 KB for any image under
 * 1,000,000 pixels (banner, native, push). We hold the stricter number so an
 * upload never bounces. Sources and the full spec: docs/store-team/ad-studio-exports.md,
 * section "ExoClick banner spec".
 */
export const EXOCLICK_MAX_IMAGE_BYTES = 150 * 1024
const EXO = EXOCLICK_MAX_IMAGE_BYTES

const F = (f: AdFormat): AdFormat => f

export const AD_FORMATS: readonly AdFormat[] = [
  F({ id: '1:1', label: '1:1', width: 1080, height: 1080, family: 'square', plateBucket: 'square', spanWide: false, wellClass: 'aspect-square w-full', maxSloganChars: 90 }),
  F({ id: '4:5', label: '4:5', width: 1080, height: 1350, family: 'portrait', plateBucket: 'portrait', spanWide: false, wellClass: 'aspect-[4/5] w-full', maxSloganChars: 90 }),
  F({ id: '9:16', label: '9:16', width: 1080, height: 1920, family: 'story', plateBucket: 'story', spanWide: false, wellClass: 'aspect-[9/16] h-[min(70dvh,560px)] mx-auto', maxSloganChars: 80 }),
  F({ id: '1200x628', label: '1200x628', width: 1200, height: 628, family: 'wide', plateBucket: 'wide', spanWide: true, wellClass: 'aspect-[1200/628] w-full', maxSloganChars: 80 }),
  F({ id: '600x600', label: '600x600', width: 600, height: 600, family: 'square', plateBucket: 'square', spanWide: false, wellClass: 'aspect-square w-full max-w-[600px] mx-auto', maxSloganChars: 70 }),
  // ExoClick static banners (owner's account format list, 2026-10-20): Banner
  // 160x600, 300x250, 728x90, 900x250; Mobile Banner 300x100, 300x50. JPEG,
  // PNG or GIF, capped at EXOCLICK_MAX_IMAGE_BYTES.
  F({ id: '300x250', label: '300x250', width: 300, height: 250, family: 'banner', plateBucket: 'wide', spanWide: false, wellClass: 'aspect-[6/5] w-full max-w-[300px] mx-auto', maxSloganChars: 42, maxBytes: EXO }),
  F({ id: '728x90', label: '728x90', width: 728, height: 90, family: 'banner', plateBucket: 'wide', spanWide: true, wellClass: 'aspect-[728/90] w-full max-w-[728px]', maxSloganChars: 44, maxBytes: EXO }),
  F({ id: '300x100', label: '300x100', width: 300, height: 100, family: 'banner', plateBucket: 'wide', spanWide: false, wellClass: 'aspect-[3/1] w-full max-w-[300px] mx-auto', maxSloganChars: 30, maxBytes: EXO }),
  F({ id: '900x250', label: '900x250', width: 900, height: 250, family: 'banner', plateBucket: 'wide', spanWide: true, wellClass: 'aspect-[900/250] w-full max-w-[900px]', maxSloganChars: 60, maxBytes: EXO }),
  // Wide skyscraper: a narrow column, so the slogan wraps over several short lines. Tall plate.
  F({ id: '160x600', label: '160x600', width: 160, height: 600, family: 'banner', plateBucket: 'story', spanWide: false, wellClass: 'aspect-[160/600] h-[min(70dvh,600px)] mx-auto', maxSloganChars: 48, maxBytes: EXO }),
  // Mobile leaderboard: 50px tall, one line of type at the 11px floor, so only a few words fit.
  F({ id: '300x50', label: '300x50', width: 300, height: 50, family: 'banner', plateBucket: 'wide', spanWide: false, wellClass: 'aspect-[6/1] w-full max-w-[300px] mx-auto', maxSloganChars: 22, maxBytes: EXO }),
]

/** Text-only creatives (Google and Microsoft Search). No image, no size. */
export const TEXT_FORMAT_ID = 'text'

export const AD_FORMAT_IDS: readonly string[] = [...AD_FORMATS.map(f => f.id), TEXT_FORMAT_ID]

const BY_ID = new Map(AD_FORMATS.map(f => [f.id, f]))

export function getAdFormat(id: string | null | undefined): AdFormat | null {
  return id ? BY_ID.get(id) ?? null : null
}

export function isTextFormat(id: string | null | undefined): boolean {
  return id === TEXT_FORMAT_ID
}

/**
 * Lane to formats (plan section 4, wires 5.2). google and microsoft produce no
 * image: their creative row carries headlines only (format 'text').
 */
export const LANE_FORMATS: Readonly<Record<string, readonly string[]>> = {
  meta: ['1:1', '4:5', '1200x628'],
  snap: ['9:16'],
  // ExoClick's six static sizes. JuicyAds takes the same IAB sizes for the four it shares.
  adult: ['300x250', '728x90', '160x600', '900x250', '300x100', '300x50'],
  newsletter: ['1200x628', '600x600'],
  owned: ['1200x628', '1:1'],
  google: [TEXT_FORMAT_ID],
  microsoft: [TEXT_FORMAT_ID],
}

export function formatsForLane(lane: string): AdFormat[] {
  return (LANE_FORMATS[lane] ?? []).map(id => getAdFormat(id)).filter((f): f is AdFormat => f !== null)
}

/** True for lanes whose creative has no image (Search text ads). */
export function isTextOnlyLane(lane: string): boolean {
  const ids = LANE_FORMATS[lane] ?? []
  return ids.length > 0 && ids.every(id => id === TEXT_FORMAT_ID)
}

/** The byte cap for a rendered size, from the first format at that size that carries one. */
export function maxBytesForSize(width: number, height: number): number | null {
  const f = AD_FORMATS.find(x => x.width === width && x.height === height && x.maxBytes)
  return f?.maxBytes ?? null
}

/** Native pixel size, or null for the text format. */
export function nativeSize(id: string): { width: number; height: number } | null {
  const f = getAdFormat(id)
  return f ? { width: f.width, height: f.height } : null
}

/** Plate generation size per bucket, passed to the image provider. Cropped to the exact format afterwards. */
export const PLATE_IMAGE_SIZE: Readonly<Record<AdFormat['plateBucket'], string | { width: number; height: number }>> = {
  square: 'square_hd',
  portrait: { width: 1728, height: 2160 },
  story: 'portrait_16_9',
  wide: 'landscape_16_9',
}

/** Lanes whose exporter can be downloaded today (PR-C): everything with an image. */
export function laneHasImage(lane: string): boolean {
  return (LANE_FORMATS[lane] ?? []).some(id => id !== TEXT_FORMAT_ID)
}
