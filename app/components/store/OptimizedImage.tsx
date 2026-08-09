import {
  isShopifyCdn,
  shopifyImageUrl,
  shopifyImageSrcSet,
} from '~/lib/shopify-image'
import { isSanityCdn, sanityImageUrl, sanityImageSrcSet } from '~/lib/sanity-image'

// Matches the hero-preload srcset widths in the homepage + PDP meta() helpers
// so a preloaded candidate is an exact cache hit for what the <img> srcset picks.
// KEEP IN SYNC with PRELOAD_WIDTHS in ~/lib/image-preload — a candidate the
// <img> can pick but the preload can't (or vice versa) turns the preloaded
// LCP hero into a second, uncredited fetch.
// 640 sits between 480 and 768 for the throttled-mobile LCP case (ticket #603):
// the storefront hero fills ~100vw, so a 412px-CSS mobile viewport at DPR ~1.5-1.75
// needs ~620-720 device px. Without 640 the browser rounds UP to 768w and ships
// an oversized hero over slow 4G; 640w is the right-sized candidate and shaves
// the hero's bytes on exactly the surface the mobile LCP budget measures. Larger
// (1024/1600) still cover high-DPR phones and desktop unchanged.
const DEFAULT_WIDTHS = [480, 640, 768, 1024, 1600]

interface OptimizedImageProps {
  src: string
  alt: string
  /**
   * Above-the-fold LCP image. true → loading="eager" + fetchPriority="high".
   * false (default) → loading="lazy" + decoding="async".
   */
  priority?: boolean
  /**
   * Responsive `sizes` attribute. Default assumes full-width on mobile and
   * roughly half-width on desktop — override per layout (hero, card, thumb).
   */
  sizes?: string
  className?: string
  /** Intrinsic dimensions for CLS reservation when the image is in normal flow. */
  width?: number
  height?: number
  /** Candidate widths for the srcset. */
  widths?: number[]
  /** Single-URL fallback width for the <img src>. */
  fallbackWidth?: number
  draggable?: boolean
}

/**
 * Shared responsive image, multi-vendor by design: Shopify CDN for product
 * photography, Sanity CDN for editorial/generated art. All vendor-specific URL
 * logic stays in ~/lib/shopify-image and ~/lib/sanity-image (the Oxygen
 * migration swaps those, not this component).
 *
 * Shopify URLs emit a single width-based srcset and let the Shopify CDN
 * negotiate AVIF/WebP via the Accept header, so mobile never pays for a 1200px+
 * hero asset and modern formats need no <source> pair (a `&format=` param is
 * inert on the Shopify CDN. It negotiates purely from Accept, so the old
 * <picture>/<source> split only tripled distinct CDN URLs and fragmented cache
 * for zero benefit). Sanity URLs emit a width srcset with `auto=format`, the
 * same Accept-header negotiation. Other URLs (static /public assets) render a
 * plain <img> unchanged. SSR-safe, with no .client suffix and no browser-only
 * APIs.
 */
export function OptimizedImage({
  src,
  alt,
  priority = false,
  sizes = '(max-width: 768px) 100vw, 50vw',
  className,
  width,
  height,
  widths = DEFAULT_WIDTHS,
  fallbackWidth = 1024,
  draggable,
}: OptimizedImageProps) {
  const shopify = isShopifyCdn(src)
  const sanity = !shopify && isSanityCdn(src)

  const fallbackSrc = shopify
    ? shopifyImageUrl(src, fallbackWidth)
    : sanity
      ? sanityImageUrl(src, { w: fallbackWidth })
      : src
  const srcSet = shopify
    ? shopifyImageSrcSet(src, widths)
    : sanity
      ? sanityImageSrcSet(src, widths)
      : undefined

  const img = (
    <img
      src={fallbackSrc}
      {...(srcSet ? { srcSet, sizes } : {})}
      alt={alt}
      {...(width != null ? { width } : {})}
      {...(height != null ? { height } : {})}
      {...(className ? { className } : {})}
      loading={priority ? 'eager' : 'lazy'}
      {...(priority ? { fetchPriority: 'high' as const } : { decoding: 'async' as const })}
      {...(draggable != null ? { draggable } : {})}
    />
  )

  // Shopify, Sanity, and static assets all render the same plain <img>: the
  // width srcset plus Accept-header format negotiation is the whole story, so
  // there is no <picture>/<source> split to add.
  return img
}
