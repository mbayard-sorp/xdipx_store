import { useRef, useState } from 'react'
import type { HeroVideo, ProductImage } from '~/types'
import { CardVideo } from './CardVideo'
import { OptimizedImage } from './OptimizedImage'

interface CardMediaCarouselProps {
  cardId:    string
  title:     string
  heroVideo?: HeroVideo
  images:    ProductImage[]
  /**
   * The owning card is this page's LCP candidate, so its first slide loads
   * eagerly at fetchPriority=high. Defaults to false, and that default is the
   * whole point: a carousel knows which of ITS OWN slides is first, it cannot
   * know whether its card is the page's LCP. Only the grid rendering the cards
   * knows that, so only the grid may grant it, and it grants it to one card.
   *
   * This used to be decided here as `priority={i === 0}`, where `i` is the
   * slide index inside one card. Every card's first slide therefore rendered
   * `<img fetchPriority="high">`, and React DOM emits one
   * `<link rel="preload" as="image" fetchPriority="high">` per such image
   * during SSR, so a 24-card PLP shipped 24 high-priority image preloads that
   * all raced each other and the real LCP for the mobile connection. Measured
   * live 2026-11-11: /collections/pleasure 29, /collections/play 29,
   * /collections/wands 24, /collections/couples-vibrators 25 (1 masthead +
   * 24 cards), /new 25. Same defect class, same mechanism, as the homepage
   * grid's ticket #603, whose fix is written up in StorefrontHome.tsx.
   */
  priority?: boolean
}

export function CardMediaCarousel({ cardId, title, heroVideo, images, priority = false }: CardMediaCarouselProps) {
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
              <OptimizedImage
                src={slide.image.url}
                alt={slide.image.altText || title}
                className="w-full h-full object-cover"
                priority={priority && i === 0}
                sizes="(min-width: 768px) 25vw, 50vw"
                widths={[240, 360, 480, 720]}
                fallbackWidth={480}
                draggable={false}
              />
            )}
          </div>
        ))}
      </div>

      {slides.length > 1 && (
        <div
          aria-hidden="true"
          className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/30 backdrop-blur-sm pointer-events-none lg:hidden"
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
