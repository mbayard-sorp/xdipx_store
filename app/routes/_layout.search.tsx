import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useFetcher, useLoaderData, useNavigate } from 'react-router'
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { searchAll, getSearchVendors } from '~/lib/search.server'
import type { ContentResult, SearchProductResult } from '~/lib/search.server'
import { getLiveDealHandle } from '~/lib/shopify.server'
import { getPage, getEmmaPresets } from '~/lib/sanity.server'
import { readRecentHandles } from '~/lib/recent-views.server'
import { AskEmmaRail } from '~/components/store/AskEmmaRail'
import { EmmaDiscoveryRail } from '~/components/store/EmmaDiscoveryRail'
import { LetMeLookAgainCTA } from '~/components/store/LetMeLookAgainCTA'
import { EmmaEncouragementStrip } from '~/components/store/EmmaEncouragementStrip'
import { db } from '~/lib/db.server'
import { pipelineSettings } from '../../db/schema'
import { eq } from 'drizzle-orm'
import type { TaxonomyGroup } from './admin.search-filters'
import ProductTileMedia from '~/components/store/ProductTileMedia'
import LiveDealBadge from '~/components/store/LiveDealBadge'
import { ContentBlockRenderer } from '~/components/cms/ContentBlockRenderer'
import type { ContentBlock } from '~/types/cms'

import { trackSearch, trackViewSearchResults } from '~/lib/analytics.client'

const SORT_OPTIONS = [
  { value: 'relevance',  label: 'Relevance' },
  { value: 'newest',     label: 'Newest' },
  { value: 'price_asc',  label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
] as const

type SortValue = typeof SORT_OPTIONS[number]['value']

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const q = data?.q ?? ''
  return [
    { title: q ? `Search: "${q}" — xdipx` : 'Search — xdipx' },
    { name: 'robots', content: 'noindex' },
  ]
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url    = new URL(request.url)
  const q      = url.searchParams.get('q') ?? ''
  const sort   = (url.searchParams.get('sort') ?? 'relevance') as SortValue
  const page   = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))

  const vendors    = url.searchParams.getAll('vendor')
  const tags       = url.searchParams.getAll('tag')
  const features   = url.searchParams.getAll('feature')
  const experience = url.searchParams.getAll('experience')
  const priceMin   = url.searchParams.get('price_min')
  const priceMax   = url.searchParams.get('price_max')

  // Ask-Emma taxonomy params — drive the new rail. AskEmmaRail writes a single
  // comma-separated value per key (e.g. ?mood=soft,playful), so parse as CSV.
  const csvToArr = (s: string | null) => (s ?? '').split(',').map(x => x.trim()).filter(Boolean)
  const moods      = csvToArr(url.searchParams.get('mood'))
  const audiences  = csvToArr(url.searchParams.get('audience'))
  const matters    = csvToArr(url.searchParams.get('matters'))
  const budgetMaxS = url.searchParams.get('budgetMax')
  const budgetMax  = budgetMaxS ? parseFloat(budgetMaxS) : null

  const [searchResult, taxonomyRow, vendorList, liveDealHandle, bannerPage, presets] = await Promise.all([
    searchAll({
      query: q,
      tags,
      vendors,
      features,
      experience,
      priceMin: priceMin ? parseFloat(priceMin) : null,
      priceMax: priceMax ? parseFloat(priceMax) : null,
      moods,
      audiences,
      matters,
      budgetMax,
      sort,
      page,
    }),
    db.select().from(pipelineSettings).where(eq(pipelineSettings.key, 'searchFilterTaxonomy')),
    getSearchVendors(),
    getLiveDealHandle(),
    getPage('search-banner'),
    getEmmaPresets(),
  ])

  const recentViews = readRecentHandles(request)

  const bannerBlocks: ContentBlock[] = bannerPage?.sections?.filter(s => s.active !== false) ?? []

  let taxonomy: TaxonomyGroup[] = []
  if (taxonomyRow.length > 0) {
    try { taxonomy = JSON.parse(taxonomyRow[0]!.value) } catch { /* ignore */ }
  }

  return {
    q,
    sort,
    page,
    searchResult,
    taxonomy,
    vendorList,
    liveDealHandle,
    bannerBlocks,
    presets,
    recentViews,
    activeFilters: { vendors, tags, features, experience, priceMin, priceMax, moods, audiences, matters, budgetMax },
  }
}

export default function SearchPage() {
  const {
    q, sort, page, searchResult, taxonomy, vendorList, liveDealHandle, bannerBlocks, activeFilters,
    presets, recentViews,
  } = useLoaderData<typeof loader>()
  const navigate = useNavigate()
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)
  const [starred, setStarred] = useState<Record<string, string>>({})

  const { products: initialProducts, pages, blogPosts, totalProducts, hasNextPage: initialHasNextPage, facets } = searchResult

  // Emma discovery candidates — top 20 products with just the fields Haiku needs.
  const candidates = useMemo(
    () => initialProducts.slice(0, 20).map(p => ({
      handle: p.handle,
      title:  p.title,
      vendor: p.vendor ?? null,
      price:  p.price ? parseFloat(p.price) : 0,
      tags:   [],
      moodTags:    p.moodTags    ?? [],
      mattersTags: p.mattersTags ?? [],
    })),
    [initialProducts],
  )

  // Derive Emma-rail facets + budget bounds from the current result set.
  const emmaFacets = useMemo(() => {
    const moods = new Set<string>()
    const audiences = new Set<string>()
    const matters = new Set<string>()
    let pMin = Infinity
    let pMax = 0
    for (const p of initialProducts) {
      p.moodTags?.forEach(t => moods.add(t))
      p.audienceTags?.forEach(t => audiences.add(t))
      p.mattersTags?.forEach(t => matters.add(t))
      const price = p.price ? parseFloat(p.price) : 0
      if (price > 0 && price < pMin) pMin = price
      if (price > pMax) pMax = price
    }
    return {
      moods:     Array.from(moods).sort(),
      audiences: Array.from(audiences).sort(),
      matters:   Array.from(matters).sort(),
      priceMin:  Number.isFinite(pMin) ? pMin : 0,
      priceMax:  Math.max(pMax, 50),
    }
  }, [initialProducts])

  // ── GA4: search + view_search_results ─────────────────────────────────
  useEffect(() => {
    if (q) {
      trackSearch(q)
      trackViewSearchResults(q, totalProducts)
    }
  }, [q, totalProducts])

  function buildUrl(updates: Record<string, string | string[] | null>) {
    const params = new URLSearchParams()
    // Preserve q unless explicitly nulled
    if (q && updates.q !== null) params.set('q', q)
    if (sort) params.set('sort', sort)
    activeFilters.vendors.forEach(v => params.append('vendor', v))
    activeFilters.tags.forEach(t => params.append('tag', t))
    activeFilters.features.forEach(f => params.append('feature', f))
    activeFilters.experience.forEach(e => params.append('experience', e))
    if (activeFilters.priceMin) params.set('price_min', activeFilters.priceMin)
    if (activeFilters.priceMax) params.set('price_max', activeFilters.priceMax)
    activeFilters.moods.forEach(m => params.append('mood', m))
    activeFilters.audiences.forEach(a => params.append('audience', a))
    activeFilters.matters.forEach(m => params.append('matters', m))
    if (activeFilters.budgetMax != null) params.set('budgetMax', String(activeFilters.budgetMax))

    for (const [key, val] of Object.entries(updates)) {
      params.delete(key)
      if (val === null) continue
      if (Array.isArray(val)) val.forEach(v => params.append(key, v))
      else params.set(key, val)
    }
    params.delete('page')
    return `/search?${params.toString()}`
  }

  function toggleArrayFilter(key: 'vendor' | 'tag' | 'feature' | 'experience', value: string) {
    const currentMap: Record<string, string[]> = {
      vendor: activeFilters.vendors,
      tag: activeFilters.tags,
      feature: activeFilters.features,
      experience: activeFilters.experience,
    }
    const current = currentMap[key]!
    const next = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value]
    navigate(buildUrl({ [key]: next }))
  }

  function setPriceRange(min: string | null, max: string | null) {
    navigate(buildUrl({ price_min: min, price_max: max }))
  }

  function setSort(s: string) {
    navigate(buildUrl({ sort: s }))
  }

  function clearQuery() {
    navigate(buildUrl({ q: null }))
  }

  // Tag → friendly label from taxonomy
  const tagLabelMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const group of taxonomy) {
      for (const t of group.tags) m.set(t.tag, t.label)
    }
    return m
  }, [taxonomy])

  // Tag counts: prefer server facets; fall back to compound-tag derivation
  const tagCountMap = useMemo(() => {
    const m = new Map<string, number>()
    const facetTagCounts = facets?.tagCounts ?? {}
    for (const [tag, count] of Object.entries(facetTagCounts)) m.set(tag, count)
    for (const group of taxonomy) {
      for (const t of group.tags) {
        if (m.has(t.tag)) continue
        const parts = t.tag.split(',').map((s: string) => s.trim()).filter(Boolean)
        if (parts.length <= 1) continue
        let count = 0
        for (const part of parts) count += m.get(part) ?? 0
        if (count > 0) m.set(t.tag, count)
      }
    }
    return m
  }, [facets, taxonomy])

  const priceBuckets = facets?.priceBuckets ?? { under25: 0, p25_50: 0, p50_100: 0, over100: 0 }

  const featureCounts = facets?.featureCounts ?? {}
  const experienceCounts = facets?.experienceCounts ?? {}
  const hasAnyFeatures = Object.keys(featureCounts).length > 0
  const hasAnyExperience = Object.keys(experienceCounts).length > 0

  const hasActiveFilters =
    activeFilters.vendors.length > 0 ||
    activeFilters.tags.length > 0 ||
    activeFilters.features.length > 0 ||
    activeFilters.experience.length > 0 ||
    activeFilters.priceMin != null ||
    activeFilters.priceMax != null

  const hasContentResults = pages.length > 0 || blogPosts.length > 0

  const filterSidebar = (
    <div className="space-y-6">
      {/* Curated tag filter groups from admin taxonomy */}
      {taxonomy.map(group => (
        <FilterSection key={group.id} title={group.label} collapsible defaultExpanded={group.defaultExpanded !== false}>
          <ul className="space-y-2">
            {group.tags.map(t => {
              const checked = activeFilters.tags.includes(t.tag)
              const count = tagCountMap.get(t.tag)
              return (
                <li key={t.tag}>
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleArrayFilter('tag', t.tag)}
                      className="accent-sage w-3.5 h-3.5 rounded"
                    />
                    <span className={`text-sm transition-colors ${checked ? 'text-sage font-medium' : 'text-ink/70 group-hover:text-sage'}`}>
                      {t.label}
                    </span>
                    <span className="text-xs text-ink/30 ml-auto">({count ?? 0})</span>
                  </label>
                </li>
              )
            })}
          </ul>
        </FilterSection>
      ))}

      {/* Features (from IVR descriptors) */}
      {hasAnyFeatures && (
        <FilterSection title="Features" collapsible defaultExpanded>
          <ul className="space-y-2">
            {Object.entries(featureCounts)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 10)
              .map(([feature, count]) => {
                const checked = activeFilters.features.includes(feature)
                return (
                  <li key={feature}>
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleArrayFilter('feature', feature)}
                        className="accent-sage w-3.5 h-3.5 rounded"
                      />
                      <span className={`text-sm capitalize transition-colors ${checked ? 'text-sage font-medium' : 'text-ink/70 group-hover:text-sage'}`}>
                        {feature.replace(/-/g, ' ')}
                      </span>
                      <span className="text-xs text-ink/30 ml-auto">({count})</span>
                    </label>
                  </li>
                )
              })}
          </ul>
        </FilterSection>
      )}

      {/* Experience Level (from IVR descriptors) */}
      {hasAnyExperience && (
        <FilterSection title="Experience Level" collapsible defaultExpanded>
          <ul className="space-y-2">
            {Object.entries(experienceCounts)
              .sort(([, a], [, b]) => b - a)
              .map(([level, count]) => {
                const checked = activeFilters.experience.includes(level)
                return (
                  <li key={level}>
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleArrayFilter('experience', level)}
                        className="accent-sage w-3.5 h-3.5 rounded"
                      />
                      <span className={`text-sm capitalize transition-colors ${checked ? 'text-sage font-medium' : 'text-ink/70 group-hover:text-sage'}`}>
                        {level}
                      </span>
                      <span className="text-xs text-ink/30 ml-auto">({count})</span>
                    </label>
                  </li>
                )
              })}
          </ul>
        </FilterSection>
      )}

      {/* Brand / Vendor */}
      {vendorList.length > 0 && (
        <FilterSection title="Brand">
          <ul className="space-y-2">
            {vendorList.slice(0, 12).map(v => {
              const checked = activeFilters.vendors.includes(v.vendor)
              const count = facets?.vendorCounts?.[v.vendor] ?? v.count
              return (
                <li key={v.vendor}>
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleArrayFilter('vendor', v.vendor)}
                      className="accent-sage w-3.5 h-3.5 rounded"
                    />
                    <span className={`text-sm transition-colors ${checked ? 'text-sage font-medium' : 'text-ink/70 group-hover:text-sage'}`}>
                      {v.vendor}
                    </span>
                    <span className="text-xs text-ink/30 ml-auto">({count})</span>
                  </label>
                </li>
              )
            })}
          </ul>
        </FilterSection>
      )}

      {/* Price buckets */}
      <FilterSection title="Price">
        <ul className="space-y-1.5">
          {[
            { label: 'Under $25',  min: null,   max: '25',  count: priceBuckets.under25 },
            { label: '$25 – $50',  min: '25',   max: '50',  count: priceBuckets.p25_50 },
            { label: '$50 – $100', min: '50',   max: '100', count: priceBuckets.p50_100 },
            { label: '$100+',      min: '100',  max: null,  count: priceBuckets.over100 },
          ].map(bucket => {
            const active = activeFilters.priceMin === bucket.min && activeFilters.priceMax === bucket.max
            return (
              <li key={bucket.label} className="flex items-center gap-2">
                <button
                  onClick={() => active ? setPriceRange(null, null) : setPriceRange(bucket.min, bucket.max)}
                  className={`text-sm transition-colors ${active ? 'text-sage font-semibold' : 'text-ink/70 hover:text-sage'}`}
                >
                  {bucket.label}
                </button>
                <span className="text-xs text-ink/30 ml-auto">({bucket.count})</span>
              </li>
            )
          })}
          {(activeFilters.priceMin || activeFilters.priceMax) && (
            <li>
              <button onClick={() => setPriceRange(null, null)} className="text-xs text-ink/40 hover:text-coral transition-colors">
                Clear price filter
              </button>
            </li>
          )}
        </ul>
      </FilterSection>
    </div>
  )

  return (
    <div className="min-h-screen bg-cream">
      <div className="max-w-6xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-start gap-3 flex-wrap">
            <h1
              className="text-2xl font-bold text-ink"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {q ? (
                <>Search results for <span className="text-coral">&ldquo;{q}&rdquo;</span></>
              ) : (
                'All Products'
              )}
            </h1>
            {q && (
              <button
                onClick={clearQuery}
                className="inline-flex items-center gap-1.5 bg-white border border-cream-2 text-sage text-xs font-semibold px-3 py-1.5 rounded-full hover:border-coral hover:text-coral transition-colors"
                aria-label="Clear search query"
              >
                Clear search
                <span aria-hidden="true">×</span>
              </button>
            )}
          </div>
          {totalProducts > 0 && (
            <p className="text-sm text-ink/50 mt-1">
              {totalProducts} product{totalProducts !== 1 ? 's' : ''}
              {q && (
                <>
                  {' · '}
                  <button
                    onClick={clearQuery}
                    className="text-sage hover:text-coral underline underline-offset-2 transition-colors"
                  >
                    Clear search to see all
                  </button>
                </>
              )}
            </p>
          )}

          {/* Active filter chips */}
          {hasActiveFilters && (
            <div className="flex flex-wrap gap-2 mt-3">
              {activeFilters.vendors.map(v => (
                <FilterChip key={v} label={v} onRemove={() => toggleArrayFilter('vendor', v)} />
              ))}
              {activeFilters.tags.map(t => (
                <FilterChip key={t} label={tagLabelMap.get(t) ?? t} onRemove={() => toggleArrayFilter('tag', t)} />
              ))}
              {activeFilters.features.map(f => (
                <FilterChip key={`feat-${f}`} label={f} onRemove={() => toggleArrayFilter('feature', f)} />
              ))}
              {activeFilters.experience.map(e => (
                <FilterChip key={`exp-${e}`} label={e} onRemove={() => toggleArrayFilter('experience', e)} />
              ))}
              {(activeFilters.priceMin || activeFilters.priceMax) && (
                <FilterChip
                  label={activeFilters.priceMin && activeFilters.priceMax
                    ? `$${activeFilters.priceMin}–$${activeFilters.priceMax}`
                    : activeFilters.priceMax ? `Under $${activeFilters.priceMax}` : `$${activeFilters.priceMin}+`}
                  onRemove={() => setPriceRange(null, null)}
                />
              )}
              <button
                onClick={() => navigate(buildUrl({ vendor: null, tag: null, feature: null, experience: null, price_min: null, price_max: null }))}
                className="text-xs text-ink/40 hover:text-coral transition-colors underline underline-offset-2"
              >
                Clear all
              </button>
            </div>
          )}
        </div>

        {/* Sanity-driven banner */}
        {bannerBlocks.length > 0 && (
          <div className="mb-6 rounded-2xl overflow-hidden">
            {bannerBlocks.map(block => (
              <ContentBlockRenderer key={block._key} block={block} carouselProductMap={{}} />
            ))}
          </div>
        )}

        {/* Content results (pages + blog posts) */}
        {hasContentResults && (
          <div className="mb-8 space-y-4">
            {pages.length > 0 && (
              <ContentSection title="Pages" items={pages} linkPrefix="/pages/" />
            )}
            {blogPosts.length > 0 && (
              <ContentSection title="Articles" items={blogPosts} linkPrefix="/notebook/" />
            )}
          </div>
        )}

        <div className="flex gap-8">

          {/* ── Sidebar (desktop) ─────────────────────────────────────── */}
          <aside className="hidden lg:flex lg:flex-col gap-6 w-[260px] shrink-0">
            <EmmaDiscoveryRail
              surface="search"
              query={q}
              candidates={candidates}
              recentViews={recentViews}
              onStarredChange={setStarred}
            />
            <AskEmmaRail
              availableMoods={emmaFacets.moods}
              availableAudiences={emmaFacets.audiences}
              availableMatters={emmaFacets.matters}
              priceMin={emmaFacets.priceMin}
              priceMax={emmaFacets.priceMax}
              presets={presets}
            />
            {filterSidebar}
          </aside>

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="flex-1 min-w-0">

            {/* Sort bar + Emma encouragement strip */}
            <div className="flex items-center mb-5 gap-3">
              <button
                onClick={() => setFilterDrawerOpen(true)}
                className="lg:hidden flex items-center gap-2 px-4 py-2 border border-cream-2 rounded-xl text-sm font-medium text-ink hover:border-sage/40 transition-colors shrink-0"
              >
                <FilterIcon className="w-4 h-4" />
                Filter & Sort
                {hasActiveFilters && (
                  <span className="w-2 h-2 rounded-full bg-sage" />
                )}
              </button>

              <EmmaEncouragementStrip surface="search" query={q} />

              <div className="hidden lg:flex items-center gap-2 shrink-0">
                <label htmlFor="sort-select" className="text-sm text-ink/50">Sort:</label>
                <select
                  id="sort-select"
                  value={sort}
                  onChange={e => setSort(e.target.value)}
                  className="border border-cream-2 rounded-xl px-3 py-2 text-sm text-ink bg-white focus:ring-2 focus:ring-sage/40 focus:border-sage/50 focus:outline-none"
                >
                  {SORT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Products grid */}
            {initialProducts.length === 0 ? (
              <NoResults query={q} {...(q ? { onClear: clearQuery } : {})} />
            ) : (
              <InfiniteProductGrid
                initialProducts={initialProducts}
                initialPage={page}
                initialHasNextPage={initialHasNextPage}
                liveDealHandle={liveDealHandle}
                starred={starred}
              />
            )}

            {initialProducts.length > 0 && (
              <LetMeLookAgainCTA
                query={q}
                filters={{
                  moods:     activeFilters.moods,
                  audiences: activeFilters.audiences,
                  matters:   activeFilters.matters,
                  budgetMax: activeFilters.budgetMax,
                }}
                className="mt-8"
              />
            )}
          </div>
        </div>
      </div>

      {/* Mobile filter drawer */}
      {filterDrawerOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm lg:hidden"
            onClick={() => setFilterDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-cream rounded-t-2xl shadow-2xl lg:hidden max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-cream-2">
              <h2
                className="font-bold text-ink"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Filter & Sort
              </h2>
              <button
                onClick={() => setFilterDrawerOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-cream-2 transition-colors"
                aria-label="Close filters"
              >
                <svg viewBox="0 0 14 14" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M1 1l12 12M13 1L1 13" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
              <FilterSection title="Sort by">
                <ul className="space-y-1.5">
                  {SORT_OPTIONS.map(o => (
                    <li key={o.value}>
                      <button
                        onClick={() => { setSort(o.value); setFilterDrawerOpen(false) }}
                        className={`text-sm transition-colors ${sort === o.value ? 'text-sage font-semibold' : 'text-ink/70 hover:text-sage'}`}
                      >
                        {o.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </FilterSection>
              {filterSidebar}
            </div>

            <div className="px-5 py-4 border-t border-cream-2">
              <button
                onClick={() => setFilterDrawerOpen(false)}
                className="w-full py-3 bg-coral text-white font-bold rounded-full text-sm hover:opacity-90 transition-opacity"
              >
                Show {totalProducts} result{totalProducts !== 1 ? 's' : ''} ♥
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Infinite product grid ──────────────────────────────────────────────────

function InfiniteProductGrid({
  initialProducts,
  initialPage,
  initialHasNextPage,
  liveDealHandle,
  starred,
}: {
  initialProducts: SearchProductResult[]
  initialPage: number
  initialHasNextPage: boolean
  liveDealHandle: string | null
  starred: Record<string, string>
}) {
  const fetcher = useFetcher<{ searchResult: { products: SearchProductResult[]; hasNextPage: boolean } }>()
  const [items, setItems] = useState<SearchProductResult[]>(initialProducts)
  const [page, setPage] = useState(initialPage)
  const [hasNext, setHasNext] = useState(initialHasNextPage)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Reset when loader gives us new initial data (query/filter/sort changed)
  useEffect(() => {
    setItems(initialProducts)
    setPage(initialPage)
    setHasNext(initialHasNextPage)
  }, [initialProducts, initialPage, initialHasNextPage])

  // Append fetcher results as they arrive
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

  // IntersectionObserver sentinel
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasNext) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting && fetcher.state === 'idle') {
        const next = page + 1
        const params = new URLSearchParams(window.location.search)
        params.set('page', String(next))
        fetcher.load(`/search?${params.toString()}`)
        setPage(next)
      }
    }, { rootMargin: '400px 0px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNext, page, fetcher])

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

// ─── Product tile ───────────────────────────────────────────────────────────

function SearchTile({ product, isLiveDeal, starredReason }: { product: SearchProductResult; isLiveDeal: boolean; starredReason?: string }) {
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
    if (!canAtc) return // let link navigation happen
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

          {/* ATC button */}
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

// ─── Content results section ────────────────────────────────────────────────

function ContentSection({
  title,
  items,
  linkPrefix,
}: {
  title: string
  items: ContentResult[]
  linkPrefix: string
}) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm">
      <h2 className="text-xs font-bold text-ink/40 uppercase tracking-widest mb-3">{title}</h2>
      <ul className="space-y-2">
        {items.map(item => (
          <li key={item.slug}>
            <Link
              to={`${linkPrefix}${item.slug}`}
              className="group flex items-start gap-3 py-1"
            >
              <span className="shrink-0 mt-0.5 w-5 h-5 flex items-center justify-center rounded bg-cream-2 text-sage text-[10px] font-bold">
                {item._type === 'blogPost' ? '✎' : '◇'}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink group-hover:text-coral transition-colors line-clamp-1">
                  {item.title}
                </p>
                {(item.excerpt || item.seoDescription) && (
                  <p className="text-xs text-ink/50 line-clamp-1 mt-0.5">
                    {item.excerpt || item.seoDescription}
                  </p>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── Shared components ──────────────────────────────────────────────────────

function FilterSection({ title, children, collapsible = false, defaultExpanded = true }: {
  title: string
  children: React.ReactNode
  collapsible?: boolean
  defaultExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div>
      {collapsible ? (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center justify-between w-full mb-3 group"
        >
          <h3 className="text-xs font-bold text-ink uppercase tracking-wider group-hover:text-sage transition-colors">
            {title}
          </h3>
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`text-ink/30 group-hover:text-sage transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      ) : (
        <h3 className="text-xs font-bold text-ink uppercase tracking-wider mb-3">
          {title}
        </h3>
      )}
      {(!collapsible || expanded) && children}
    </div>
  )
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 bg-cream-2 text-sage text-xs px-3 py-1 rounded-full">
      {label}
      <button
        onClick={onRemove}
        className="hover:text-coral transition-colors"
        aria-label={`Remove filter: ${label}`}
      >
        ×
      </button>
    </span>
  )
}

function NoResults({ query, onClear }: { query: string; onClear?: () => void }) {
  return (
    <div className="text-center py-16">
      <p className="text-4xl mb-4">♥</p>
      <h2
        className="text-lg font-bold text-ink mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        No products found{query ? ` for "${query}"` : ''}
      </h2>
      <p className="text-sm text-ink/50 mb-6">
        Try a broader search or browse our categories
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {onClear && (
          <button
            onClick={onClear}
            className="px-5 py-2 border border-coral text-coral font-medium rounded-full text-sm hover:bg-coral hover:text-white transition-colors"
          >
            Clear search
          </button>
        )}
        {[
          { label: 'For Her', to: '/for-her' },
          { label: 'For Him', to: '/for-him' },
          { label: 'All Deals', to: '/vault' },
          { label: "Today's Deal", to: '/' },
        ].map(({ label, to }) => (
          <Link
            key={to}
            to={to}
            className="px-5 py-2 border border-cream-2 rounded-full text-sm font-medium text-ink hover:border-sage/40 hover:text-sage transition-colors"
          >
            {label}
          </Link>
        ))}
      </div>
    </div>
  )
}

function FilterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  )
}
