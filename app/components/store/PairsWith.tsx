import { Link, useFetcher } from 'react-router'

export interface PairsWithItem {
  shopifyProductId: string
  handle:           string
  title:            string
  image:            string | null
  price:            number
  compareAtPrice:   number | null
  variantId:        string
  /** Emma's first-person "why" copy for this pairing. Optional. */
  why?:             string
}

interface PairsWithProps {
  items: PairsWithItem[]
  /** Combined bundle price (sum of dealPrices + accessories). Used by "Grab the pairing" CTA. */
  bundleTotal?: number
}

export function PairsWith({ items, bundleTotal }: PairsWithProps) {
  const fetcher = useFetcher()
  if (items.length === 0) return null
  const adding = fetcher.state !== 'idle'

  const addAll = () => {
    const formData = new FormData()
    formData.set('intent', 'addMany')
    items.forEach((it, i) => {
      formData.set(`variantId_${i}`,  it.variantId)
      formData.set(`quantity_${i}`,   '1')
    })
    fetcher.submit(formData, { method: 'post', action: '/api/cart' })
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('xdipx:cart-added'))
    }
  }

  const total = bundleTotal ?? items.reduce((sum, it) => sum + it.price, 0)

  return (
    <section className="mt-12 mb-6">
      <header className="mb-4">
        <h2
          className="text-2xl md:text-3xl font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Pairs great with
        </h2>
      </header>

      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.slice(0, 3).map(item => (
          <PairCard key={item.handle} item={item} />
        ))}
      </ul>

      {items.length > 1 && (
        <div className="mt-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-cream-2 rounded-[var(--radius-lg)] px-5 py-4">
          <div>
            <p
              className="text-sm font-bold text-ink"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Grab the pairing →
            </p>
            <p className="text-[13px] text-muted mt-0.5">
              All {items.length} in the cart · ${total.toFixed(2)}
            </p>
          </div>
          <button
            type="button"
            onClick={addAll}
            disabled={adding}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-coral hover:bg-coral-deep text-white text-sm font-bold px-5 py-3 rounded-full transition-colors disabled:opacity-60"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {adding ? 'Adding…' : 'Add all ♥'}
          </button>
        </div>
      )}
    </section>
  )
}

function PairCard({ item }: { item: PairsWithItem }) {
  const fetcher = useFetcher()
  const adding = fetcher.state !== 'idle'

  const addOne = (e: React.MouseEvent) => {
    e.preventDefault()
    const formData = new FormData()
    formData.set('intent',    'add-item')
    formData.set('variantId', item.variantId)
    formData.set('quantity',  '1')
    fetcher.submit(formData, { method: 'post', action: '/api/cart' })
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('xdipx:cart-added'))
    }
  }

  return (
    <li className="bg-paper border border-line rounded-[var(--radius-lg)] overflow-hidden flex flex-col">
      <Link to={`/products/${item.handle}`} className="block group">
        <div className="aspect-[4/5] bg-cream-2 overflow-hidden">
          {item.image ? (
            <img
              src={item.image}
              alt={item.title}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-200"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink/10 text-4xl">♥</div>
          )}
        </div>
      </Link>
      <div className="p-4 flex-1 flex flex-col gap-3">
        <Link to={`/products/${item.handle}`}>
          <h3
            className="text-base font-bold text-ink line-clamp-2 hover:text-coral transition-colors"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {item.title}
          </h3>
        </Link>
        {item.why && (
          <p className="text-[13px] leading-relaxed text-muted italic">
            "{item.why}"
          </p>
        )}
        <div className="mt-auto flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-coral font-bold text-base">${item.price.toFixed(2)}</span>
            {item.compareAtPrice && item.compareAtPrice > item.price && (
              <span className="text-ink/40 text-xs line-through">${item.compareAtPrice.toFixed(2)}</span>
            )}
          </div>
          <button
            type="button"
            onClick={addOne}
            disabled={adding}
            className="inline-flex items-center gap-1 text-xs font-bold text-coral hover:text-coral-deep border border-coral hover:border-coral-deep rounded-full px-3 py-1.5 transition-colors disabled:opacity-60"
            style={{ fontFamily: 'var(--font-display)' }}
            aria-label={`Add ${item.title} to cart`}
          >
            {adding ? '…' : '+ add'}
          </button>
        </div>
      </div>
    </li>
  )
}
