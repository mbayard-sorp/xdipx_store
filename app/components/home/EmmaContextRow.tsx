/**
 * Emma context row — a contextual product rail under the hero deal, driven
 * by an admin-authored group brief and personalized per visitor via a
 * session-seeded shuffle of the precomputed pool.
 *
 * Shape mirrors ProductCarousel but each card carries Emma's first-person
 * "pairingWhy" aside instead of a generic blurb.
 */
import { useRef } from 'react'
import { Link } from 'react-router'
import type { RenderRow } from '~/lib/emma-rails.server'
import ProductTileMedia from '~/components/store/ProductTileMedia'

interface EmmaContextRowProps {
  row: RenderRow
}

const KIND_EYEBROW: Record<RenderRow['rail']['kind'], string> = {
  pairing:     "Emma's pairing",
  alternative: "Not for you? Emma suggests",
  adjacent:    "Same vibe",
}

export function EmmaContextRow({ row }: EmmaContextRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  if (!row.picks.length) return null

  const eyebrow = KIND_EYEBROW[row.rail.kind]

  function scroll(dir: 'left' | 'right') {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir === 'left' ? -280 : 280, behavior: 'smooth' })
  }

  return (
    <section className="py-10 px-4 bg-cream">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-end justify-between mb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-1 text-sage">
              {eyebrow}
            </p>
            <h2
              className="text-2xl font-bold text-ink"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {row.rail.name}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => scroll('left')}
              aria-label="Scroll left"
              className="hidden sm:flex items-center justify-center w-9 h-9 rounded-full border transition-colors shadow-sm border-cream-2 bg-white text-ink hover:border-sage hover:text-sage"
            >←</button>
            <button
              onClick={() => scroll('right')}
              aria-label="Scroll right"
              className="hidden sm:flex items-center justify-center w-9 h-9 rounded-full border transition-colors shadow-sm border-cream-2 bg-white text-ink hover:border-sage hover:text-sage"
            >→</button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-2"
        >
          {row.picks.map(({ product, pairingWhy }) => (
            <EmmaCard key={product.id} product={product} pairingWhy={pairingWhy} />
          ))}
        </div>
      </div>
    </section>
  )
}

function EmmaCard({
  product,
  pairingWhy,
}: {
  product: RenderRow['picks'][number]['product']
  pairingWhy: string
}) {
  const price   = product.price
  const compare = product.compareAtPrice
  const onSale  = compare != null && compare > price
  const firstImage = product.images[0]
  const firstVideo = product.videos?.[0]
  const videoSrc = firstVideo?.sources?.[0]?.url
  const video = firstVideo && videoSrc
    ? { previewUrl: firstVideo.previewImageUrl, src: videoSrc }
    : null

  return (
    <Link
      to={`/products/${product.handle}`}
      className="group shrink-0 w-60 sm:w-64 snap-start"
    >
      <article className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg hover:shadow-sage/10 transition-all duration-300 card-lift h-full flex flex-col">
        <div className="relative aspect-square bg-cream-2 overflow-hidden">
          {firstImage ? (
            <ProductTileMedia
              imageUrl={firstImage.url}
              imageAlt={firstImage.altText || product.title}
              video={video}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink/10 text-4xl">♥</div>
          )}
          {onSale && (
            <span className="absolute top-2 left-2 bg-coral text-white text-xs font-bold px-2 py-0.5 rounded-full z-10">
              SALE
            </span>
          )}
        </div>
        <div className="p-4 flex-1 flex flex-col">
          <p className="text-ink-3 text-xs">{product.brand}</p>
          <p
            className="font-semibold text-ink text-sm mt-0.5 line-clamp-2 group-hover:text-coral transition-colors"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {product.title}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-coral font-bold text-sm">${price.toFixed(2)}</span>
            {onSale && (
              <span className="text-ink-3 text-xs line-through">${compare!.toFixed(2)}</span>
            )}
          </div>
          {pairingWhy && (
            <p className="mt-3 text-xs leading-relaxed text-ink/70 italic border-t border-line pt-2">
              <span className="text-sage mr-1">♥</span>
              {pairingWhy}
            </p>
          )}
        </div>
      </article>
    </Link>
  )
}
