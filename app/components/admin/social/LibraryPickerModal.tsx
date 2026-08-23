/**
 * The Library in select mode, opened from the Composer's `+`. The Composer
 * owns the fetcher (loaded on the click that opens this, reloaded on search)
 * against the Library route's own loader, and this hands the chosen assets
 * back. No global state, no effect-driven fetching.
 */
import { useState } from 'react'
import { LibraryGrid, type LibraryAsset } from './LibraryGrid'
import { CloseIcon, SearchIcon } from './icons'

export interface LibraryPickerData {
  assets: LibraryAsset[]
  nextBefore: number | null
}

/** The URL the Composer loads through its fetcher for this modal. */
export function libraryPickerUrl(q: string): string {
  return `/admin/socials/library?select=1&q=${encodeURIComponent(q)}`
}

export function LibraryPickerModal({
  initialQuery,
  data,
  loading,
  onSearch,
  onAdd,
  onClose,
}: {
  initialQuery: string
  data: LibraryPickerData | undefined
  loading: boolean
  onSearch: (q: string) => void
  onAdd: (assets: LibraryAsset[]) => void
  onClose: () => void
}) {
  const [q, setQ] = useState(initialQuery)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const loaded = data
  const assets = loaded?.assets ?? []

  function search(next: string) {
    setQ(next)
    onSearch(next)
  }
  function toggle(id: number) {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function add() {
    onAdd(assets.filter(a => selected.has(a.id)))
  }

  return (
    <div className="fixed inset-0 z-[100] bg-ink/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4" role="dialog" aria-modal="true" aria-labelledby="picker-title">
      <div className="w-full md:max-w-4xl h-[92vh] md:h-[80vh] flex flex-col rounded-t-2xl md:rounded-2xl bg-paper border border-line overflow-hidden">
        <div className="border-b border-line px-4 py-3 flex items-center gap-3">
          <h2 id="picker-title" className="font-display text-lg text-ink shrink-0">Library</h2>
          <div className="relative flex-1 min-w-0">
            <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
            <input
              type="search"
              value={q}
              onChange={e => search(e.target.value)}
              placeholder="Search prompt, tag, product"
              aria-label="Search the library"
              className="w-full min-h-11 rounded-xl border border-line bg-paper pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-coral/30"
            />
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-lg text-ink-3 hover:bg-paper-2">
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && !loaded && (
            <p className="font-mono text-xs text-ink-4">loading</p>
          )}
          {loaded && assets.length === 0 && (
            <div className="rounded-xl border border-line bg-paper-2 p-6 text-center">
              <p className="text-sm text-ink">Nothing in the Library{q ? ` for "${q}"` : ''}.</p>
              <p className="text-xs text-ink-3 mt-1">
                {q ? 'Clear the search, or ' : ''}Generated candidates land here on the social team's next run, and the Library page has an upload button.
              </p>
            </div>
          )}
          {assets.length > 0 && (
            <LibraryGrid assets={assets} selected={selected} onToggle={toggle} dense />
          )}
          {loaded?.nextBefore && (
            <p className="mt-3 text-xs text-ink-4">Showing the newest 60. Narrow with search to reach older images.</p>
          )}
        </div>

        <div className="border-t border-line px-4 py-3 flex items-center justify-between gap-3 bg-paper-2">
          <span className="font-mono text-xs text-ink-3 tabular-nums">{selected.size} selected</span>
          <button
            type="button"
            onClick={add}
            disabled={selected.size === 0}
            className="min-h-11 px-5 rounded-full bg-coral text-white text-sm font-semibold hover:bg-coral-2 disabled:opacity-50"
          >
            Add to draft
          </button>
        </div>
      </div>
    </div>
  )
}
