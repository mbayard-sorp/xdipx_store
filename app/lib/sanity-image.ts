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
