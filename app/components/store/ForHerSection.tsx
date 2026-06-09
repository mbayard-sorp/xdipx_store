import { Link } from 'react-router'
import type { Product } from '~/types'
import { shopifyImageUrl, shopifyImageSrcSet } from '~/lib/shopify-image'

interface ForHerSectionProps {
  products: Product[]
}

export function ForHerSection({ products }: ForHerSectionProps) {
  if (!products.length) return null

  return (
    <section className="py-12 px-4 bg-cream-2">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2
              className="text-2xl font-bold text-ink"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Made for her. Obviously. ♥
            </h2>
            <p className="text-ink/50 text-sm">The good stuff, curated.</p>
          </div>
          <Link
            to="/for-her"
            className="text-sm font-semibold text-sage hover:text-sun transition-colors hidden sm:block"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            See all →
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {products.map(product => (
            <Link to={`/products/${product.handle}`} key={product.id} className="group">
              <article className="bg-white rounded-2xl overflow-hidden shadow-sm card-lift">
                <div className="aspect-square bg-cream overflow-hidden">
                  {product.images[0] ? (
                    <img
                      src={shopifyImageUrl(product.images[0].url, 480)}
                      srcSet={shopifyImageSrcSet(product.images[0].url, [240, 480, 720]) ?? undefined}
                      sizes="(min-width: 768px) 25vw, 50vw"
                      alt={product.images[0].altText || product.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-ink/10 text-4xl">♥</div>
                  )}
                </div>
                <div className="p-4">
                  <p className="text-ink/50 text-xs">{product.brand}</p>
                  <p
                    className="font-semibold text-ink text-sm mt-0.5 line-clamp-2"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {product.title}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-coral font-bold text-sm">${product.price.toFixed(2)}</span>
                    {product.compareAtPrice && product.compareAtPrice > product.price && (
                      <span className="text-ink/40 text-xs line-through">${product.compareAtPrice.toFixed(2)}</span>
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
