/**
 * /admin/socials/library — the social image library (Phase 3, #4938).
 *
 * Reads `social_media_assets` directly (Phase 2 owns ingest, upload and the
 * provenance seam; this screen only lists, filters, tags and selects). The
 * detail drawer is the nested /:assetId route rendered through <Outlet/>.
 *
 * Select mode. With `?select=1` the loader is also what the Composer's
 * picker fetches (same filters, JSON). On the page itself the selection bar
 * offers "Add to draft" / "New post", which navigate to the Composer with
 * `?assets=1,2,3`; no global state.
 *
 * Upload posts multipart to /api/admin/social-upload (Phase 2's route:
 * field `file`, optional `productHandle`, `tags`, `castSlugs`).
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { Form, Link, Outlet, useFetcher, useLoaderData, useNavigate, useSearchParams } from 'react-router'
import { useMemo, useRef, useState } from 'react'
import { getAdminUser, requireAdmin } from '~/lib/session.server'
import {
  addAssetTags, archiveAssets, listLibraryAssets, parseLibraryFilters, removeAssetTag, unarchiveAssets,
} from '~/lib/social-studio.server'
import { LibraryGrid, LIBRARY_PAGE, type LibraryAsset } from '~/components/admin/social/LibraryGrid'
import { useStudioShortcuts } from '~/components/admin/social/use-shortcuts'
import { ArchiveIcon, CloseIcon, PlusIcon, SearchIcon, TagIcon, UndoIcon, UploadIcon } from '~/components/admin/social/icons'

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const filters = parseLibraryFilters(url)
  const page = await listLibraryAssets(filters)
  return {
    filters,
    assets: page.assets as unknown as LibraryAsset[],
    nextBefore: page.nextBefore,
    facets: page.facets,
    selectMode: url.searchParams.get('select') === '1',
  }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = form.get('intent')
  if (intent === 'tag-add') {
    const ids = String(form.get('assetIds') ?? '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0)
    const tag = String(form.get('tag') ?? '')
    if (ids.length === 0) return { ok: false, error: 'No assets selected' }
    const n = await addAssetTags(ids, tag)
    if (n === 0 && ids.length > 0) return { ok: false, error: 'Tag must be 1-40 lowercase letters, digits, spaces, dashes (or it was already on every asset)' }
    return { ok: true, intent: 'tag-add', updated: n }
  }
  if (intent === 'tag-remove') {
    const id = Number(form.get('assetId'))
    const ok = await removeAssetTag(id, String(form.get('tag') ?? ''))
    return ok ? { ok: true, intent: 'tag-remove' } : { ok: false, error: 'Asset or tag not found' }
  }
  if (intent === 'archive') {
    const ids = String(form.get('assetIds') ?? '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0)
    if (ids.length === 0) return { ok: false, error: 'No assets selected' }
    const admin = await getAdminUser(request)
    const result = await archiveAssets(ids, admin?.email || 'owner')
    if (result.archived.length === 0) {
      return { ok: false, intent: 'archive', error: result.refused.map(r => r.reason).join('; ') || 'Nothing archived' }
    }
    return { ok: true, intent: 'archive', archived: result.archived.length, refused: result.refused, warnings: result.warnings }
  }
  if (intent === 'unarchive') {
    const ids = String(form.get('assetIds') ?? '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0)
    if (ids.length === 0) return { ok: false, error: 'No assets selected' }
    const n = await unarchiveAssets(ids)
    return n > 0 ? { ok: true, intent: 'unarchive', unarchived: n } : { ok: false, error: 'Asset not found' }
  }
  return { ok: false, error: 'Unknown intent' }
}

const SOURCE_LABELS: Record<string, string> = { generated: 'Generated', upload: 'Uploaded', video_poster: 'Video poster' }

export default function SocialsLibrary() {
  const { filters, assets, nextBefore, facets } = useLoaderData<typeof loader>()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [tagDraft, setTagDraft] = useState('')
  const tagFetcher = useFetcher<{ ok: boolean; error?: string; updated?: number }>()
  const upload = useFetcher<{ ok?: boolean; error?: string; id?: number; url?: string }>()
  const archiveFetcher = useFetcher<{
    ok: boolean
    error?: string
    intent?: 'archive' | 'unarchive'
    archived?: number
    unarchived?: number
    refused?: Array<{ id: number; reason: string }>
    warnings?: Array<{ id: number; warning: string }>
  }>()
  const searchRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const shortcuts = useMemo(() => ({
    '/': (e: KeyboardEvent) => { e.preventDefault(); searchRef.current?.focus() },
    escape: () => { if (selected.size) setSelected(new Set()); else if (params.get('asset')) navigate('/admin/socials/library') },
    n: () => navigate('/admin/socials/compose/new'),
  }), [selected.size, params, navigate])
  useStudioShortcuts(shortcuts)

  function setFilter(key: string, value: string | null) {
    setParams(prev => {
      const n = new URLSearchParams(prev)
      if (value) n.set(key, value); else n.delete(key)
      n.delete('before')
      return n
    }, { preventScrollReset: true })
  }
  function toggle(id: number) {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  const ids = [...selected].join(',')
  const activeChips: Array<{ key: string; label: string }> = [
    filters.tag && { key: 'tag', label: `tag: ${filters.tag}` },
    filters.product && { key: 'product', label: `product: ${filters.product}` },
    filters.cast && { key: 'cast', label: `cast: ${filters.cast}` },
    filters.archetype && { key: 'archetype', label: `archetype: ${filters.archetype}` },
    filters.source && { key: 'source', label: SOURCE_LABELS[filters.source] ?? filters.source },
    filters.picked != null && { key: 'picked', label: filters.picked ? 'picked' : 'not picked' },
    filters.archived && { key: 'archived', label: 'Archived' },
  ].filter(Boolean) as Array<{ key: string; label: string }>

  return (
    <div className="space-y-4 pb-24">
      {/* Sticky toolbar */}
      <div className="sticky top-0 md:top-0 z-10 -mx-4 px-4 md:mx-0 md:px-0 py-2 bg-cream-2/95 backdrop-blur space-y-2">
        <Form method="get" className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
            <input
              ref={searchRef}
              type="search"
              name="q"
              defaultValue={filters.q}
              placeholder="Search prompt, tags, product  (/)"
              aria-label="Search the library"
              className="w-full min-h-11 rounded-xl border border-line bg-paper pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-coral/30"
            />
          </div>
          {['tag', 'product', 'cast', 'archetype', 'source', 'picked', 'archived'].map(k => (
            params.get(k) ? <input key={k} type="hidden" name={k} value={params.get(k) ?? ''} /> : null
          ))}
          <button type="submit" className="min-h-11 px-4 rounded-full border border-line bg-paper text-sm font-medium text-ink hover:border-ink-4">Search</button>
          <upload.Form method="post" action="/api/admin/social-upload" encType="multipart/form-data" className="shrink-0">
            <input
              ref={fileRef}
              type="file"
              name="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={e => { if (e.currentTarget.files?.length) upload.submit(e.currentTarget.form) }}
              aria-label="Upload an image"
            />
            {filters.product && <input type="hidden" name="productHandle" value={filters.product} />}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={upload.state !== 'idle'}
              className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-full border border-line bg-paper text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-50"
            >
              <UploadIcon size={14} /> {upload.state !== 'idle' ? 'Uploading' : 'Upload'}
            </button>
          </upload.Form>
        </Form>

        <div className="flex items-center gap-2 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 pb-1">
          <FilterSelect label="Product" value={filters.product} options={facets.products} onChange={v => setFilter('product', v)} />
          <FilterSelect label="Cast" value={filters.cast} options={facets.casts} onChange={v => setFilter('cast', v)} />
          <FilterSelect label="Archetype" value={filters.archetype} options={facets.archetypes} onChange={v => setFilter('archetype', v)} />
          <FilterSelect label="Source" value={filters.source} options={facets.sources} labels={SOURCE_LABELS} onChange={v => setFilter('source', v)} />
          <FilterSelect label="Picked" value={filters.picked == null ? null : filters.picked ? '1' : '0'} options={['1', '0']} labels={{ '1': 'Picked', '0': 'Not picked' }} onChange={v => setFilter('picked', v)} />
          <button
            type="button"
            onClick={() => setFilter('archived', filters.archived ? null : '1')}
            aria-pressed={filters.archived}
            className={`shrink-0 inline-flex items-center gap-1 min-h-9 px-2.5 rounded-full border text-xs font-mono ${filters.archived ? 'border-coral bg-coral-soft text-ink' : 'border-line bg-paper text-ink-3 hover:border-ink-4'}`}
          >
            <ArchiveIcon size={10} /> Archived
          </button>
          {facets.tags.slice(0, 12).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setFilter('tag', filters.tag === t ? null : t)}
              aria-pressed={filters.tag === t}
              className={`shrink-0 inline-flex items-center gap-1 min-h-9 px-2.5 rounded-full border text-xs font-mono ${filters.tag === t ? 'border-coral bg-coral-soft text-ink' : 'border-line bg-paper text-ink-3 hover:border-ink-4'}`}
            >
              <TagIcon size={10} /> {t}
            </button>
          ))}
        </div>
        {activeChips.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {activeChips.map(c => (
              <button key={c.key} type="button" onClick={() => setFilter(c.key, null)} className="inline-flex items-center gap-1 min-h-9 px-2.5 rounded-full bg-ink text-white text-xs font-mono">
                {c.label} <CloseIcon size={10} />
              </button>
            ))}
            <Link to="/admin/socials/library" className="text-xs text-ink-3 hover:text-ink min-h-9 inline-flex items-center">Clear all</Link>
          </div>
        )}
      </div>

      {upload.data?.error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Upload failed: {upload.data.error}
        </p>
      )}
      {upload.data?.ok && (
        <p className="rounded-xl border border-sage/40 bg-sage/10 px-3 py-2 text-xs text-[#4F6150]">
          Uploaded{upload.data.id ? ` as #${upload.data.id}` : ''}. It is in the index and passes provenance; it still owes the full imagery judgment at the gate.
        </p>
      )}

      {assets.length === 0 ? (
        <div className="rounded-2xl border border-line bg-paper p-10 text-center">
          <p className="text-sm text-ink">
            {filters.q || activeChips.length ? 'No images match these filters.' : 'The Library is empty.'}
          </p>
          <p className="text-xs text-ink-3 mt-1">
            {filters.q || activeChips.length
              ? 'Clear a filter or search a different word from the prompt.'
              : 'Every generated candidate lands here on the social team\'s next run once the Phase 2 ingest is live, and Upload adds your own.'}
          </p>
        </div>
      ) : (
        <>
          <LibraryGrid
            assets={assets}
            selected={selected}
            onToggle={toggle}
            onOpen={id => navigate(`/admin/socials/library/${id}?${params.toString()}`)}
          />
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-ink-4 tabular-nums">{assets.length} shown{nextBefore ? `, ${LIBRARY_PAGE} per page` : ''}</span>
            {nextBefore && (
              <button
                type="button"
                onClick={() => setParams(prev => { const n = new URLSearchParams(prev); n.set('before', String(nextBefore)); return n })}
                className="min-h-11 px-4 rounded-full border border-line bg-paper text-sm font-medium text-ink hover:border-ink-4"
              >
                Older
              </button>
            )}
          </div>
        </>
      )}

      {/* Persistent selection bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-20 border-t border-line bg-paper px-4 py-3 md:static md:rounded-2xl md:border md:sticky md:bottom-3 flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm text-ink tabular-nums">{selected.size} selected</span>
          <span className="flex-1" />
          <Link to={`/admin/socials/compose/new?assets=${ids}`} className="min-h-11 px-4 inline-flex items-center rounded-full bg-coral text-white text-sm font-semibold hover:bg-coral-2">
            New post
          </Link>
          <AddToDraft ids={ids} />
          <tagFetcher.Form method="post" className="flex items-center gap-1">
            <input type="hidden" name="intent" value="tag-add" />
            <input type="hidden" name="assetIds" value={ids} />
            <input
              name="tag"
              value={tagDraft}
              onChange={e => setTagDraft(e.target.value)}
              placeholder="tag"
              aria-label="Tag to add to the selection"
              maxLength={40}
              className="w-28 min-h-11 rounded-xl border border-line bg-paper px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-coral/30"
            />
            <button type="submit" disabled={!tagDraft.trim() || tagFetcher.state !== 'idle'} className="inline-flex items-center gap-1 min-h-11 px-3 rounded-full border border-line bg-paper text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-50">
              <TagIcon size={14} /> Tag
            </button>
          </tagFetcher.Form>
          <archiveFetcher.Form method="post">
            <input type="hidden" name="intent" value={filters.archived ? 'unarchive' : 'archive'} />
            <input type="hidden" name="assetIds" value={ids} />
            <button
              type="submit"
              disabled={archiveFetcher.state !== 'idle'}
              className="inline-flex items-center gap-1 min-h-11 px-3 rounded-full border border-line bg-paper text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-50"
            >
              {filters.archived ? <UndoIcon size={14} /> : <ArchiveIcon size={14} />}
              {filters.archived ? 'Unarchive' : 'Archive'}
            </button>
          </archiveFetcher.Form>
          <button type="button" onClick={() => setSelected(new Set())} className="min-h-11 px-3 text-sm text-ink-3 hover:text-ink">Clear</button>
          {tagFetcher.data?.ok === false && <p className="w-full text-xs text-red-700">{tagFetcher.data.error}</p>}
          {archiveFetcher.data?.ok === false && <p className="w-full text-xs text-red-700">{archiveFetcher.data.error}</p>}
          {archiveFetcher.data?.ok && archiveFetcher.data.intent === 'archive' && (
            <p className="w-full text-xs text-ink-3">
              Archived {archiveFetcher.data.archived}.
              {archiveFetcher.data.refused && archiveFetcher.data.refused.length > 0 && ` ${archiveFetcher.data.refused.length} refused: ${archiveFetcher.data.refused.map(r => r.reason).join(' ')}`}
              {archiveFetcher.data.warnings && archiveFetcher.data.warnings.length > 0 && ` ${archiveFetcher.data.warnings.map(w => w.warning).join(' ')}`}
            </p>
          )}
          {archiveFetcher.data?.ok && archiveFetcher.data.intent === 'unarchive' && (
            <p className="w-full text-xs text-ink-3">Unarchived {archiveFetcher.data.unarchived}.</p>
          )}
        </div>
      )}

      <Outlet />
    </div>
  )
}

/** "Add to draft" asks which open draft: a tiny inline id prompt, no extra route. */
function AddToDraft({ ids }: { ids: string }) {
  const [open, setOpen] = useState(false)
  const [draftId, setDraftId] = useState('')
  const navigate = useNavigate()
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 min-h-11 px-3 rounded-full border border-line bg-paper text-sm font-medium text-ink hover:border-ink-4">
        <PlusIcon size={14} /> Add to draft
      </button>
    )
  }
  return (
    <form
      onSubmit={e => { e.preventDefault(); const n = Number(draftId); if (Number.isInteger(n) && n > 0) navigate(`/admin/socials/compose/${n}?assets=${ids}`) }}
      className="flex items-center gap-1"
    >
      <input
        value={draftId}
        onChange={e => setDraftId(e.target.value)}
        inputMode="numeric"
        placeholder="post #"
        aria-label="Draft post id"
        className="w-24 min-h-11 rounded-xl border border-line bg-paper px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-coral/30"
      />
      <button type="submit" className="min-h-11 px-3 rounded-full border border-line bg-paper text-sm font-medium text-ink hover:border-ink-4">Go</button>
      <button type="button" onClick={() => setOpen(false)} aria-label="Cancel" className="min-w-11 min-h-11 inline-flex items-center justify-center text-ink-3"><CloseIcon size={14} /></button>
    </form>
  )
}

function FilterSelect({ label, value, options, labels, onChange }: {
  label: string
  value: string | null
  options: string[]
  labels?: Record<string, string>
  onChange: (v: string | null) => void
}) {
  if (options.length === 0) return null
  return (
    <label className="shrink-0 inline-flex items-center gap-1 text-xs text-ink-3">
      <span className="sr-only">{label}</span>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        className={`min-h-9 rounded-full border px-2.5 text-xs bg-paper ${value ? 'border-coral text-ink' : 'border-line text-ink-3'}`}
      >
        <option value="">{label}</option>
        {options.map(o => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}
      </select>
    </label>
  )
}
