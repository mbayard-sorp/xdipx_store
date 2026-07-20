// LCP hero preload tag builder, CDN-aware. The contract that matters: the
// preload's href/imagesrcset must be byte-identical to the candidate URLs
// <OptimizedImage> renders for the same source, or the browser preloads one
// URL and then fetches another (a silent LCP regression, not a win).
// Isomorphic — meta() runs on both server and client.

import { isShopifyCdn } from '~/lib/shopify-image'
import { isSanityCdn, sanityImageUrl, sanityImageSrcSet } from '~/lib/sanity-image'

// Same widths as OptimizedImage's DEFAULT_WIDTHS.
const PRELOAD_WIDTHS = [480, 768, 1024, 1600]
const DEFAULT_SIZES = '(max-width: 768px) 100vw, 50vw'

type PreloadLinkTag = {
  tagName: 'link'
  rel: 'preload'
  as: 'image'
  href: string
  fetchpriority: 'high'
  type?: string
  imagesrcset?: string
  imagesizes?: string
}

export function heroPreloadTag(
  imageUrl: string | undefined | null,
  { widths = PRELOAD_WIDTHS, sizes = DEFAULT_SIZES, fallbackWidth = 1024 } = {},
): PreloadLinkTag | null {
  if (!imageUrl) return null

  if (isShopifyCdn(imageUrl)) {
    const sep = imageUrl.includes('?') ? '&' : '?'
    // AVIF-typed so the candidate matches what <OptimizedImage>'s <picture>
    // selects (its AVIF source). Browsers without AVIF skip this preload and
    // fall through to the picture's webp/jpg source — no wasted bytes.
    return {
      tagName: 'link',
      rel: 'preload',
      as: 'image',
      type: 'image/avif',
      href: `${imageUrl}${sep}width=${fallbackWidth}&format=avif`,
      imagesrcset: widths.map((w) => `${imageUrl}${sep}width=${w}&format=avif ${w}w`).join(', '),
      imagesizes: sizes,
      fetchpriority: 'high',
    }
  }

  if (isSanityCdn(imageUrl)) {
    // Sanity negotiates AVIF/WebP via `auto=format` on a single srcset, so the
    // preload is untyped and reuses the exact URLs OptimizedImage renders.
    return {
      tagName: 'link',
      rel: 'preload',
      as: 'image',
      href: sanityImageUrl(imageUrl, { w: fallbackWidth }),
      imagesrcset: sanityImageSrcSet(imageUrl, widths),
      imagesizes: sizes,
      fetchpriority: 'high',
    }
  }

  // Static /public assets and unknown hosts: plain preload of the URL as-is.
  return {
    tagName: 'link',
    rel: 'preload',
    as: 'image',
    href: imageUrl,
    fetchpriority: 'high',
  }
}
