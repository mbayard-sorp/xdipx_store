// LCP hero preload tag builder, CDN-aware. The contract that matters: the
// preload's href/imagesrcset must be byte-identical to the candidate URLs
// <OptimizedImage> renders for the same source, or the browser preloads one
// URL and then fetches another (a silent LCP regression, not a win).
// Isomorphic — meta() runs on both server and client.

import { isShopifyCdn, shopifyImageUrl, shopifyImageSrcSet } from '~/lib/shopify-image'
import { isSanityCdn, sanityImageUrl, sanityImageSrcSet } from '~/lib/sanity-image'

// Same widths as OptimizedImage's DEFAULT_WIDTHS — KEEP THE TWO LISTS IDENTICAL.
// The preload's imagesrcset must offer the exact candidate the <img> srcset will
// pick (see the DEFAULT_WIDTHS note there); 640 is the throttled-mobile right-size
// for the ~100vw storefront hero (ticket #603).
const PRELOAD_WIDTHS = [480, 640, 768, 1024, 1600]
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
    // OptimizedImage renders a plain width-srcset <img> for Shopify and lets the
    // CDN negotiate AVIF/WebP via the Accept header (a `&format=` param is inert
    // on the Shopify CDN). So the preload is untyped and reuses the exact width
    // URLs OptimizedImage renders, an exact cache hit whatever format the
    // browser negotiates. Built from the same helpers to guarantee byte-identity.
    const imagesrcset = shopifyImageSrcSet(imageUrl, widths)
    return {
      tagName: 'link',
      rel: 'preload',
      as: 'image',
      href: shopifyImageUrl(imageUrl, fallbackWidth),
      ...(imagesrcset ? { imagesrcset } : {}),
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
