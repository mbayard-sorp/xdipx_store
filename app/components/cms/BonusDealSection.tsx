import { Link } from 'react-router'
import type { BonusDealBlock } from '~/types/cms'
import type { Product } from '~/types'

interface BonusDealSectionProps {
  block: BonusDealBlock
  product: Product | null
}

export function BonusDealSection({ block, product }: BonusDealSectionProps) {
  if (!product) return null

  const variant = product.variants[0]
  const price   = product.price
  const compare = product.compareAtPrice
  const eyebrow = block.eyebrow || 'Bonus Deal'
  const heading = block.heading || 'Because one deal is never enough.'

  return (
    <section className="py-10 px-4 bg-ink">
      <div className="max-w-4xl mx-auto">
        <p
          className="text-sm uppercase tracking-widest text-center mb-2 text-white/50"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {eyebrow}
        </p>
        <h2
          className="text-xl font-bold text-white text-center mb-6"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {heading}
        </h2>

        <div className="flex flex-col sm:flex-row items-center gap-6 bg-white/5 rounded-2xl p-6">
          {product.images[0] && (
            <img
              src={product.images[0].url}
              alt={product.images[0].altText || product.title}
              className="w-28 h-28 object-cover rounded-xl shrink-0"
              loading="lazy"
            />
          )}

          <div className="flex-1 text-center sm:text-left">
            <p className="text-white/50 text-xs uppercase tracking-wide">{product.brand}</p>
            <h3
              className="text-white font-bold text-lg mt-0.5"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {product.title}
            </h3>
            <div className="flex items-center gap-2 justify-center sm:justify-start mt-2">
              <span className="text-coral-2 font-black text-2xl" style={{ fontFamily: 'var(--font-display)' }}>
                ${price.toFixed(2)}
              </span>
              {compare && compare > price && (
                <span className="text-white/40 line-through text-sm">${compare.toFixed(2)}</span>
              )}
            </div>
          </div>

          <Link
            to={`/products/${product.handle}`}
            className="bg-coral text-white font-bold px-6 py-3 rounded-full whitespace-nowrap transition-opacity hover:opacity-90 shrink-0"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {variant?.availableForSale !== false ? 'Grab It ♥' : 'View Deal'}
          </Link>
        </div>
      </div>
    </section>
  )
}
