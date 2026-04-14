import { Link } from 'react-router'

type FbtProduct = {
  handle: string
  title: string
  image: string | null
  price: number
  compareAtPrice: number | null
}

interface FrequentlyBoughtWithProps {
  products: FbtProduct[]
}

export default function FrequentlyBoughtWith({ products }: FrequentlyBoughtWithProps) {
  if (products.length === 0) return null

  return (
    <section className="mt-12 mb-6">
      <h2 className="font-display text-2xl font-bold text-brand-charcoal mb-4">Frequently bought with</h2>
      <ul className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {products.map(p => (
          <li key={p.handle}>
            <Link to={`/products/${p.handle}`} className="block group">
              <div className="aspect-square rounded-xl overflow-hidden bg-brand-mist">
                {p.image ? (
                  <img
                    src={p.image}
                    alt={p.title}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-brand-charcoal/10 text-4xl">♥</div>
                )}
              </div>
              <h3 className="mt-2 text-sm font-medium text-brand-charcoal line-clamp-2 group-hover:text-brand-coral transition-colors">
                {p.title}
              </h3>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-brand-gradient font-bold text-sm">${p.price.toFixed(2)}</span>
                {p.compareAtPrice && p.compareAtPrice > p.price && (
                  <span className="text-brand-charcoal/40 text-xs line-through">${p.compareAtPrice.toFixed(2)}</span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
