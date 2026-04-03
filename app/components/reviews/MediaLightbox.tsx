import { useState, useEffect, useCallback } from 'react'
import type { ReviewMedia } from '~/types/reviews'

interface MediaLightboxProps {
  media: ReviewMedia[]
  initialIndex?: number
  onClose: () => void
}

export function MediaLightbox({ media, initialIndex = 0, onClose }: MediaLightboxProps) {
  const [index, setIndex] = useState(initialIndex)

  const current = media[index]

  const prev = useCallback(() => setIndex(i => (i - 1 + media.length) % media.length), [media.length])
  const next = useCallback(() => setIndex(i => (i + 1) % media.length), [media.length])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape')     onClose()
      if (e.key === 'ArrowLeft')  prev()
      if (e.key === 'ArrowRight') next()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, prev, next])

  if (!current) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Media lightbox"
    >
      <div
        className="relative max-w-3xl w-full mx-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white/70 hover:text-white text-2xl leading-none"
          aria-label="Close lightbox"
        >
          ×
        </button>

        {/* Media */}
        <div className="rounded-2xl overflow-hidden bg-black flex items-center justify-center min-h-64 max-h-[80vh]">
          {current.mediaType === 'image' ? (
            <img
              src={current.url}
              alt={`Review media ${index + 1}`}
              className="max-w-full max-h-[80vh] object-contain"
            />
          ) : (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              src={current.url}
              controls
              className="max-w-full max-h-[80vh]"
            />
          )}
        </div>

        {/* Navigation */}
        {media.length > 1 && (
          <>
            <button
              onClick={prev}
              className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/70 transition-colors"
              aria-label="Previous media"
            >
              ‹
            </button>
            <button
              onClick={next}
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/70 transition-colors"
              aria-label="Next media"
            >
              ›
            </button>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
              {media.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setIndex(i)}
                  className={[
                    'w-1.5 h-1.5 rounded-full transition-colors',
                    i === index ? 'bg-white' : 'bg-white/40',
                  ].join(' ')}
                  aria-label={`Go to media ${i + 1}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
