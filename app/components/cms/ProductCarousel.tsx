import { useRef } from 'react'
import { Link } from 'react-router'
import type { Product } from '~/types'
import type { ProductCarouselBlock } from '~/types/cms'

interface ProductCarouselProps {
  block?: ProductCarouselBlock
  // Direct props for the hardcoded ForHim/ForHer sections
  heading?: string
  eyebrow?: string
  ctaLink?: string
  ctaLabel?: string
  bgStyle?: 'white' | 'mist' | 'cream'
  products: Product[]
}

export function ProductCarousel({
  block,
  heading: headingProp,
  eyebrow: eyebrowProp,
  ctaLink: ctaLinkProp,
  ctaLabel: ctaLabelProp,
  bgStyle: bgStyleProp,
  products,
}: ProductCarouselProps) {
  const heading  = block?.heading  ?? headingProp  ?? 'Products'
  const eyebrow  = block?.eyebrow  ?? eyebrowProp
  const ctaLink  = block?.ctaLink  ?? ctaLinkProp
  const ctaLabel = block?.ctaLabel ?? ctaLabelProp ?? 'See all →'
  const bgStyle  = block?.bgStyle  ?? bgStyleProp  ?? 'white'

  const scrollRef = useRef<HTMLDivElement>(null)

  if (!products.length) return null

  const bgClass = bgStyle === 'mist' ? 'bg-brand-mist' : bgStyle === 'cream' ? 'bg-brand-cream' : 'bg-white'

  function scroll(dir: 'left' | 'right') {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir === 'left' ? -280 : 280, behavior: 'smooth' })
  }

  return (
    <section className={`py-12 px-4 ${bgClass}`}>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-end justify-between mb-6">
          <div>
            {eyebrow && (
              <p className="text-brand-purple text-xs font-semibold uppercase tracking-widest mb-1">
                {eyebrow}
              </p>
            )}
            <h2
              className="text-2xl font-bold text-brand-charcoal"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {heading}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {/* Arrow buttons — desktop only */}
            <button
              onClick={() => scroll('left')}
              aria-label="Scroll left"
              className="hidden sm:flex items-center justify-center w-9 h-9 rounded-full border border-brand-mist bg-white text-brand-charcoal hover:border-brand-purple hover:text-brand-purple transition-colors shadow-sm"
            >
              ←
            </button>
            <button
              onClick={() => scroll('right')}
              aria-label="Scroll right"
              className="hidden sm:flex items-center justify-center w-9 h-9 rounded-full border border-brand-mist bg-white text-brand-charcoal hover:border-brand-purple hover:text-brand-purple transition-colors shadow-sm"
            >
              →
            </button>
            {ctaLink && (
              <Link
                to={ctaLink}
                className="text-sm font-semibold text-brand-purple hover:text-brand-purple-light transition-colors ml-1"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {ctaLabel}
              </Link>
            )}
          </div>
        </div>

        {/* Scroll container */}
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-2"
        >
          {products.map(product => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </section>
  )
}

function ProductCard({ product }: { product: Product }) {
  const price   = product.price
  const compare = product.compareAtPrice
  const onSale  = compare != null && compare > price

  return (
    <Link
      to={`/products/${product.handle}`}
      className="group shrink-0 w-52 sm:w-60 snap-start"
    >
      <article className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg hover:shadow-brand-purple/10 transition-all duration-300 card-lift h-full">
        <div className="relative aspect-square bg-brand-mist overflow-hidden">
          {product.images[0] ? (
            <img
              src={product.images[0].url}
              alt={product.images[0].altText || product.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-brand-charcoal/10 text-4xl">
              ♥
            </div>
          )}
          {onSale && (
            <span className="absolute top-2 left-2 bg-brand-gradient text-white text-xs font-bold px-2 py-0.5 rounded-full">
              SALE
            </span>
          )}
        </div>
        <div className="p-4">
          <p className="text-brand-charcoal/50 text-xs">{product.brand}</p>
          <p
            className="font-semibold text-brand-charcoal text-sm mt-0.5 line-clamp-2 group-hover:text-brand-coral transition-colors"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {product.title}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-brand-gradient font-bold text-sm">${price.toFixed(2)}</span>
            {onSale && (
              <span className="text-brand-charcoal/40 text-xs line-through">${compare!.toFixed(2)}</span>
            )}
          </div>
        </div>
      </article>
    </Link>
  )
}
