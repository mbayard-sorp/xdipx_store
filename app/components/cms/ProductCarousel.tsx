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
  bgStyle?: 'white' | 'mist' | 'cream' | 'charcoal' | 'purple'
  layout?: 'carousel' | 'grid' | 'grid-3'
  products: Product[]
}

const BG_CLASSES: Record<string, string> = {
  white:    'bg-white',
  cream:    'bg-brand-cream',
  mist:     'bg-brand-mist',
  charcoal: 'bg-brand-charcoal',
  purple:   'bg-brand-purple',
}

function isDark(bg: string) {
  return bg === 'charcoal' || bg === 'purple'
}

export function ProductCarousel({
  block,
  heading: headingProp,
  eyebrow: eyebrowProp,
  ctaLink: ctaLinkProp,
  ctaLabel: ctaLabelProp,
  bgStyle: bgStyleProp,
  layout: layoutProp,
  products,
}: ProductCarouselProps) {
  const heading  = block?.heading  ?? headingProp  ?? 'Products'
  const eyebrow  = block?.eyebrow  ?? eyebrowProp
  const ctaLink  = block?.ctaLink  ?? ctaLinkProp
  const ctaLabel = block?.ctaLabel ?? ctaLabelProp ?? 'See all →'
  const bgStyle  = block?.bgStyle  ?? bgStyleProp  ?? 'white'
  const layout   = block?.layout   ?? layoutProp   ?? 'carousel'

  const scrollRef = useRef<HTMLDivElement>(null)

  if (!products.length) return null

  const bgClass = BG_CLASSES[bgStyle] ?? 'bg-white'
  const dark = isDark(bgStyle)

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
              <p className={`text-xs font-semibold uppercase tracking-widest mb-1 ${dark ? 'text-white/60' : 'text-brand-purple'}`}>
                {eyebrow}
              </p>
            )}
            <h2
              className={`text-2xl font-bold ${dark ? 'text-white' : 'text-brand-charcoal'}`}
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {heading}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {/* Arrow buttons — carousel only, desktop only */}
            {layout === 'carousel' && (
              <>
                <button
                  onClick={() => scroll('left')}
                  aria-label="Scroll left"
                  className={`hidden sm:flex items-center justify-center w-9 h-9 rounded-full border transition-colors shadow-sm ${
                    dark
                      ? 'border-white/20 bg-white/10 text-white hover:border-white/40 hover:text-white'
                      : 'border-brand-mist bg-white text-brand-charcoal hover:border-brand-purple hover:text-brand-purple'
                  }`}
                >
                  ←
                </button>
                <button
                  onClick={() => scroll('right')}
                  aria-label="Scroll right"
                  className={`hidden sm:flex items-center justify-center w-9 h-9 rounded-full border transition-colors shadow-sm ${
                    dark
                      ? 'border-white/20 bg-white/10 text-white hover:border-white/40 hover:text-white'
                      : 'border-brand-mist bg-white text-brand-charcoal hover:border-brand-purple hover:text-brand-purple'
                  }`}
                >
                  →
                </button>
              </>
            )}
            {ctaLink && (
              <Link
                to={ctaLink}
                className={`text-sm font-semibold transition-colors ml-1 ${
                  dark
                    ? 'text-white/80 hover:text-white'
                    : 'text-brand-purple hover:text-brand-purple-light'
                }`}
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {ctaLabel}
              </Link>
            )}
          </div>
        </div>

        {/* Product grid or carousel */}
        {layout === 'carousel' ? (
          <div
            ref={scrollRef}
            className="flex gap-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-2"
          >
            {products.map(product => (
              <ProductCard key={product.id} product={product} className="shrink-0 w-52 sm:w-60 snap-start" />
            ))}
          </div>
        ) : (
          <div
            className={
              layout === 'grid-3'
                ? 'grid grid-cols-2 md:grid-cols-3 gap-4'
                : 'grid grid-cols-2 md:grid-cols-4 gap-4'
            }
          >
            {products.map(product => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function ProductCard({ product, className = '' }: { product: Product; className?: string }) {
  const price   = product.price
  const compare = product.compareAtPrice
  const onSale  = compare != null && compare > price

  return (
    <Link
      to={`/products/${product.handle}`}
      className={`group ${className}`}
    >
      <article className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg hover:shadow-brand-purple/10 transition-all duration-300 card-lift h-full">
        <div className="relative aspect-square bg-brand-mist overflow-hidden">
          {product.images[0] ? (
            <img
              src={product.images[0].url}
              alt={product.images[0].altText || product.title}
              width={800}
              height={800}
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
