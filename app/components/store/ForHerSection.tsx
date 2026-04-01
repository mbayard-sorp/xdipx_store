import { Link } from 'react-router'
import type { Product } from '~/types'

interface ForHerSectionProps {
  products: Product[]
}

export function ForHerSection({ products }: ForHerSectionProps) {
  if (!products.length) return null

  return (
    <section className="py-12 px-4 bg-brand-mist">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2
              className="text-2xl font-bold text-brand-charcoal"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Made for her. Obviously. ♥
            </h2>
            <p className="text-brand-charcoal/50 text-sm">The good stuff, curated.</p>
          </div>
          <Link
            to="/for-her"
            className="text-sm font-semibold text-brand-purple hover:text-brand-purple-light transition-colors hidden sm:block"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            See all →
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {products.map(product => (
            <Link to={`/products/${product.handle}`} key={product.id} className="group">
              <article className="bg-white rounded-2xl overflow-hidden shadow-sm card-lift">
                <div className="aspect-square bg-brand-cream overflow-hidden">
                  {product.images[0] ? (
                    <img
                      src={product.images[0].url}
                      alt={product.images[0].altText || product.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-brand-charcoal/10 text-4xl">♥</div>
                  )}
                </div>
                <div className="p-4">
                  <p className="text-brand-charcoal/50 text-xs">{product.brand}</p>
                  <p
                    className="font-semibold text-brand-charcoal text-sm mt-0.5 line-clamp-2"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {product.title}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-brand-gradient font-bold text-sm">${product.price.toFixed(2)}</span>
                    {product.compareAtPrice && product.compareAtPrice > product.price && (
                      <span className="text-brand-charcoal/40 text-xs line-through">${product.compareAtPrice.toFixed(2)}</span>
                    )}
                  </div>
                </div>
              </article>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
