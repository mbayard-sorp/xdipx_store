import { useEffect, useMemo, useState } from 'react'
import { Link, useLoaderData, useNavigate } from 'react-router'
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { searchAll } from '~/lib/search.server'
import type { ContentResult } from '~/lib/search.server'
import { getLiveDealHandle } from '~/lib/shopify.server'
import { getPage, getEmmaPresets } from '~/lib/sanity.server'
import { readRecentHandles } from '~/lib/recent-views.server'
import { AskEmmaRail } from '~/components/store/AskEmmaRail'
import { EmmaDiscoveryRail } from '~/components/store/EmmaDiscoveryRail'
import { LetMeLookAgainCTA } from '~/components/store/LetMeLookAgainCTA'
import { EmmaEncouragementStrip } from '~/components/store/EmmaEncouragementStrip'
import { InfiniteProductGrid } from '~/components/store/SearchProductGrid'
import { FilterSection, DrawerPill, FilterIcon, SortIcon } from '~/components/store/SearchFilterControls'
import { getSearchTaxonomy } from '~/lib/discovery-rules.server'
import type { TaxonomyGroup } from '~/lib/search-filter-csv'
import { ContentBlockRenderer } from '~/components/cms/ContentBlockRenderer'
import type { ContentBlock } from '~/types/cms'
import { normalizeTag } from '~/lib/tag-normalize'

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
  // /search is intentionally noindex per Google's site-search guidelines —
  // search-results pages are typically thin/duplicate. `follow` keeps link
  // equity flowing through to PDPs. Canonical strips ALL query params so
  // every variant (?q=, ?utm_*, ?gclid, sort/filter combos) consolidates to
  // one URL — Google never holds onto a search-result URL anyway.
  return [
    { title: q ? `Search: "${q}" — xdipx` : 'Search — xdipx' },
    {
      name: 'description',
      content: q
        ? `Searching xdipx for "${q}". Browse curated picks, the vault, and Emma's notebook.`
        : "Search xdipx — curated intimate-wellness picks, the vault, and Emma's notebook.",
    },
    { tagName: 'link', rel: 'canonical', href: 'https://xdipx.com/search' },
    { name: 'robots', content: 'noindex, follow' },
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

  // Load taxonomy first so we can pass compound tags through to searchAll for
  // accurate server-side counting. Cached at 5-min TTL via getSearchTaxonomy().
  const taxonomy: TaxonomyGroup[] = (await getSearchTaxonomy()) ?? []
  const compoundTags = taxonomy
    .flatMap(g => g.tags.map(t => t.tag))
    .filter(t => t.includes(','))

  const [searchResult, liveDealHandle, bannerPage, presets] = await Promise.all([
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
      compoundTags,
      sort,
      page,
    }),
    getLiveDealHandle(),
    getPage('search-banner'),
    getEmmaPresets(),
  ])

  const recentViews = readRecentHandles(request)

  const bannerBlocks: ContentBlock[] = bannerPage?.sections?.filter(s => s.active !== false) ?? []

  return {
    q,
    sort,
    page,
    searchResult,
    taxonomy,
    liveDealHandle,
    bannerBlocks,
    presets,
    recentViews,
    activeFilters: { vendors, tags, features, experience, priceMin, priceMax, moods, audiences, matters, budgetMax },
  }
}

export default function SearchPage() {
  const {
    q, sort, page, searchResult, taxonomy, liveDealHandle, bannerBlocks, activeFilters,
    presets, recentViews,
  } = useLoaderData<typeof loader>()
  const navigate = useNavigate()
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)
  const [sortSheetOpen, setSortSheetOpen] = useState(false)
  const [starred, setStarred] = useState<Record<string, string>>({})

  const activeFilterCount =
    activeFilters.vendors.length +
    activeFilters.tags.length +
    activeFilters.features.length +
    activeFilters.experience.length +
    (activeFilters.priceMin || activeFilters.priceMax ? 1 : 0) +
    activeFilters.moods.length +
    activeFilters.audiences.length +
    activeFilters.matters.length +
    (activeFilters.budgetMax != null ? 1 : 0)

  const currentSortLabel = SORT_OPTIONS.find(o => o.value === sort)?.label ?? 'Relevance'

  function clearAllFilters() {
    navigate(buildUrl({
      vendor: null, tag: null, feature: null, experience: null,
      price_min: null, price_max: null,
      mood: null, audience: null, matters: null, budgetMax: null,
    }))
  }

  function removeCsvFilter(key: 'mood' | 'audience' | 'matters', value: string) {
    const currentMap: Record<string, string[]> = {
      mood:     activeFilters.moods,
      audience: activeFilters.audiences,
      matters:  activeFilters.matters,
    }
    const next = currentMap[key]!.filter(v => v !== value)
    navigate(buildUrl({ [key]: next.length ? next.join(',') : null }))
  }

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

  // Tag counts: server provides single-tag counts (keyed by normalized slug,
  // e.g. "plugs-and-probes") and compound counts (keyed by the original CSV
  // the user passed in, e.g. "cat:plugs-and-probes,cat:foo"). Lookups go
  // through `lookupTagCount` which normalizes single-tag keys before reading
  // the map, so admin entries like "cat:plugs-and-probes" resolve to the
  // count stored under "plugs-and-probes". Compound entries hit the map
  // directly because the server keys them by their original CSV input.
  const tagCountMap = useMemo(() => {
    const m = new Map<string, number>()
    const facetTagCounts      = facets?.tagCounts         ?? {}
    const compoundTagCounts   = facets?.compoundTagCounts ?? {}
    for (const [tag, count] of Object.entries(facetTagCounts))    m.set(tag, count)
    for (const [tag, count] of Object.entries(compoundTagCounts)) m.set(tag, count)
    return m
  }, [facets])

  function lookupTagCount(tag: string): number | undefined {
    if (tag.includes(',')) return tagCountMap.get(tag)
    return tagCountMap.get(normalizeTag(tag))
  }

  // Active-filter chips above the grid still surface vendor/feature/
  // experience/price selections that arrive via direct URL params, even
  // though we no longer render UI to add them — admin/search-filters is
  // the single source of truth for the sidebar.
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
      {/* Curated tag filter groups from admin taxonomy. Keying on
         defaultExpanded forces a re-mount when admin toggles the flag, so
         FilterSection's useState picks up the new initial value. */}
      {taxonomy.map(group => (
        <FilterSection
          key={`${group.id}:${group.defaultExpanded === false ? 'c' : 'e'}`}
          title={group.label}
          collapsible
          defaultExpanded={group.defaultExpanded !== false}
        >
          <ul className="space-y-2">
            {group.tags.map(t => {
              const checked = activeFilters.tags.includes(t.tag)
              const count = lookupTagCount(t.tag)
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

      {/* Legacy auto-sections (Features / Experience Level / Brand / Price)
         have been removed: /admin/search-filters is the single source of
         truth for the sidebar. Anything not curated by admin shouldn't
         appear here. The taxonomy filter chips above are the only
         tag-driven controls; the AskEmmaRail above the sidebar handles
         mood / audience / matters / budget. */}
    </div>
  )

  return (
    <div className="min-h-screen bg-cream pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">
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

            {/* Mobile sticky filter/sort bar */}
            <div className="lg:hidden sticky top-0 z-30 -mx-4 px-4 py-2 mb-3 bg-cream/95 backdrop-blur supports-[backdrop-filter]:bg-cream/80 border-b border-cream-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFilterDrawerOpen(true)}
                  aria-label={`Open filters${activeFilterCount ? `, ${activeFilterCount} active` : ''}`}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-white border border-cream-2 rounded-xl text-sm font-semibold text-ink active:scale-[0.98] transition-transform"
                >
                  <FilterIcon className="w-4 h-4" />
                  <span>Filter</span>
                  {activeFilterCount > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-coral text-white text-[11px] font-bold">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setSortSheetOpen(true)}
                  aria-label={`Sort, current: ${currentSortLabel}`}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-white border border-cream-2 rounded-xl text-sm font-semibold text-ink active:scale-[0.98] transition-transform"
                >
                  <SortIcon className="w-4 h-4" />
                  <span className="truncate">{currentSortLabel}</span>
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0 text-ink/40" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </div>
              <div className="mt-2">
                <EmmaEncouragementStrip surface="search" query={q} />
              </div>
            </div>

            {/* Desktop sort bar */}
            <div className="hidden lg:flex items-center mb-5 gap-3">
              <EmmaEncouragementStrip surface="search" query={q} />
              <div className="flex items-center gap-2 shrink-0">
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

      {/* Mobile sort sheet */}
      {sortSheetOpen && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-ink/40 backdrop-blur-sm lg:hidden"
            onClick={() => setSortSheetOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-label="Sort products"
            className="fixed bottom-0 left-0 right-0 z-[60] bg-cream rounded-t-2xl shadow-2xl lg:hidden flex flex-col pb-[env(safe-area-inset-bottom)]"
          >
            <div className="flex items-center justify-center pt-2.5 pb-1">
              <span className="w-10 h-1 rounded-full bg-ink/15" aria-hidden="true" />
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-b border-cream-2">
              <h2
                className="font-bold text-ink text-base"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Sort by
              </h2>
              <button
                onClick={() => setSortSheetOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-cream-2 transition-colors"
                aria-label="Close sort"
              >
                <svg viewBox="0 0 14 14" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M1 1l12 12M13 1L1 13" />
                </svg>
              </button>
            </div>
            <ul className="py-2">
              {SORT_OPTIONS.map(o => {
                const active = sort === o.value
                return (
                  <li key={o.value}>
                    <button
                      onClick={() => { setSort(o.value); setSortSheetOpen(false) }}
                      className={`w-full flex items-center justify-between px-5 py-3.5 text-left text-sm transition-colors ${active ? 'text-coral font-semibold bg-coral/5' : 'text-ink hover:bg-cream-2'}`}
                    >
                      <span>{o.label}</span>
                      {active && (
                        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}

      {/* Mobile filter drawer */}
      {filterDrawerOpen && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-ink/40 backdrop-blur-sm lg:hidden"
            onClick={() => setFilterDrawerOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-label="Filter products"
            className="fixed bottom-0 left-0 right-0 z-[60] bg-cream rounded-t-2xl shadow-2xl lg:hidden max-h-[88vh] flex flex-col pb-[env(safe-area-inset-bottom)]"
          >
            <div className="flex items-center justify-center pt-2.5 pb-1">
              <span className="w-10 h-1 rounded-full bg-ink/15" aria-hidden="true" />
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-b border-cream-2">
              <div className="flex items-center gap-2">
                <h2
                  className="font-bold text-ink text-base"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Filter
                </h2>
                {activeFilterCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-coral text-white text-[11px] font-bold">
                    {activeFilterCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {activeFilterCount > 0 && (
                  <button
                    onClick={clearAllFilters}
                    className="text-xs font-semibold text-sage hover:text-coral transition-colors px-3 py-2"
                  >
                    Clear all
                  </button>
                )}
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
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-6">
              {activeFilterCount > 0 && (
                <div>
                  <h3 className="text-xs font-bold text-ink uppercase tracking-wider mb-3">
                    Selected
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {activeFilters.tags.map(t => (
                      <DrawerPill key={`t-${t}`} label={tagLabelMap.get(t) ?? t} onRemove={() => toggleArrayFilter('tag', t)} />
                    ))}
                    {activeFilters.moods.map(m => (
                      <DrawerPill key={`m-${m}`} label={m} onRemove={() => removeCsvFilter('mood', m)} />
                    ))}
                    {activeFilters.audiences.map(a => (
                      <DrawerPill key={`a-${a}`} label={a} onRemove={() => removeCsvFilter('audience', a)} />
                    ))}
                    {activeFilters.matters.map(m => (
                      <DrawerPill key={`mt-${m}`} label={m} onRemove={() => removeCsvFilter('matters', m)} />
                    ))}
                    {activeFilters.vendors.map(v => (
                      <DrawerPill key={`v-${v}`} label={v} onRemove={() => toggleArrayFilter('vendor', v)} />
                    ))}
                    {activeFilters.features.map(f => (
                      <DrawerPill key={`f-${f}`} label={f} onRemove={() => toggleArrayFilter('feature', f)} />
                    ))}
                    {activeFilters.experience.map(e => (
                      <DrawerPill key={`e-${e}`} label={e} onRemove={() => toggleArrayFilter('experience', e)} />
                    ))}
                    {(activeFilters.priceMin || activeFilters.priceMax) && (
                      <DrawerPill
                        label={activeFilters.priceMin && activeFilters.priceMax
                          ? `$${activeFilters.priceMin}–$${activeFilters.priceMax}`
                          : activeFilters.priceMax ? `Under $${activeFilters.priceMax}` : `$${activeFilters.priceMin}+`}
                        onRemove={() => setPriceRange(null, null)}
                      />
                    )}
                    {activeFilters.budgetMax != null && (
                      <DrawerPill
                        label={`Under $${activeFilters.budgetMax}`}
                        onRemove={() => navigate(buildUrl({ budgetMax: null }))}
                      />
                    )}
                  </div>
                </div>
              )}
              {filterSidebar}
            </div>

            <div className="px-5 py-3 border-t border-cream-2 bg-cream">
              <button
                onClick={() => setFilterDrawerOpen(false)}
                className="w-full py-3.5 bg-coral text-white font-bold rounded-full text-sm hover:opacity-90 active:scale-[0.99] transition-all"
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

