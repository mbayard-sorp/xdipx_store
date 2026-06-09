import { useMemo, useState } from 'react'
import { useLoaderData, useNavigate } from 'react-router'
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { searchAll } from '~/lib/search.server'
import { getLiveDealHandle } from '~/lib/shopify.server'
import { EmmaEncouragementStrip } from '~/components/store/EmmaEncouragementStrip'
import { InfiniteProductGrid } from '~/components/store/SearchProductGrid'
import { FilterSection, DrawerPill, FilterIcon, SortIcon } from '~/components/store/SearchFilterControls'
import { getSearchTaxonomy } from '~/lib/discovery-rules.server'
import type { TaxonomyGroup } from '~/lib/search-filter-csv'
import { normalizeTag } from '~/lib/tag-normalize'

const SORT_OPTIONS = [
  { value: 'relevance',  label: 'Featured' },
  { value: 'newest',     label: 'Newest' },
  { value: 'price_asc',  label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
] as const

type SortValue = typeof SORT_OPTIONS[number]['value']

export const meta: MetaFunction = () => [
  { title: 'All Products — xdipx' },
  {
    name: 'description',
    content: 'Browse every product on xdipx — sort and filter however you like.',
  },
  { tagName: 'link', rel: 'canonical', href: 'https://xdipx.com/view-all' },
  { name: 'robots', content: 'noindex, follow' },
]

export async function loader({ request }: LoaderFunctionArgs) {
  const url  = new URL(request.url)
  const sort = (url.searchParams.get('sort') ?? 'relevance') as SortValue
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))

  const vendors    = url.searchParams.getAll('vendor')
  const tags       = url.searchParams.getAll('tag')
  const features   = url.searchParams.getAll('feature')
  const experience = url.searchParams.getAll('experience')
  const priceMin   = url.searchParams.get('price_min')
  const priceMax   = url.searchParams.get('price_max')

  const taxonomy: TaxonomyGroup[] = (await getSearchTaxonomy()) ?? []
  const compoundTags = taxonomy
    .flatMap(g => g.tags.map(t => t.tag))
    .filter(t => t.includes(','))

  const [searchResult, liveDealHandle] = await Promise.all([
    searchAll({
      query: '',
      tags,
      vendors,
      features,
      experience,
      priceMin: priceMin ? parseFloat(priceMin) : null,
      priceMax: priceMax ? parseFloat(priceMax) : null,
      compoundTags,
      sort,
      page,
    }),
    getLiveDealHandle(),
  ])

  return {
    sort,
    page,
    searchResult,
    taxonomy,
    liveDealHandle,
    activeFilters: { vendors, tags, features, experience, priceMin, priceMax },
  }
}

export default function ViewAllPage() {
  const { sort, page, searchResult, taxonomy, liveDealHandle, activeFilters } = useLoaderData<typeof loader>()
  const navigate = useNavigate()
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)
  const [sortSheetOpen, setSortSheetOpen] = useState(false)

  const { products, totalProducts, hasNextPage, facets } = searchResult
  const currentSortLabel = SORT_OPTIONS.find(o => o.value === sort)?.label ?? 'Featured'

  const activeFilterCount =
    activeFilters.vendors.length +
    activeFilters.tags.length +
    activeFilters.features.length +
    activeFilters.experience.length +
    (activeFilters.priceMin || activeFilters.priceMax ? 1 : 0)

  function buildUrl(updates: Record<string, string | string[] | null>) {
    const params = new URLSearchParams()
    if (sort && sort !== 'relevance') params.set('sort', sort)
    activeFilters.vendors.forEach(v => params.append('vendor', v))
    activeFilters.tags.forEach(t => params.append('tag', t))
    activeFilters.features.forEach(f => params.append('feature', f))
    activeFilters.experience.forEach(e => params.append('experience', e))
    if (activeFilters.priceMin) params.set('price_min', activeFilters.priceMin)
    if (activeFilters.priceMax) params.set('price_max', activeFilters.priceMax)

    for (const [key, val] of Object.entries(updates)) {
      params.delete(key)
      if (val === null) continue
      if (Array.isArray(val)) val.forEach(v => params.append(key, v))
      else params.set(key, val)
    }
    params.delete('page')
    return `/view-all${params.toString() ? `?${params.toString()}` : ''}`
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

  function setSort(value: string) {
    navigate(buildUrl({ sort: value === 'relevance' ? null : value }))
  }

  function clearAllFilters() {
    navigate(buildUrl({
      vendor: null, tag: null, feature: null, experience: null,
      price_min: null, price_max: null,
    }))
  }

  const tagLabelMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const group of taxonomy) {
      for (const t of group.tags) m.set(t.tag, t.label)
    }
    return m
  }, [taxonomy])

  const tagCountMap = useMemo(() => {
    const m = new Map<string, number>()
    const facetTagCounts    = facets?.tagCounts         ?? {}
    const compoundTagCounts = facets?.compoundTagCounts ?? {}
    for (const [tag, count] of Object.entries(facetTagCounts))    m.set(tag, count)
    for (const [tag, count] of Object.entries(compoundTagCounts)) m.set(tag, count)
    return m
  }, [facets])

  function lookupTagCount(tag: string): number | undefined {
    if (tag.includes(',')) return tagCountMap.get(tag)
    return tagCountMap.get(normalizeTag(tag))
  }

  const filterSidebar = (
    <div className="space-y-6">
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
    </div>
  )

  return (
    <div className="min-h-screen bg-cream pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1
            className="text-2xl font-bold text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            All Products
          </h1>
          {totalProducts > 0 && (
            <p className="text-sm text-ink/50 mt-1">
              {totalProducts} product{totalProducts !== 1 ? 's' : ''}
              {activeFilterCount > 0 && ' matching your filters'}
            </p>
          )}
        </div>

        <div className="flex gap-8">
          {/* Desktop sidebar */}
          <aside className="hidden lg:block w-[260px] shrink-0">
            {filterSidebar}
          </aside>

          {/* Main */}
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
                <EmmaEncouragementStrip surface="search" query="" />
              </div>
            </div>

            {/* Desktop sort bar */}
            <div className="hidden lg:flex items-center mb-5 gap-3">
              <EmmaEncouragementStrip surface="search" query="" />
              <div className="flex items-center gap-2 shrink-0 ml-auto">
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

            {products.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-4xl mb-4">♥</p>
                <h2
                  className="text-lg font-bold text-ink mb-2"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  No products match those filters
                </h2>
                {activeFilterCount > 0 && (
                  <button
                    onClick={clearAllFilters}
                    className="mt-2 px-5 py-2 border border-coral text-coral font-medium rounded-full text-sm hover:bg-coral hover:text-white transition-colors"
                  >
                    Clear all filters
                  </button>
                )}
              </div>
            ) : (
              <InfiniteProductGrid
                initialProducts={products}
                initialPage={page}
                initialHasNextPage={hasNextPage}
                liveDealHandle={liveDealHandle}
                basePath="/view-all"
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
