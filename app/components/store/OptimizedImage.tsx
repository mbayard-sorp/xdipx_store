import {
  isShopifyCdn,
  shopifyImageUrl,
  shopifyImageSrcSet,
  shopifyImageSrcSetFmt,
} from '~/lib/shopify-image'

// Matches the hero-preload srcset widths in the homepage + PDP meta() helpers
// so a preloaded AVIF candidate is an exact cache hit for what <picture> picks.
const DEFAULT_WIDTHS = [480, 768, 1024, 1600]

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
 * Shared responsive image. For Shopify CDN URLs it emits a <picture> with
 * AVIF + WebP sources, a width-based srcset, and a sized JPG/PNG fallback so
 * mobile never pays for a 1200px+ hero asset. Non-Shopify URLs (Imagen mood
 * images, discovery thumbnails) render a plain <img> unchanged. SSR-safe —
 * no .client suffix, no browser-only APIs.
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

  const img = (
    <img
      src={shopify ? shopifyImageUrl(src, fallbackWidth) : src}
      {...(shopify ? { srcSet: shopifyImageSrcSet(src, widths), sizes } : {})}
      alt={alt}
      {...(width != null ? { width } : {})}
      {...(height != null ? { height } : {})}
      {...(className ? { className } : {})}
      loading={priority ? 'eager' : 'lazy'}
      {...(priority ? { fetchPriority: 'high' as const } : { decoding: 'async' as const })}
      {...(draggable != null ? { draggable } : {})}
    />
  )

  if (!shopify) return img

  return (
    <picture>
      <source type="image/avif" srcSet={shopifyImageSrcSetFmt(src, 'avif', widths)} sizes={sizes} />
      <source type="image/webp" srcSet={shopifyImageSrcSetFmt(src, 'webp', widths)} sizes={sizes} />
      {img}
    </picture>
  )
}
