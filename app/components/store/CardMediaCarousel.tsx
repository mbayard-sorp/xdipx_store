import { useRef, useState } from 'react'
import type { HeroVideo, ProductImage } from '~/types'
import { CardVideo } from './CardVideo'
import { shopifyImageUrl, shopifyImageSrcSet } from '~/lib/shopify-image'

interface CardMediaCarouselProps {
  cardId:    string
  title:     string
  heroVideo?: HeroVideo
  images:    ProductImage[]
}

export function CardMediaCarousel({ cardId, title, heroVideo, images }: CardMediaCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [activeIdx, setActiveIdx] = useState(0)

  const slides: Array<
    | { kind: 'video'; video: HeroVideo }
    | { kind: 'image'; image: ProductImage }
  > = []
  if (heroVideo?.src) slides.push({ kind: 'video', video: heroVideo })
  for (const img of images) slides.push({ kind: 'image', image: img })

  if (slides.length === 0) {
    return <div className="w-full h-full flex items-center justify-center text-ink/10 text-5xl">♥</div>
  }

  function handleScroll() {
    const el = trackRef.current
    if (!el) return
    const idx = Math.round(el.scrollLeft / el.clientWidth)
    if (idx !== activeIdx) setActiveIdx(idx)
  }

  return (
    <>
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="absolute inset-0 flex overflow-x-auto snap-x snap-mandatory scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide, i) => (
          <div
            key={i}
            className="relative w-full h-full shrink-0 snap-start"
          >
            {slide.kind === 'video' ? (
              <CardVideo cardId={cardId} video={slide.video} title={title} />
            ) : (
              <img
                src={shopifyImageUrl(slide.image.url, 480) || slide.image.url}
                srcSet={shopifyImageSrcSet(slide.image.url, [240, 360, 480, 720])}
                sizes="(min-width: 768px) 25vw, 50vw"
                alt={slide.image.altText || title}
                className="w-full h-full object-cover"
                loading={i === 0 ? 'eager' : 'lazy'}
                decoding="async"
                draggable={false}
              />
            )}
          </div>
        ))}
      </div>

      {slides.length > 1 && (
        <div
          aria-hidden="true"
          className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/30 backdrop-blur-sm pointer-events-none"
        >
          {slides.map((_, i) => (
            <span
              key={i}
              className={`block rounded-full transition-all duration-200 ${
                i === activeIdx ? 'w-2 h-2 bg-white' : 'w-1.5 h-1.5 bg-white/60'
              }`}
            />
          ))}
        </div>
      )}
    </>
  )
}
