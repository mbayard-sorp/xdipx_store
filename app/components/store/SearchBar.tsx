import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router'
import { motion, AnimatePresence } from 'motion/react'
import { shopifyImageUrl } from '~/lib/shopify-image'

interface SearchBarProps {
  onExpandChange?: (expanded: boolean) => void
}

interface PredictiveProduct {
  handle: string
  title: string
  previewImageUrl: string | null
  vendor: string | null
  price: string | null
  compareAtPrice: string | null
  category: string | null
}

interface CategoryHit {
  label: string
  count: number
}

interface PredictiveResults {
  products: PredictiveProduct[]
  totalProducts: number
  categories: CategoryHit[]
}

const POPULAR_SEARCHES = ['vibrator', 'lube', 'couples', 'bondage', 'wand', 'ring']

function formatPrice(value: string | null): string | null {
  if (!value) return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return num % 1 === 0 ? `$${num.toFixed(0)}` : `$${num.toFixed(2)}`
}

export function SearchBar({ onExpandChange }: SearchBarProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PredictiveResults>({ products: [], totalProducts: 0, categories: [] })
  const [isLoading, setIsLoading] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const mobileInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navigate = useNavigate()

  const collapse = useCallback(() => {
    setIsExpanded(false)
    onExpandChange?.(false)
    setQuery('')
    setResults({ products: [], totalProducts: 0, categories: [] })
  }, [onExpandChange])

  const expand = () => {
    setIsExpanded(true)
    onExpandChange?.(true)
    setTimeout(() => inputRef.current?.focus(), 260)
  }

  const closeMobile = useCallback(() => {
    setMobileOpen(false)
    setQuery('')
    setResults({ products: [], totalProducts: 0, categories: [] })
  }, [])

  // Click-outside
  useEffect(() => {
    if (!isExpanded) return
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return
      collapse()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isExpanded, collapse])

  // Focus mobile input
  useEffect(() => {
    if (mobileOpen) setTimeout(() => mobileInputRef.current?.focus(), 50)
  }, [mobileOpen])

  // Escape closes desktop
  useEffect(() => {
    if (!isExpanded) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') collapse() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [isExpanded, collapse])

  // Escape closes mobile
  useEffect(() => {
    if (!mobileOpen) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMobile() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [mobileOpen, closeMobile])

  const fetchResults = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < 2) {
      setResults({ products: [], totalProducts: 0, categories: [] })
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/predictive-search?q=${encodeURIComponent(q)}`)
        const data = await res.json() as PredictiveResults
        setResults(data)
      } catch {
        setResults({ products: [], totalProducts: 0, categories: [] })
      } finally {
        setIsLoading(false)
      }
    }, 250)
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value
    setQuery(q)
    fetchResults(q)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      isExpanded ? collapse() : closeMobile()
    } else if (e.key === 'Enter' && query.trim()) {
      navigate(`/search?q=${encodeURIComponent(query.trim())}`)
      isExpanded ? collapse() : closeMobile()
    }
  }

  const handleResultClick = () => {
    isExpanded ? collapse() : closeMobile()
  }

  const showDropdown = query.length >= 2
  const topProducts = results.products.slice(0, 3)
  const topCategories = results.categories.slice(0, 3)
  const hasSidebar = topCategories.length > 0 || POPULAR_SEARCHES.length > 0

  // Bold the matching query term inside a label string
  function highlight(text: string) {
    if (!query) return <>{text}</>
    const idx = text.toLowerCase().indexOf(query.toLowerCase())
    if (idx === -1) return <>{text}</>
    return (
      <>
        {text.slice(0, idx)}
        <strong className="font-bold text-ink">{text.slice(idx, idx + query.length)}</strong>
        {text.slice(idx + query.length)}
      </>
    )
  }

  const megaDropdown = (
    <div className="bg-white border border-cream-2 rounded-2xl shadow-xl overflow-hidden">
      {/* View all results banner — subtle purple accent */}
      {results.totalProducts > 0 && !isLoading && (
        <Link
          to={`/search?q=${encodeURIComponent(query)}`}
          onClick={handleResultClick}
          className="flex items-center gap-2 px-5 py-2.5 bg-sage/5 text-sage text-sm font-semibold hover:bg-sage/10 transition-colors border-b border-cream-2"
        >
          <SearchIcon className="w-4 h-4 shrink-0" />
          View all {results.totalProducts} result{results.totalProducts === 1 ? '' : 's'} for &ldquo;{query}&rdquo;
        </Link>
      )}

      {isLoading ? (
        <div className="p-4 flex gap-4 animate-pulse">
          {[0, 1, 2].map(i => (
            <div key={i} className="flex-1 space-y-2">
              <div className="aspect-square rounded-xl bg-cream-2" />
              <div className="h-3 bg-cream-2 rounded w-4/5" />
              <div className="h-3 bg-cream-2 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : topProducts.length === 0 ? (
        <p className="px-5 py-5 text-sm text-ink/50 text-center">
          No results found for &ldquo;{query}&rdquo;
        </p>
      ) : (
        <div className="flex divide-x divide-cream-2">
          {/* Left: product tiles with price */}
          <div className="flex-1 p-4">
            <ul className="grid grid-cols-3 gap-3">
              {topProducts.map(product => {
                const price = formatPrice(product.price)
                const compare = formatPrice(product.compareAtPrice)
                const onSale = !!(price && compare && product.price !== product.compareAtPrice)
                return (
                  <li key={product.handle}>
                    <Link
                      to={`/products/${product.handle}`}
                      onClick={handleResultClick}
                      className="group block"
                    >
                      <div className="aspect-square rounded-xl overflow-hidden bg-cream-2 mb-2">
                        {product.previewImageUrl ? (
                          <img
                            src={shopifyImageUrl(product.previewImageUrl, 240)}
                            alt={product.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-ink/10 text-2xl">♥</div>
                        )}
                      </div>
                      {product.vendor && (
                        <p className="text-[11px] text-ink/50 truncate leading-tight">{product.vendor}</p>
                      )}
                      <p className="text-xs font-medium text-ink line-clamp-2 leading-snug group-hover:text-coral transition-colors mb-1">
                        {highlight(product.title)}
                      </p>
                      {price && (
                        <p className="flex items-baseline gap-1.5">
                          <span className={`text-sm font-bold ${onSale ? 'text-coral' : 'text-ink'}`}>{price}</span>
                          {onSale && compare && (
                            <span className="text-[11px] text-ink/40 line-through">{compare}</span>
                          )}
                        </p>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* Right: Categories + Popular searches */}
          {hasSidebar && (
            <div className="w-48 shrink-0 p-4">
              {topCategories.length > 0 && (
                <div className="mb-4">
                  <p className="text-[10px] font-bold text-ink/40 uppercase tracking-widest mb-2">
                    Categories
                  </p>
                  <ul className="space-y-2">
                    {topCategories.map(cat => (
                      <li key={cat.label}>
                        <Link
                          to={`/search?q=${encodeURIComponent(cat.label)}`}
                          onClick={handleResultClick}
                          className="text-sm text-ink/70 hover:text-sage transition-colors leading-tight block"
                        >
                          {highlight(cat.label)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <p className="text-[10px] font-bold text-ink/40 uppercase tracking-widest mb-2">
                  Popular searches
                </p>
                <ul className="space-y-2">
                  {POPULAR_SEARCHES.map(term => (
                    <li key={term}>
                      <Link
                        to={`/search?q=${encodeURIComponent(term)}`}
                        onClick={handleResultClick}
                        className="text-sm text-ink/70 hover:text-sage transition-colors leading-tight block"
                      >
                        {term}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )

  return (
    <>
      {/* ── Desktop search ─────────────────────────────────────────────── */}
      <div ref={containerRef} className="relative hidden md:flex items-center">
        <motion.div
          animate={{ width: isExpanded ? 256 : 44 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="flex items-center"
          style={{ willChange: 'width' }}
        >
          {isExpanded ? (
            <div className="w-full flex items-center gap-2 px-3 h-10 bg-white border border-cream-2 focus-within:border-sage/50 focus-within:ring-2 focus-within:ring-sage/20 rounded-full transition-all">
              <SearchIcon className="w-4 h-4 text-ink/40 shrink-0" />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder="Search products…"
                className="flex-1 text-sm text-ink bg-transparent outline-none placeholder:text-ink/40 min-w-0 [&::-webkit-search-cancel-button]:hidden"
                aria-label="Search products"
                aria-autocomplete="list"
                aria-expanded={showDropdown}
              />
              {query && (
                <button
                  onClick={() => { setQuery(''); setResults({ products: [], totalProducts: 0, categories: [] }); inputRef.current?.focus() }}
                  className="text-ink/30 hover:text-ink/60 transition-colors"
                  aria-label="Clear search"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={expand}
              className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-cream-2 transition-colors"
              aria-label="Open search"
            >
              <SearchIcon className="w-[18px] h-[18px] text-ink/60" />
            </button>
          )}
        </motion.div>

        {/* Mega dropdown — anchored right so it doesn't clip off-screen */}
        <AnimatePresence>
          {isExpanded && showDropdown && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full right-0 mt-2 w-[640px] z-[80]"
            >
              {megaDropdown}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Mobile search icon ─────────────────────────────────────────── */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden flex items-center justify-center w-11 h-11 rounded-full hover:bg-cream-2 transition-colors"
        aria-label="Open search"
      >
        <SearchIcon className="w-[18px] h-[18px] text-ink/60" />
      </button>

      {/* ── Mobile full-screen overlay ─────────────────────────────────── */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[80] bg-cream/98 backdrop-blur-sm flex flex-col md:hidden"
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-cream-2">
              <div className="flex-1 flex items-center gap-2 px-3 h-10 bg-white border border-cream-2 focus-within:border-sage/50 focus-within:ring-2 focus-within:ring-sage/20 rounded-full">
                <SearchIcon className="w-4 h-4 text-ink/40 shrink-0" />
                <input
                  ref={mobileInputRef}
                  type="search"
                  value={query}
                  onChange={handleChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Search products…"
                  className="flex-1 text-sm text-ink bg-transparent outline-none placeholder:text-ink/40 min-w-0 [&::-webkit-search-cancel-button]:hidden"
                  aria-label="Search products"
                />
                {query && (
                  <button
                    onClick={() => { setQuery(''); setResults({ products: [], totalProducts: 0, categories: [] }); mobileInputRef.current?.focus() }}
                    className="text-ink/30 hover:text-ink/60 transition-colors"
                    aria-label="Clear search"
                  >
                    <XIcon className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <button
                onClick={closeMobile}
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-cream-2 transition-colors text-ink/60"
                aria-label="Close search"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto">
              {showDropdown ? (
                <div className="p-4">
                  {/* View all */}
                  {results.totalProducts > 0 && (
                    <Link
                      to={`/search?q=${encodeURIComponent(query)}`}
                      onClick={handleResultClick}
                      className="flex items-center justify-center gap-2 w-full px-5 py-3 mb-4 bg-sage/5 text-sage text-sm font-semibold rounded-full hover:bg-sage/10 transition-colors"
                    >
                      <SearchIcon className="w-4 h-4" />
                      View all {results.totalProducts} result{results.totalProducts === 1 ? '' : 's'} for &ldquo;{query}&rdquo;
                    </Link>
                  )}

                  {/* Products */}
                  {topProducts.length > 0 && (
                    <ul className="grid grid-cols-3 gap-3 mb-6">
                      {topProducts.map(product => {
                        const price = formatPrice(product.price)
                        const compare = formatPrice(product.compareAtPrice)
                        const onSale = !!(price && compare && product.price !== product.compareAtPrice)
                        return (
                          <li key={product.handle}>
                            <Link to={`/products/${product.handle}`} onClick={handleResultClick} className="group block">
                              <div className="aspect-square rounded-xl overflow-hidden bg-cream-2 mb-2">
                                {product.previewImageUrl ? (
                                  <img src={shopifyImageUrl(product.previewImageUrl, 240)} alt={product.title} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-ink/10 text-2xl">♥</div>
                                )}
                              </div>
                              <p className="text-xs font-medium text-ink line-clamp-2 leading-snug mb-1">{product.title}</p>
                              {price && (
                                <p className="flex items-baseline gap-1.5">
                                  <span className={`text-sm font-bold ${onSale ? 'text-coral' : 'text-ink'}`}>{price}</span>
                                  {onSale && compare && (
                                    <span className="text-[11px] text-ink/40 line-through">{compare}</span>
                                  )}
                                </p>
                              )}
                            </Link>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  {/* Categories */}
                  {topCategories.length > 0 && (
                    <div className="mb-4">
                      <p className="text-[10px] font-bold text-ink/40 uppercase tracking-widest mb-3">Categories</p>
                      <ul className="space-y-3">
                        {topCategories.map(cat => (
                          <li key={cat.label}>
                            <Link
                              to={`/search?q=${encodeURIComponent(cat.label)}`}
                              onClick={handleResultClick}
                              className="text-sm text-ink/70 hover:text-sage transition-colors"
                            >
                              {highlight(cat.label)}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Popular searches */}
                  <div>
                    <p className="text-[10px] font-bold text-ink/40 uppercase tracking-widest mb-3">Popular searches</p>
                    <ul className="space-y-3">
                      {POPULAR_SEARCHES.map(term => (
                        <li key={term}>
                          <Link
                            to={`/search?q=${encodeURIComponent(term)}`}
                            onClick={handleResultClick}
                            className="text-sm text-ink/70 hover:text-sage transition-colors"
                          >
                            {term}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="px-6 py-12 text-center text-ink/40 text-sm">
                  Start typing to search products…
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  )
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M1 1l12 12M13 1L1 13" />
    </svg>
  )
}
