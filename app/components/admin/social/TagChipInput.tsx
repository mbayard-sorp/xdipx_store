/**
 * Editable tag chips for a Library asset. Add and remove post through the
 * route action (`tag-add` / `tag-remove`) so the index row is the truth.
 */
import { useState } from 'react'
import { useFetcher } from 'react-router'
import { CloseIcon, PlusIcon, TagIcon } from './icons'

export function TagChipInput({ assetId, tags }: { assetId: number; tags: string[] }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>()
  const [draft, setDraft] = useState('')
  const busy = fetcher.state !== 'idle'

  function add() {
    const t = draft.trim().toLowerCase()
    if (!t) return
    fetcher.submit({ intent: 'tag-add', assetIds: String(assetId), tag: t }, { method: 'post' })
    setDraft('')
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <TagIcon size={14} className="text-ink-3" />
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">Tags</span>
      </div>
      <ul className="flex flex-wrap gap-1.5 mb-2" role="list">
        {tags.length === 0 && <li className="text-xs text-ink-4">No tags yet.</li>}
        {tags.map(t => (
          <li key={t} className="inline-flex items-center gap-1 h-8 pl-2.5 pr-1 rounded-full border border-line bg-paper-2 text-xs text-ink">
            <span className="font-mono">{t}</span>
            <button
              type="button"
              aria-label={`Remove tag ${t}`}
              disabled={busy}
              onClick={() => fetcher.submit({ intent: 'tag-remove', assetId: String(assetId), tag: t }, { method: 'post' })}
              className="w-6 h-6 inline-flex items-center justify-center rounded-full text-ink-4 hover:text-red-700 hover:bg-red-50"
            >
              <CloseIcon size={12} />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="add a tag"
          aria-label="New tag"
          maxLength={40}
          className="flex-1 min-w-0 min-h-11 rounded-xl border border-line bg-paper px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-coral/30"
        />
        <button
          type="button"
          onClick={add}
          disabled={busy || !draft.trim()}
          className="inline-flex items-center gap-1 min-h-11 px-3 rounded-full border border-line bg-paper text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-50"
        >
          <PlusIcon size={14} /> Add
        </button>
      </div>
      {fetcher.data?.ok === false && <p className="mt-1 text-xs text-red-700">{fetcher.data.error}</p>}
    </div>
  )
}
