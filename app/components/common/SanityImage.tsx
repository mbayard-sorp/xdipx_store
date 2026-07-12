import { sanityImageUrl, sanityImageSrcSet, SANITY_IMAGE_WIDTHS } from '~/lib/sanity-image'

interface SanityImageProps {
  src: string
  alt: string
  /**
   * Above-the-fold LCP image. true → loading="eager" + fetchPriority="high".
   * false (default) → loading="lazy" + decoding="async".
   */
  priority?: boolean
  /** Responsive `sizes` attribute — override per layout (hero, card, thumb). */
  sizes?: string
  className?: string
  /** Intrinsic dimensions from Sanity asset metadata, for CLS reservation. */
  width?: number
  height?: number
  /** Candidate widths for the srcset. */
  widths?: number[]
  /** Single-URL fallback width for the <img src>. */
  fallbackWidth?: number
  /** Base64 LQIP from asset metadata — painted behind the image as a blur-up. */
  lqip?: string
}

/**
 * Responsive Sanity CDN image, sibling of the Shopify OptimizedImage. Emits a
 * width srcset with `auto=format` (CDN negotiates AVIF/WebP), an LQIP blur-up
 * background, and explicit intrinsic dimensions. Non-Sanity URLs pass through
 * untouched. SSR-safe — no browser-only APIs.
 */
export function SanityImage({
  src,
  alt,
  priority = false,
  sizes = '(max-width: 768px) 100vw, 50vw',
  className,
  width,
  height,
  widths = SANITY_IMAGE_WIDTHS,
  fallbackWidth = 1200,
  lqip,
}: SanityImageProps) {
  const srcSet = sanityImageSrcSet(src, widths)
  return (
    <img
      src={sanityImageUrl(src, { w: fallbackWidth })}
      {...(srcSet ? { srcSet, sizes } : {})}
      alt={alt}
      {...(width != null ? { width } : {})}
      {...(height != null ? { height } : {})}
      {...(className ? { className } : {})}
      {...(lqip
        ? { style: { backgroundImage: `url(${lqip})`, backgroundSize: 'cover' } }
        : {})}
      loading={priority ? 'eager' : 'lazy'}
      {...(priority ? { fetchPriority: 'high' as const } : { decoding: 'async' as const })}
    />
  )
}
