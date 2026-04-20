import { useState, useEffect, useRef, useCallback } from 'react'
import type { AdminProductSearchResult } from '~/lib/shopify.server'
import type { Product } from '~/types'

export interface PickerProduct {
  id: string
  title: string
  image: string | null
  price?: number
  compareAtPrice?: number
  inventoryQuantity?: number
  wholesaleCost?: number
  mapPrice?: number
  sku?: string
}

export function productToPickerProduct(p: Product): PickerProduct {
  const result: PickerProduct = {
    id:    p.id,
    title: p.title,
    image: p.images[0]?.url ?? null,
  }
  if (p.price != null) result.price = p.price
  if (p.compareAtPrice != null) result.compareAtPrice = p.compareAtPrice
  return result
}

export function searchResultToPickerProduct(p: AdminProductSearchResult): PickerProduct {
  const result: PickerProduct = {
    id:    p.id,
    title: p.title,
    image: p.image,
    price: p.price,
    inventoryQuantity: p.inventoryQuantity,
    sku:   p.sku,
  }
  if (p.compareAtPrice != null) result.compareAtPrice = p.compareAtPrice
  if (p.wholesaleCost != null) result.wholesaleCost = p.wholesaleCost
  if (p.mapPrice != null) result.mapPrice = p.mapPrice
  return result
}

export function ProductPicker({
  initial,
  onSave,
  saving,
}: {
  initial: PickerProduct[]
  onSave: (ids: string[]) => void
  saving: boolean
}) {
  const [selected, setSelected]   = useState<PickerProduct[]>(initial)

  // Re-sync state when initial changes (e.g. after save + redirect revalidation)
  const initialKey = initial.map(p => p.id).join(',')
  useEffect(() => { setSelected(initial) }, [initialKey])

  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState<AdminProductSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback((q: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (q.length < 2) { setResults([]); setSearchError(null); return }
    timerRef.current = setTimeout(async () => {
      setSearching(true)
      setSearchError(null)
      try {
        const res  = await fetch(`/api/product-search?q=${encodeURIComponent(q)}`)
        const data = await res.json() as { products: AdminProductSearchResult[]; error?: string }
        if (data.error) setSearchError(data.error)
        const products = data.products ?? []
        products.sort((a, b) => {
          const marginA = a.wholesaleCost != null ? a.price - a.wholesaleCost : -Infinity
          const marginB = b.wholesaleCost != null ? b.price - b.wholesaleCost : -Infinity
          return marginB - marginA
        })
        setResults(products)
      } catch (err) {
        setSearchError(err instanceof Error ? err.message : 'Search failed')
      } finally {
        setSearching(false)
      }
    }, 350)
  }, [])

  useEffect(() => { search(query) }, [query, search])

  const isSelected = (id: string) => selected.some(p => p.id === id)

  const add = (p: AdminProductSearchResult) => {
    if (!isSelected(p.id)) setSelected(s => [...s, searchResultToPickerProduct(p)])
  }

  const remove = (id: string) => setSelected(s => s.filter(p => p.id !== id))

  return (
    <div className="space-y-4">
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="space-y-2">
          {selected.map(p => (
            <div key={p.id} className="flex items-center gap-3 bg-cream-2 rounded-xl px-3 py-2">
              {p.image && (
                <img src={p.image} alt={p.title} className="w-10 h-10 object-cover rounded-lg shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink truncate">{p.title}</p>
                <p className="text-xs text-ink/50">
                  {p.price != null && `$${p.price.toFixed(2)}`}
                  {p.inventoryQuantity != null && ` · ${p.inventoryQuantity} in stock`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(p.id)}
                className="shrink-0 text-ink/40 hover:text-red-500 transition-colors text-lg leading-none"
                aria-label="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {selected.length === 0 && (
        <p className="text-sm text-ink/40 italic">No products selected.</p>
      )}

      {/* Search input */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30 text-sm">🔍</span>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search products by name…"
          className="w-full border border-cream-2 rounded-xl pl-8 pr-10 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-coral/30"
        />
        {searching && !query && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink/40">Searching…</span>
        )}
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink transition-colors"
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {searchError && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          ⚠ Search error: {searchError}
        </p>
      )}

      {/* Search results */}
      {results.length > 0 && (
        <div className="border border-cream-2 rounded-xl overflow-hidden divide-y divide-cream-2">
          {results.map(p => {
            const already = isSelected(p.id)
            return (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 bg-white hover:bg-cream-2/40 transition-colors">
                {p.image && (
                  <img src={p.image} alt={p.title} className="w-10 h-10 object-cover rounded-lg shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{p.title}</p>
                  <div className="flex flex-wrap gap-x-3 text-xs text-ink/50 mt-0.5">
                    <span>Price: <strong className="text-ink">${p.price.toFixed(2)}</strong></span>
                    {p.compareAtPrice && <span>MSRP: ${p.compareAtPrice.toFixed(2)}</span>}
                    {p.wholesaleCost != null && <span>Cost: <strong className="text-green-600">${p.wholesaleCost.toFixed(2)}</strong></span>}
                    {p.mapPrice != null && <span>MAP: ${p.mapPrice.toFixed(2)}</span>}
                    <span>Stock: <strong className={p.inventoryQuantity < 5 ? 'text-red-500' : 'text-ink'}>{p.inventoryQuantity}</strong></span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => add(p)}
                  disabled={already}
                  className={
                    already
                      ? 'shrink-0 text-xs font-bold px-3 py-1.5 rounded-full bg-green-100 text-green-700 cursor-default'
                      : 'shrink-0 text-xs font-bold px-3 py-1.5 rounded-full bg-sage/10 text-sage hover:bg-sage/20 transition-colors'
                  }
                >
                  {already ? '✓ Added' : '+ Add'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Save button */}
      <button
        type="button"
        onClick={() => onSave(selected.map(p => p.id))}
        disabled={saving}
        className={
          saving
            ? 'w-full py-2.5 rounded-xl text-sm font-bold bg-ink/10 text-ink/40 cursor-not-allowed'
            : 'w-full py-2.5 rounded-xl text-sm font-bold bg-coral text-white hover:opacity-90 transition-opacity'
        }
      >
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  )
}
