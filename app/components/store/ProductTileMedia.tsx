import { useEffect, useRef, useState } from 'react'
import { shopifyImageUrl } from '~/lib/shopify-image'

interface ProductTileMediaProps {
  imageUrl: string
  imageAlt: string
  video?: { previewUrl: string; src: string } | null
}

export default function ProductTileMedia({ imageUrl, imageAlt, video }: ProductTileMediaProps) {
  const [hovered, setHovered] = useState(false)
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
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <img
        src={shopifyImageUrl(imageUrl, 480)}
        alt={imageAlt}
        width={800}
        height={800}
        loading="lazy"
        decoding="async"
        className={`w-full h-full object-cover transition-opacity duration-200 ${
          showVideo ? 'opacity-0' : 'opacity-100'
        }`}
      />
      {video && canAutoplay && (
        <video
          ref={videoRef}
          src={video.src}
          poster={video.previewUrl}
          muted
          playsInline
          loop
          preload="metadata"
          aria-hidden="true"
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${
            showVideo ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  )
}
