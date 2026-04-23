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
  const compareTotal = items.reduce((sum, it) => sum + (it.compareAtPrice ?? it.price), 0)
  const savings = compareTotal - total

  return (
    <section className="mt-12 mb-6">
      <header className="mb-4 flex items-baseline justify-between gap-3 border-b border-line pb-3">
        <h2
          className="text-[18px] md:text-[20px] font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Pairs great with
        </h2>
        <span className="text-[11px] uppercase tracking-wide text-muted font-mono">
          Emma-curated · why each, in her words
        </span>
      </header>

      <ul className="flex flex-col gap-3">
        {items.slice(0, 3).map(item => (
          <PairCard key={item.handle} item={item} />
        ))}
      </ul>

      {items.length > 1 && (
        <div className="mt-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-coral-soft rounded-[var(--radius-lg)] px-5 py-4">
          <div className="flex-1 min-w-0">
            <p
              className="text-base font-bold text-ink italic"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Grab the pairing →
            </p>
            <p className="text-[13px] text-muted mt-0.5">
              {savings > 0
                ? <>Save ${savings.toFixed(2)} when you take all {items.length} home together.</>
                : <>Everything Emma reaches for alongside this one.</>}
            </p>
          </div>
          <button
            type="button"
            onClick={addAll}
            disabled={adding}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-coral hover:bg-coral-deep text-white text-sm font-bold px-5 py-3 rounded-full transition-colors disabled:opacity-60 whitespace-nowrap"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {adding ? 'Adding…' : `Add all ${items.length} · $${total.toFixed(2)}`}
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
    formData.set('intent',    'add')
    formData.set('variantId', item.variantId)
    formData.set('quantity',  '1')
    fetcher.submit(formData, { method: 'post', action: '/api/cart' })
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('xdipx:cart-added'))
    }
  }

  return (
    <li className="bg-paper border border-line rounded-[var(--radius-lg)] p-3 md:p-4 flex items-stretch gap-3 md:gap-4">
      <Link
        to={`/products/${item.handle}`}
        className="block shrink-0 w-[72px] h-[72px] md:w-[80px] md:h-[80px] bg-cream-2 rounded-[var(--radius)] overflow-hidden"
      >
        {item.image ? (
          <img
            src={item.image}
            alt={item.title}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ink/10 text-2xl">♥</div>
        )}
      </Link>
      <div className="flex-1 min-w-0 flex flex-col">
        <Link to={`/products/${item.handle}`} className="block">
          <h3
            className="text-[15px] md:text-base font-bold text-ink hover:text-coral transition-colors line-clamp-1"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {item.title}
          </h3>
        </Link>
        {item.why && (
          <p className="text-[12.5px] md:text-[13px] leading-snug text-muted italic mt-1 line-clamp-2">
            "{item.why}"
          </p>
        )}
        <div className="mt-auto pt-2 flex items-baseline gap-2">
          <span className="text-coral font-bold text-[15px]">${item.price.toFixed(2)}</span>
          {item.compareAtPrice && item.compareAtPrice > item.price && (
            <span className="text-ink/40 text-[11px] line-through">${item.compareAtPrice.toFixed(2)}</span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={addOne}
        disabled={adding}
        className="self-center inline-flex items-center gap-1 text-[12px] font-bold text-coral hover:text-white hover:bg-coral border border-coral rounded-full px-3 py-1.5 transition-colors disabled:opacity-60 whitespace-nowrap"
        style={{ fontFamily: 'var(--font-display)' }}
        aria-label={`Add ${item.title} to cart`}
      >
        {adding ? '…' : '+ add'}
      </button>
    </li>
  )
}
