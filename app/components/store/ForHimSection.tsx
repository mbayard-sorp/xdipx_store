import { Link } from 'react-router'
import type { Product } from '~/types'

interface ForHimSectionProps {
  products: Product[]
}

export function ForHimSection({ products }: ForHimSectionProps) {
  if (!products.length) return null

  return (
    <section className="py-12 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2
              className="text-2xl font-bold text-brand-charcoal"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Dialed in. Just for him. ♥
            </h2>
            <p className="text-brand-charcoal/50 text-sm">Hand-picked for the gentleman's drawer.</p>
          </div>
          <Link
            to="/for-him"
            className="text-sm font-semibold text-brand-purple hover:text-brand-purple-light transition-colors hidden sm:block"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            See all →
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {products.map(product => (
            <ProductMiniCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </section>
  )
}

function ProductMiniCard({ product }: { product: Product }) {
  const price   = product.price
  const compare = product.compareAtPrice

  return (
    <Link to={`/products/${product.handle}`} className="group">
      <article className="bg-white rounded-2xl overflow-hidden shadow-sm card-lift">
        <div className="aspect-square bg-brand-mist overflow-hidden">
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
            <span className="text-brand-gradient font-bold text-sm">${price.toFixed(2)}</span>
            {compare && compare > price && (
              <span className="text-brand-charcoal/40 text-xs line-through">${compare.toFixed(2)}</span>
            )}
          </div>
        </div>
      </article>
    </Link>
  )
}
