import type { ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { useState } from 'react'
import { kvSet, KV_KEYS, getVaultFilterTabs, DEFAULT_VAULT_TABS } from '~/lib/kv.server'
import { getShopifyCollections } from '~/lib/shopify.server'
import type { VaultFilterTab } from '~/types'

export const meta: MetaFunction = () => [{ title: 'Vault Filter Tabs — xdipx Admin' }]

export async function loader() {
  const [tabs, collections] = await Promise.all([
    getVaultFilterTabs(),
    getShopifyCollections(),
  ])
  return { tabs, collections }
}

export async function action({ request }: ActionFunctionArgs) {
  const form   = await request.formData()
  const intent = form.get('intent')

  if (intent === 'save-tabs') {
    const tabs = JSON.parse(form.get('tabs') as string) as VaultFilterTab[]
    await kvSet(KV_KEYS.vaultFilterTabs, tabs)
    return { ok: true }
  }

  if (intent === 'reset-defaults') {
    await kvSet(KV_KEYS.vaultFilterTabs, DEFAULT_VAULT_TABS)
    return { ok: true, reset: true }
  }

  return null
}

export default function VaultTabsAdmin() {
  const { tabs: initialTabs, collections } = useLoaderData<typeof loader>()
  const [tabs, setTabs] = useState<VaultFilterTab[]>(initialTabs)
  const fetcher    = useFetcher()
  const isSaving   = fetcher.state !== 'idle'
  const saved      = fetcher.state === 'idle' && fetcher.data && 'ok' in fetcher.data

  function addTab() {
    setTabs(prev => [...prev, {
      id:     `tab-${Date.now()}`,
      label:  'New Tab',
      slug:   `new-${Date.now()}`,
      filter: { type: 'all' },
    }])
  }

  function removeTab(id: string) {
    setTabs(prev => prev.filter(t => t.id !== id))
  }

  function updateTab(id: string, updates: Partial<Omit<VaultFilterTab, 'id'>>) {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
  }

  function moveTab(id: string, dir: -1 | 1) {
    setTabs(prev => {
      const idx     = prev.findIndex(t => t.id === id)
      const swapIdx = idx + dir
      if (idx === -1 || swapIdx < 0 || swapIdx >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[swapIdx]] = [next[swapIdx]!, next[idx]!]
      return next
    })
  }

  function save() {
    fetcher.submit(
      { intent: 'save-tabs', tabs: JSON.stringify(tabs) },
      { method: 'post' },
    )
  }

  function addCollectionTab(c: { handle: string; title: string }) {
    setTabs(prev => [...prev, {
      id:     `tab-${c.handle}-${Date.now()}`,
      label:  c.title,
      slug:   c.handle,
      filter: { type: 'collection', handle: c.handle },
    }])
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-2xl font-bold text-brand-charcoal"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Vault Filter Tabs
          </h1>
          <p className="text-sm text-brand-charcoal/50 mt-1">
            Configure the filter buttons on{' '}
            <a href="/vault" target="_blank" rel="noreferrer" className="text-brand-purple hover:underline">
              /vault
            </a>
            . Tabs can link to a Shopify collection or filter by price. Clicking a tab updates the URL so you can link directly to any filter.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {saved && (
            <span className="text-xs text-green-600 font-semibold">✓ Saved</span>
          )}
          <button
            onClick={save}
            disabled={isSaving}
            className="text-sm font-semibold px-5 py-2 bg-brand-gradient text-white rounded-full hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {isSaving ? 'Saving...' : 'Save All'}
          </button>
        </div>
      </div>

      {/* Tab editor */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden mb-6">
        {/* Column headers */}
        <div className="hidden md:grid px-5 py-3 bg-brand-mist text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wide gap-3"
          style={{ gridTemplateColumns: '28px 1fr 9rem 9rem 1fr 32px' }}>
          <span />
          <span>Label</span>
          <span>URL Slug</span>
          <span>Filter Type</span>
          <span>Value</span>
          <span />
        </div>

        {tabs.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-brand-charcoal/40">
            No tabs configured. Add one below or use a Shopify collection.
          </p>
        )}

        {tabs.map((tab, i) => {
          const filterType = tab.filter.type
          return (
            <div
              key={tab.id}
              className="border-t border-brand-mist px-5 py-3 flex flex-col md:grid gap-3 items-start md:items-center"
              style={{ gridTemplateColumns: '28px 1fr 9rem 9rem 1fr 32px' }}
            >
              {/* Up / Down arrows */}
              <div className="flex md:flex-col gap-1 shrink-0">
                <button
                  onClick={() => moveTab(tab.id, -1)}
                  disabled={i === 0}
                  className="text-brand-charcoal/30 hover:text-brand-charcoal disabled:opacity-20 transition-colors"
                  aria-label="Move up"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 15l-6-6-6 6" />
                  </svg>
                </button>
                <button
                  onClick={() => moveTab(tab.id, 1)}
                  disabled={i === tabs.length - 1}
                  className="text-brand-charcoal/30 hover:text-brand-charcoal disabled:opacity-20 transition-colors"
                  aria-label="Move down"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              </div>

              {/* Label */}
              <input
                type="text"
                value={tab.label}
                onChange={e => updateTab(tab.id, { label: e.target.value })}
                placeholder="Tab label"
                className="w-full text-sm border border-brand-mist rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-purple/30 text-brand-charcoal"
              />

              {/* Slug */}
              <div className="w-full">
                <input
                  type="text"
                  value={tab.slug}
                  onChange={e => updateTab(tab.id, { slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                  placeholder="url-slug"
                  className="w-full text-sm border border-brand-mist rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-purple/30 font-mono text-brand-charcoal/70"
                />
                <p className="text-[11px] text-brand-charcoal/30 mt-0.5 font-mono">/vault?tab={tab.slug}</p>
              </div>

              {/* Filter type */}
              <select
                value={filterType}
                onChange={e => {
                  const type = e.target.value as 'all' | 'collection' | 'price'
                  updateTab(tab.id, {
                    filter: type === 'all'
                      ? { type: 'all' }
                      : type === 'collection'
                      ? { type: 'collection', handle: collections[0]?.handle ?? '' }
                      : { type: 'price', max: 25 },
                  })
                }}
                className="w-full text-sm border border-brand-mist rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-purple/30 text-brand-charcoal"
              >
                <option value="all">All products</option>
                <option value="collection">Collection</option>
                <option value="price">Price under</option>
              </select>

              {/* Filter value */}
              <div className="w-full">
                {filterType === 'all' && (
                  <span className="text-xs text-brand-charcoal/30 italic">Shows all archived deals</span>
                )}
                {filterType === 'collection' && (
                  <select
                    value={(tab.filter as { type: 'collection'; handle: string }).handle}
                    onChange={e => updateTab(tab.id, { filter: { type: 'collection', handle: e.target.value } })}
                    className="w-full text-sm border border-brand-mist rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-purple/30 text-brand-charcoal"
                  >
                    {collections.length === 0 && (
                      <option value="">No collections in Shopify</option>
                    )}
                    {collections.map(c => (
                      <option key={c.handle} value={c.handle}>
                        {c.title}
                      </option>
                    ))}
                    {/* Show saved handle even if not in current list */}
                    {!collections.find(c => c.handle === (tab.filter as { type: 'collection'; handle: string }).handle) && (
                      <option value={(tab.filter as { type: 'collection'; handle: string }).handle}>
                        {(tab.filter as { type: 'collection'; handle: string }).handle} (not found)
                      </option>
                    )}
                  </select>
                )}
                {filterType === 'price' && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-brand-charcoal/50 shrink-0">Under $</span>
                    <input
                      type="number"
                      min={1}
                      value={(tab.filter as { type: 'price'; max: number }).max}
                      onChange={e => updateTab(tab.id, { filter: { type: 'price', max: parseInt(e.target.value) || 0 } })}
                      className="w-20 text-sm border border-brand-mist rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-purple/30 text-brand-charcoal"
                    />
                  </div>
                )}
              </div>

              {/* Delete */}
              <button
                onClick={() => removeTab(tab.id)}
                className="w-8 h-8 flex items-center justify-center rounded-full text-brand-charcoal/30 hover:text-red-400 hover:bg-red-50 transition-colors shrink-0"
                aria-label="Remove tab"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            </div>
          )
        })}

        {/* Add tab row */}
        <div className="border-t border-brand-mist px-5 py-3 flex items-center justify-between">
          <button
            onClick={addTab}
            className="flex items-center gap-2 text-sm font-semibold text-brand-purple hover:text-brand-purple/70 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Tab
          </button>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="reset-defaults" />
            <button
              type="submit"
              className="text-xs text-brand-charcoal/30 hover:text-brand-charcoal transition-colors"
            >
              Reset to defaults
            </button>
          </fetcher.Form>
        </div>
      </div>

      {/* Shopify Collections reference */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-brand-mist">
          <h2
            className="text-sm font-bold text-brand-charcoal"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Shopify Collections
          </h2>
          <p className="text-xs text-brand-charcoal/50 mt-0.5">
            All collections from your store. Click "+ Add Tab" to create a filter tab from any collection.
          </p>
        </div>

        {collections.length === 0 && (
          <p className="px-5 py-6 text-sm text-brand-charcoal/40 italic">
            No collections found. Create some in Shopify first.
          </p>
        )}

        <div className="divide-y divide-brand-mist">
          {collections.map(c => (
            <div key={c.handle} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="text-sm font-medium text-brand-charcoal">{c.title}</p>
                <p className="text-xs font-mono text-brand-charcoal/40 mt-0.5">{c.handle}</p>
              </div>
              <button
                onClick={() => addCollectionTab(c)}
                className="text-xs font-semibold px-3 py-1 rounded-full bg-brand-mist text-brand-purple hover:bg-brand-purple/10 transition-colors shrink-0"
              >
                + Add Tab
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
