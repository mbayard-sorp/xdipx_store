import { useEffect, useRef, useState } from 'react'
import { shopifyImageSrcSet, shopifyImageUrl } from '~/lib/shopify-image'

// These tiles render ~208 CSS px square inside the curated rails and the Emma
// context row, so ~416 device px at 2x. The old hardcoded width=480 asked the
// CDN for a size no tile ever displays; Shopify also only negotiates AVIF for
// the smaller renditions, so the oversized request came back as WebP at 3-4x
// the bytes. Keep the ladder tight around the real box.
const TILE_WIDTHS = [208, 260, 320, 416, 520]
const TILE_SIZES = '(min-width: 640px) 240px, 55vw'

interface ProductTileMediaProps {
  imageUrl: string
  imageAlt: string
  video?: { previewUrl: string; src: string } | null
}

export default function ProductTileMedia({ imageUrl, imageAlt, video }: ProductTileMediaProps) {
  const [hovered, setHovered] = useState(false)
  // Latches on first hover and never resets, so the <video> element is created
  // once and kept — flipping it out on mouse-leave would re-fetch the poster
  // on every pass.
  const [hasHovered, setHasHovered] = useState(false)
  const [canAutoplay, setCanAutoplay] = useState(true)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setCanAutoplay(!mq.matches)
    const onChange = (e: MediaQueryListEvent) => setCanAutoplay(!e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (hovered && canAutoplay) {
      el.play().catch(() => {})
    } else {
      el.pause()
      el.currentTime = 0
    }
  }, [hovered, canAutoplay])

  const showVideo = !!video && hovered && canAutoplay

  return (
    <div
      className="absolute inset-0"
      onMouseEnter={() => {
        setHovered(true)
        setHasHovered(true)
      }}
      onMouseLeave={() => setHovered(false)}
    >
      <img
        src={shopifyImageUrl(imageUrl, 320)}
        srcSet={shopifyImageSrcSet(imageUrl, TILE_WIDTHS)}
        sizes={TILE_SIZES}
        alt={imageAlt}
        width={416}
        height={416}
        loading="lazy"
        decoding="async"
        className={`w-full h-full object-cover transition-opacity duration-200 ${
          showVideo ? 'opacity-0' : 'opacity-100'
        }`}
      />
      {/* Mounted only once the pointer has actually entered the tile. <video>
          has no loading="lazy", so rendering it up front made every tile fetch
          its poster and — because src is an HLS .m3u8 with preload="metadata"
          — walk the manifest tree for three more requests, all during page
          load, for a hover affordance most visitors never trigger. The rails
          sit several viewports down, so this was pure critical-path tax: the
          unsized poster alone measured 89,670 bytes (vs 10,414 at width=416).
          hasHovered latches so the video is not torn down on mouse-out. */}
      {video && canAutoplay && hasHovered && (
        <video
          ref={videoRef}
          src={video.src}
          poster={shopifyImageUrl(video.previewUrl, 416)}
          muted
          playsInline
          loop
          preload="none"
          aria-hidden="true"
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
            showVideo ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  )
}
