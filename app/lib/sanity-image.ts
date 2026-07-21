// Sanity CDN image URL helpers. Dependency-free equivalent of
// @sanity/image-url for the subset we need: width/quality transforms and
// width-based srcsets. `auto=format` makes the CDN negotiate AVIF/WebP via
// the Accept header, so a single srcset covers modern formats.
// Isomorphic — safe to import from client components.

// Matches the card/hero rendering widths across the notebook surfaces.
export const SANITY_IMAGE_WIDTHS = [400, 640, 828, 1200, 1600]

export function isSanityCdn(url: string | null | undefined): boolean {
  return !!url && url.includes('cdn.sanity.io')
}

export function sanityImageUrl(
  url: string,
  opts: { w?: number; h?: number; q?: number; fit?: 'max' | 'crop' } = {},
): string {
  if (!url || !isSanityCdn(url)) return url
  const params = new URLSearchParams()
  if (opts.w) params.set('w', String(opts.w))
  if (opts.h) params.set('h', String(opts.h))
  params.set('q', String(opts.q ?? 75))
  params.set('auto', 'format')
  params.set('fit', opts.fit ?? 'max')
  return `${url.split('?')[0]}?${params.toString()}`
}

export function sanityImageSrcSet(
  url: string,
  widths: number[] = SANITY_IMAGE_WIDTHS,
  opts: { q?: number; fit?: 'max' | 'crop' } = {},
): string {
  if (!url || !isSanityCdn(url)) return ''
  return widths.map((w) => `${sanityImageUrl(url, { ...opts, w })} ${w}w`).join(', ')
}

// Ceiling for bare asset->url strings found in query results. fit=max never
// upscales, so this only shrinks originals wider than any rendered slot.
export const SANITY_MAX_IMAGE_WIDTH = 1600

/**
 * Recursively rewrite every bare cdn.sanity.io image URL in a query result to
 * its CDN-transformed equivalent (auto AVIF/WebP, width-capped). GROQ's
 * `asset->url` returns the raw original — a 768x1376 PNG avatar weighs 2.18MB
 * where the transformed version is ~26KB. Applied by the read-path client in
 * sanity.server.ts so no projection or component can ship a raw original.
 *
 * URLs that already carry params chose their own transform and pass through,
 * as do SVGs (the image pipeline rasterizes them) and /files/ assets.
 */
export function optimizeSanityImageUrls<T>(value: T): T {
  if (typeof value === 'string') {
    if (
      value.startsWith('https://cdn.sanity.io/images/') &&
      !value.includes('?') &&
      !value.endsWith('.svg')
    ) {
      return sanityImageUrl(value, { w: SANITY_MAX_IMAGE_WIDTH }) as T
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item) => optimizeSanityImageUrls(item)) as T
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = optimizeSanityImageUrls(v)
    return out as T
  }
  return value
}
