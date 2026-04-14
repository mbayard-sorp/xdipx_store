import { useState } from 'react'
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { db } from '~/lib/db.server'
import { pipelineSettings } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { getTagCounts } from '~/lib/search.server'

export const meta: MetaFunction = () => [{ title: 'Search Filters — xdipx Admin' }]

export interface TaxonomyTag {
  tag: string
  label: string
}

export interface TaxonomyGroup {
  id: string
  label: string
  tags: TaxonomyTag[]
  defaultExpanded?: boolean
}

const SETTINGS_KEY = 'searchFilterTaxonomy'

export async function loader(_: LoaderFunctionArgs) {
  const row = await db.select().from(pipelineSettings).where(eq(pipelineSettings.key, SETTINGS_KEY))
  let taxonomy: TaxonomyGroup[] = []
  if (row.length > 0) {
    try { taxonomy = JSON.parse(row[0]!.value) } catch { /* ignore */ }
  }
  // Pass compound tag values so comma-delimited entries get accurate union counts
  const compoundTags = taxonomy.flatMap(g => g.tags.map(t => t.tag))
  const tagCounts = await getTagCounts(compoundTags)
  return { taxonomy, tagCounts }
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData()
  const intent = form.get('intent') as string

  if (intent === 'save-taxonomy') {
    const json = form.get('taxonomy') as string
    if (!json) return { ok: false, error: 'Missing taxonomy data' }

    let parsed: TaxonomyGroup[]
    try { parsed = JSON.parse(json) } catch { return { ok: false, error: 'Invalid JSON' } }

    // Validate structure
    for (const group of parsed) {
      if (!group.id || !group.label) return { ok: false, error: `Group missing id or label` }
      for (const tag of group.tags) {
        if (!tag.tag || !tag.label) return { ok: false, error: `Tag missing tag or label in group "${group.label}"` }
      }
    }

    await db
      .insert(pipelineSettings)
      .values({ key: SETTINGS_KEY, value: JSON.stringify(parsed), updatedAt: new Date() })
      .onConflictDoUpdate({ target: pipelineSettings.key, set: { value: JSON.stringify(parsed), updatedAt: new Date() } })

    return { ok: true }
  }

  return null
}

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export default function AdminSearchFiltersPage() {
  const { taxonomy: saved, tagCounts } = useLoaderData<typeof loader>()
  const fetcher = useFetcher<typeof action>()
  const [groups, setGroups] = useState<TaxonomyGroup[]>(saved)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set())

  function toggleCollapsed(idx: number) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const isDirty = JSON.stringify(groups) !== JSON.stringify(saved)
  const isSaving = fetcher.state !== 'idle'
  const saveResult = fetcher.data

  function updateGroup(idx: number, updates: Partial<TaxonomyGroup>) {
    setGroups(prev => prev.map((g, i) => {
      if (i !== idx) return g
      const updated = { ...g, ...updates }
      // Auto-generate id from label if label changed
      if (updates.label !== undefined) {
        updated.id = slugify(updates.label)
      }
      return updated
    }))
  }

  function removeGroup(idx: number) {
    setGroups(prev => prev.filter((_, i) => i !== idx))
  }

  function addGroup() {
    setGroups(prev => [...prev, { id: '', label: '', tags: [], defaultExpanded: true }])
  }

  function updateTag(groupIdx: number, tagIdx: number, updates: Partial<TaxonomyTag>) {
    setGroups(prev => prev.map((g, gi) => {
      if (gi !== groupIdx) return g
      return { ...g, tags: g.tags.map((t, ti) => ti === tagIdx ? { ...t, ...updates } : t) }
    }))
  }

  function removeTag(groupIdx: number, tagIdx: number) {
    setGroups(prev => prev.map((g, gi) => {
      if (gi !== groupIdx) return g
      return { ...g, tags: g.tags.filter((_, ti) => ti !== tagIdx) }
    }))
  }

  function addTag(groupIdx: number) {
    setGroups(prev => prev.map((g, gi) => {
      if (gi !== groupIdx) return g
      return { ...g, tags: [...g.tags, { tag: '', label: '' }] }
    }))
  }

  function moveTag(groupIdx: number, tagIdx: number, direction: -1 | 1) {
    setGroups(prev => prev.map((g, gi) => {
      if (gi !== groupIdx) return g
      const newTags = [...g.tags]
      const swapIdx = tagIdx + direction
      if (swapIdx < 0 || swapIdx >= newTags.length) return g
      ;[newTags[tagIdx], newTags[swapIdx]] = [newTags[swapIdx]!, newTags[tagIdx]!]
      return { ...g, tags: newTags }
    }))
  }

  function moveGroup(idx: number, direction: -1 | 1) {
    const swapIdx = idx + direction
    if (swapIdx < 0 || swapIdx >= groups.length) return
    setGroups(prev => {
      const next = [...prev]
      ;[next[idx], next[swapIdx]] = [next[swapIdx]!, next[idx]!]
      return next
    })
  }

  function handleSave() {
    const formData = new FormData()
    formData.set('intent', 'save-taxonomy')
    formData.set('taxonomy', JSON.stringify(groups))
    fetcher.submit(formData, { method: 'post' })
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-2xl font-bold text-brand-charcoal"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Search Filters
          </h1>
          <p className="text-sm text-brand-charcoal/50 mt-1">
            Curate which product tags appear as filter options in the search sidebar.
          </p>
        </div>
      </div>

      {/* Filter groups */}
      {groups.map((group, gi) => {
        const isCollapsed = collapsedGroups.has(gi)
        return (
          <section key={gi} className="bg-white rounded-2xl shadow-sm overflow-hidden">
            {/* Collapsible header */}
            <div className="flex items-center gap-3 px-6 py-4">
              <button
                onClick={() => toggleCollapsed(gi)}
                className="w-6 h-6 flex items-center justify-center rounded-lg text-brand-charcoal/40 hover:text-brand-purple transition-colors shrink-0"
                aria-label={isCollapsed ? 'Expand group' : 'Collapse group'}
              >
                <svg
                  width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  className={`transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                  aria-hidden="true"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
              <button
                onClick={() => toggleCollapsed(gi)}
                className="flex-1 min-w-0 text-left"
              >
                <span className="font-semibold text-brand-charcoal" style={{ fontFamily: 'var(--font-display)' }}>
                  {group.label || 'Untitled Group'}
                </span>
                <span className="text-xs text-brand-charcoal/40 ml-2">
                  {group.tags.length} tag{group.tags.length !== 1 ? 's' : ''}
                </span>
                {group.defaultExpanded === false && (
                  <span className="text-[10px] text-amber-500/70 ml-2 font-medium">collapsed by default</span>
                )}
              </button>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => moveGroup(gi, -1)}
                  disabled={gi === 0}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-brand-charcoal/30 hover:text-brand-purple hover:bg-brand-mist transition-colors disabled:opacity-20 disabled:hover:text-brand-charcoal/30 disabled:hover:bg-transparent"
                  title="Move up"
                >
                  <ArrowUpIcon />
                </button>
                <button
                  onClick={() => moveGroup(gi, 1)}
                  disabled={gi === groups.length - 1}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-brand-charcoal/30 hover:text-brand-purple hover:bg-brand-mist transition-colors disabled:opacity-20 disabled:hover:text-brand-charcoal/30 disabled:hover:bg-transparent"
                  title="Move down"
                >
                  <ArrowDownIcon />
                </button>
                <button
                  onClick={() => removeGroup(gi)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-brand-charcoal/30 hover:text-brand-coral hover:bg-red-50 transition-colors"
                  title="Remove group"
                >
                  <TrashIcon />
                </button>
              </div>
            </div>

            {/* Collapsible body */}
            {!isCollapsed && (
              <div className="px-6 pb-6 space-y-4 border-t border-brand-mist/50 pt-4">
                {/* Group label + ID */}
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-brand-charcoal/50 mb-1">
                      Group Label
                    </label>
                    <input
                      type="text"
                      value={group.label}
                      onChange={e => updateGroup(gi, { label: e.target.value })}
                      placeholder="e.g. Category"
                      className="w-full border border-brand-mist rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
                    />
                  </div>
                  <div className="w-36">
                    <label className="block text-xs font-semibold text-brand-charcoal/50 mb-1">
                      ID <span className="font-normal">(auto)</span>
                    </label>
                    <input
                      type="text"
                      value={group.id}
                      readOnly
                      className="w-full border border-brand-mist rounded-xl px-3 py-2 text-sm bg-brand-mist/30 text-brand-charcoal/50"
                    />
                  </div>
                </div>

                {/* Default expanded toggle */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={group.defaultExpanded !== false}
                    onChange={e => updateGroup(gi, { defaultExpanded: e.target.checked })}
                    className="accent-brand-purple w-3.5 h-3.5 rounded"
                  />
                  <span className="text-sm text-brand-charcoal/70">Expanded by default on search page</span>
                </label>

                {/* Tags */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-brand-charcoal/50">
                    Tags
                  </label>
                  {group.tags.length === 0 && (
                    <p className="text-xs text-brand-charcoal/30 italic">No tags yet. Add one below.</p>
                  )}
                  {group.tags.map((tag, ti) => (
                    <div key={ti} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={tag.tag}
                        onChange={e => updateTag(gi, ti, { tag: e.target.value })}
                        placeholder="cat:vibrators"
                        className="flex-1 border border-brand-mist rounded-xl px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
                      />
                      <input
                        type="text"
                        value={tag.label}
                        onChange={e => updateTag(gi, ti, { label: e.target.value })}
                        placeholder="Vibrators"
                        className="flex-1 border border-brand-mist rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
                      />
                      <span
                        className={`text-xs tabular-nums shrink-0 w-8 text-center ${(tagCounts[tag.tag] ?? 0) === 0 ? 'text-amber-500 font-medium' : 'text-brand-charcoal/40'}`}
                        title={`${tagCounts[tag.tag] ?? 0} products match "${tag.tag}"`}
                      >
                        {tagCounts[tag.tag] ?? 0}
                      </span>
                      <button
                        onClick={() => moveTag(gi, ti, -1)}
                        disabled={ti === 0}
                        className="w-6 h-6 flex items-center justify-center rounded text-brand-charcoal/25 hover:text-brand-purple transition-colors disabled:opacity-20"
                        title="Move up"
                      >
                        <ArrowUpIcon />
                      </button>
                      <button
                        onClick={() => moveTag(gi, ti, 1)}
                        disabled={ti === group.tags.length - 1}
                        className="w-6 h-6 flex items-center justify-center rounded text-brand-charcoal/25 hover:text-brand-purple transition-colors disabled:opacity-20"
                        title="Move down"
                      >
                        <ArrowDownIcon />
                      </button>
                      <button
                        onClick={() => removeTag(gi, ti)}
                        className="w-6 h-6 flex items-center justify-center rounded text-brand-charcoal/25 hover:text-brand-coral transition-colors"
                        title="Remove tag"
                      >
                        <XIcon />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => addTag(gi)}
                    className="text-xs font-semibold text-brand-purple hover:text-brand-purple-light transition-colors"
                  >
                    + Add tag
                  </button>
                </div>
              </div>
            )}
          </section>
        )
      })}

      {/* Add group */}
      <button
        onClick={addGroup}
        className="w-full py-3 border-2 border-dashed border-brand-mist rounded-2xl text-sm font-semibold text-brand-charcoal/40 hover:text-brand-purple hover:border-brand-purple/30 transition-colors"
      >
        + Add Filter Group
      </button>

      {/* Save bar */}
      <div className="sticky bottom-4 z-10">
        <div className="bg-white rounded-2xl shadow-lg border border-brand-mist p-4 flex items-center justify-between gap-4">
          <div className="text-sm">
            {saveResult && 'ok' in saveResult && saveResult.ok ? (
              <span className="text-green-600 font-medium">Saved successfully</span>
            ) : saveResult && 'error' in saveResult ? (
              <span className="text-red-500 font-medium">{(saveResult as { error: string }).error}</span>
            ) : isDirty ? (
              <span className="text-amber-600 font-medium">Unsaved changes</span>
            ) : (
              <span className="text-brand-charcoal/40">No changes</span>
            )}
          </div>
          <button
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            className="px-6 py-2.5 bg-brand-gradient text-white text-sm font-bold rounded-full hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {isSaving ? 'Saving...' : 'Save Filters'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ArrowUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  )
}

function ArrowDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M1 1l12 12M13 1L1 13" />
    </svg>
  )
}
