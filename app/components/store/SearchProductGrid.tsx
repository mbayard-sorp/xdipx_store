import { useEffect, useRef, useState } from 'react'
import { Link, useFetcher } from 'react-router'
import type { SearchProductResult } from '~/lib/search.server'
import ProductTileMedia from '~/components/store/ProductTileMedia'
import LiveDealBadge from '~/components/store/LiveDealBadge'

export function InfiniteProductGrid({
  initialProducts,
  initialPage,
  initialHasNextPage,
  liveDealHandle,
  starred = {},
  basePath = '/search',
}: {
  initialProducts: SearchProductResult[]
  initialPage: number
  initialHasNextPage: boolean
  liveDealHandle: string | null
  starred?: Record<string, string>
  basePath?: string
}) {
  const fetcher = useFetcher<{ searchResult: { products: SearchProductResult[]; hasNextPage: boolean } }>()
  const [items, setItems] = useState<SearchProductResult[]>(initialProducts)
  const [page, setPage] = useState(initialPage)
  const [hasNext, setHasNext] = useState(initialHasNextPage)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setItems(initialProducts)
    setPage(initialPage)
    setHasNext(initialHasNextPage)
  }, [initialProducts, initialPage, initialHasNextPage])

  useEffect(() => {
    if (fetcher.state !== 'idle') return
    const data = fetcher.data
    if (!data?.searchResult) return
    const incoming = data.searchResult.products ?? []
    if (incoming.length === 0) { setHasNext(false); return }
    setItems(prev => {
      const seen = new Set(prev.map(p => p.handle))
      const merged = [...prev]
      for (const p of incoming) if (!seen.has(p.handle)) merged.push(p)
      return merged
    })
    setHasNext(data.searchResult.hasNextPage)
  }, [fetcher.state, fetcher.data])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasNext) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting && fetcher.state === 'idle') {
        const next = page + 1
        const params = new URLSearchParams(window.location.search)
        params.set('page', String(next))
        fetcher.load(`${basePath}?${params.toString()}`)
        setPage(next)
      }
    }, { rootMargin: '400px 0px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNext, page, fetcher, basePath])

  return (
    <>
      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-4 auto-rows-fr">
        {items.map(product => (
          <SearchTile
            key={product.handle}
            product={product}
            isLiveDeal={!!liveDealHandle && product.handle === liveDealHandle}
            {...(starred[product.handle] ? { starredReason: starred[product.handle]! } : {})}
          />
        ))}
      </ul>
      {hasNext && (
        <div ref={sentinelRef} className="mt-8 flex justify-center">
          <div className="text-xs text-ink/40">Loading more…</div>
        </div>
      )}
    </>
  )
}

export function SearchTile({
  product,
  isLiveDeal,
  starredReason,
}: {
  product: SearchProductResult
  isLiveDeal: boolean
  starredReason?: string
}) {
  const addToCart = useFetcher<{ ok?: boolean }>()
  const [justAdded, setJustAdded] = useState(false)
  const wasSubmitting = useRef(false)

  useEffect(() => {
    if (addToCart.state === 'submitting') wasSubmitting.current = true
    else if (addToCart.state === 'idle' && wasSubmitting.current) {
      wasSubmitting.current = false
      if (addToCart.data?.ok) {
        setJustAdded(true)
        window.dispatchEvent(new CustomEvent('xdipx:cart-added'))
        const t = setTimeout(() => setJustAdded(false), 1200)
        return () => clearTimeout(t)
      }
    }
  }, [addToCart.state, addToCart.data])

  const price = product.price ? parseFloat(product.price) : null
  const compareAt = product.compareAtPrice ? parseFloat(product.compareAtPrice) : null
  const discount = price && compareAt && compareAt > price
    ? Math.round(((compareAt - price) / compareAt) * 100)
    : 0

  const canAtc = product.availableForSale && !product.hasMultipleVariants && !!product.defaultVariantId
  const video = product.firstVideo
    ? { previewUrl: product.firstVideo.previewUrl, src: product.firstVideo.src }
    : null

  function handleAtcClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (!canAtc) return
    e.preventDefault()
    e.stopPropagation()
    if (!product.defaultVariantId) return
    const form = new FormData()
    form.set('intent', 'add-item')
    form.set('variantId', product.defaultVariantId)
    form.set('quantity', '1')
    addToCart.submit(form, { method: 'post', action: '/api/cart' })
  }

  return (
    <li className="h-full">
      <Link
        to={`/products/${product.handle}`}
        className="group flex flex-col h-full bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
      >
        <div className="aspect-square overflow-hidden bg-cream-2 relative">
          {product.featuredImage ? (
            <ProductTileMedia
              imageUrl={product.featuredImage.url}
              imageAlt={product.featuredImage.altText ?? product.title}
              video={video}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink/10 text-5xl">♥</div>
          )}
          {discount >= 10 && (
            <span className="absolute top-2 left-2 z-10 bg-sage text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {discount}% off
            </span>
          )}
          {starredReason && !isLiveDeal && (
            <div className="absolute top-2 right-2 z-10 group/starred">
              <span
                className="inline-flex items-center gap-1 bg-coral text-paper text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm"
                style={{ fontFamily: 'var(--font-display)' }}
                aria-label={`Emma's pick: ${starredReason}`}
              >
                ★ Emma
              </span>
              <span
                className="hidden group-hover/starred:block absolute top-full right-0 mt-1 w-44 p-2 rounded-md bg-ink text-paper text-[11px] leading-snug shadow-lg z-20"
                role="tooltip"
              >
                {starredReason}
              </span>
            </div>
          )}
          {isLiveDeal && <LiveDealBadge />}

          <button
            type="button"
            onClick={handleAtcClick}
            disabled={addToCart.state !== 'idle'}
            aria-label={canAtc ? `Add ${product.title} to cart` : `View ${product.title}`}
            className={`absolute bottom-2 right-2 z-10 inline-flex items-center gap-1.5 rounded-full pl-2.5 pr-3 py-1.5 text-white text-xs font-bold shadow-md transition-all ${
              justAdded ? 'bg-sage scale-105' : 'bg-coral hover:bg-coral/90 hover:scale-105'
            } ${addToCart.state !== 'idle' ? 'opacity-70' : ''}`}
          >
            {justAdded ? (
              <>
                <span aria-hidden="true">♥</span>
                <span>Added</span>
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <path d="M16 10a4 4 0 01-8 0" />
                </svg>
                <span>+ Add</span>
              </>
            )}
          </button>
        </div>
        <div className="p-3 flex flex-col flex-1">
          <p className="text-xs text-ink/50 truncate">{product.vendor}</p>
          <h3
            className="text-sm font-semibold text-ink line-clamp-2 group-hover:text-coral transition-colors mt-0.5 min-h-[2.5rem]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {product.title}
          </h3>
          <div className="flex items-center gap-2 mt-auto pt-2">
            {price != null && (
              <span className="text-sm font-bold text-coral">${price.toFixed(2)}</span>
            )}
            {compareAt != null && price != null && compareAt > price && (
              <span className="text-xs text-ink/40 line-through">${compareAt.toFixed(2)}</span>
            )}
          </div>
        </div>
      </Link>
    </li>
  )
}
