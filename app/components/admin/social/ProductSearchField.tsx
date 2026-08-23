/**
 * Single-product picker for the Composer. Same `/api/product-search` endpoint
 * ProductPicker uses, but one product, and it writes both `shopifyProductId`
 * (durable linkage, the stock guard reads it at publish) and the handle (the
 * gate's product check reads it). Search runs through a fetcher against the
 * existing API route, so there is no raw fetch and no effect-driven loading.
 */
import { useState } from 'react'
import { useFetcher } from 'react-router'
import type { AdminProductSearchResult } from '~/lib/shopify.server'
import { CloseIcon, SearchIcon } from './icons'

export interface PickedProduct { id: string; handle: string; title: string; image: string | null }

export function ProductSearchField({
  value,
  onChange,
}: {
  value: PickedProduct | null
  onChange: (p: PickedProduct | null) => void
}) {
  const fetcher = useFetcher<{ products?: AdminProductSearchResult[]; error?: string }>()
  const [q, setQ] = useState('')
  const results = fetcher.data?.products ?? []

  function search(next: string) {
    setQ(next)
    if (next.trim().length >= 2) fetcher.load(`/api/product-search?q=${encodeURIComponent(next.trim())}`)
  }

  return (
    <div>
      <label htmlFor="composer-product" className="text-xs font-semibold uppercase tracking-wide text-ink-3">Product</label>
      <input type="hidden" name="shopifyProductId" value={value?.id ?? ''} />
      <input type="hidden" name="productHandle" value={value?.handle ?? ''} />
      {value ? (
        <div className="mt-2 flex items-center gap-3 rounded-xl border border-line bg-paper-2 p-2">
          {value.image ? (
            <img src={value.image} alt="" className="w-11 h-11 rounded-lg object-cover bg-paper-3 shrink-0" />
          ) : (
            <span className="w-11 h-11 rounded-lg bg-paper-3 shrink-0" aria-hidden="true" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-ink truncate">{value.title}</p>
            <p className="font-mono text-[11px] text-ink-4 truncate">{value.handle}</p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="Clear product"
            className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-lg text-ink-3 hover:text-ink hover:bg-paper-3"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      ) : (
        <div className="mt-2 relative">
          <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
          <input
            id="composer-product"
            type="search"
            value={q}
            onChange={e => search(e.target.value)}
            placeholder="Search the catalog by title"
            autoComplete="off"
            className="w-full min-h-11 rounded-xl border border-line bg-paper pl-9 pr-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-coral/30"
          />
          {fetcher.state !== 'idle' && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[11px] text-ink-4">searching</span>
          )}
        </div>
      )}
      {!value && fetcher.data?.error && (
        <p className="mt-1 text-xs text-red-700">Search failed: {fetcher.data.error}. Check the Shopify Admin token on the server, then retry.</p>
      )}
      {!value && q.trim().length >= 2 && fetcher.state === 'idle' && results.length === 0 && !fetcher.data?.error && fetcher.data && (
        <p className="mt-1 text-xs text-ink-3">No products match "{q}". Try a shorter word from the title.</p>
      )}
      {!value && results.length > 0 && (
        <ul className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-line divide-y divide-line bg-paper" role="listbox">
          {results.map(p => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => { onChange({ id: p.id, handle: p.handle, title: p.title, image: p.image }); setQ('') }}
                className="w-full flex items-center gap-3 px-3 min-h-12 text-left hover:bg-paper-2"
              >
                {p.image ? (
                  <img src={p.image} alt="" className="w-9 h-9 rounded-lg object-cover bg-paper-3 shrink-0" />
                ) : (
                  <span className="w-9 h-9 rounded-lg bg-paper-3 shrink-0" aria-hidden="true" />
                )}
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-ink truncate">{p.title}</span>
                  <span className="block font-mono text-[11px] text-ink-4">
                    {p.inventoryQuantity} in stock
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
