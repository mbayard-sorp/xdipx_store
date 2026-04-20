import { useRef, useState, useCallback, useEffect } from 'react'
import { Link, useLocation } from 'react-router'
import type { ShopifyMenuItem } from '~/lib/shopify.server'
import type { MegaMenuBanner } from '~/types/cms'

// Convert absolute Shopify URLs to relative paths
// e.g. "https://xdipx.com/collections/vibrators" → "/collections/vibrators"
function toRelativePath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

// "Sale" top-level item gets accent styling
const ACCENT_LABELS = new Set(['sale'])

// ─── Desktop Mega Menu ────────────────────────────────────────────────────────

export function DesktopMegaMenu({ items, banners = [] }: { items: ShopifyMenuItem[]; banners?: MegaMenuBanner[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const location = useLocation()

  // Close menu on navigation
  useEffect(() => {
    setActiveIndex(null)
  }, [location.pathname])

  const open = useCallback((idx: number) => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setActiveIndex(idx)
  }, [])

  const scheduleClose = useCallback(() => {
    closeTimer.current = setTimeout(() => setActiveIndex(null), 150)
  }, [])

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  // Close on Escape
  useEffect(() => {
    if (activeIndex === null) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveIndex(null)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [activeIndex])

  if (!items.length) return <div className="flex-1" />

  return (
    <div className="hidden md:flex items-center gap-1 flex-1 justify-center">
      {items.map((item, idx) => {
        const isAccent = ACCENT_LABELS.has(item.title.toLowerCase())
        const hasChildren = item.items.length > 0
        return (
          <div
            key={item.title}
            onMouseEnter={() => hasChildren ? open(idx) : undefined}
            onMouseLeave={hasChildren ? scheduleClose : undefined}
          >
            {hasChildren ? (
              <button
                className={[
                  'px-3 py-1.5 rounded-full text-sm font-medium transition-all relative',
                  isAccent
                    ? 'text-coral hover:text-coral font-semibold'
                    : activeIndex === idx
                      ? 'text-sage font-semibold'
                      : 'text-ink/70 hover:text-sage',
                ].join(' ')}
                style={{ fontFamily: 'var(--font-display)' }}
                aria-expanded={activeIndex === idx}
                aria-haspopup="true"
                onFocus={() => open(idx)}
              >
                {item.title}
                {activeIndex === idx && (
                  <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-sage rounded-full" />
                )}
              </button>
            ) : (
              <Link
                to={toRelativePath(item.url)}
                className={[
                  'px-3 py-1.5 rounded-full text-sm font-medium transition-all',
                  isAccent
                    ? 'text-coral hover:text-coral font-semibold'
                    : 'text-ink/70 hover:text-sage',
                ].join(' ')}
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {item.title}
              </Link>
            )}
          </div>
        )
      })}

      {/* Mega menu panel + overlay */}
      {activeIndex !== null && items[activeIndex]!.items.length > 0 && (
        <>
          {/* Overlay behind panel */}
          <div
            className="fixed inset-0 top-14 bg-ink/20 z-40"
            onClick={() => setActiveIndex(null)}
            aria-hidden="true"
          />

          {/* Panel */}
          <div
            className="absolute left-0 right-0 top-full z-50 bg-white border-b border-cream-2 shadow-lg"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            role="region"
            aria-label={`${items[activeIndex]!.title} menu`}
          >
            <div className="max-w-6xl mx-auto px-6 py-8">
              <MegaMenuColumns
                columns={items[activeIndex]!.items}
                parentUrl={items[activeIndex]!.url}
                onNavigate={() => setActiveIndex(null)}
                banners={banners.filter(b => b.menuLabel.toLowerCase() === items[activeIndex]!.title.toLowerCase())}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Mega Menu Columns ────────────────────────────────────────────────────────

function MegaMenuColumns({
  columns,
  onNavigate,
  banners = [],
}: {
  columns: ShopifyMenuItem[]
  parentUrl: string
  onNavigate: () => void
  banners?: MegaMenuBanner[]
}) {
  const leftBanner  = banners.find(b => b.position === 'left' && b.imageUrl)
  const rightBanner = banners.find(b => b.position === 'right' && b.imageUrl)

  return (
    <div className="flex gap-8 items-start justify-center">
      {/* Left promo banner */}
      {leftBanner && (
        <MegaMenuPromoBanner banner={leftBanner} onNavigate={onNavigate} />
      )}

      {/* Menu columns — compact, not stretched */}
      <div
        className="grid gap-8 shrink-0"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 160px))` }}
      >
        {columns.map((col) => (
          <div key={col.title}>
            <Link
              to={toRelativePath(col.url)}
              onClick={onNavigate}
              className="text-xs font-semibold uppercase tracking-wider text-ink/50 mb-3 block hover:text-sage transition-colors"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {col.title}
            </Link>
            {col.items.length > 0 && (
              <ul className="space-y-1.5">
                {col.items.map((item) => (
                  <li key={item.url}>
                    <Link
                      to={toRelativePath(item.url)}
                      onClick={onNavigate}
                      className="text-sm text-ink/70 hover:text-sage transition-colors block py-0.5"
                    >
                      {item.title}
                    </Link>
                  </li>
                ))}
                {/* "View all" link to the column's collection */}
                <li>
                  <Link
                    to={toRelativePath(col.url)}
                    onClick={onNavigate}
                    className="text-sm text-sage font-medium hover:text-sage/80 transition-colors block py-0.5 mt-2"
                  >
                    All {col.title.toLowerCase()} <span aria-hidden="true">&rarr;</span>
                  </Link>
                </li>
              </ul>
            )}
          </div>
        ))}
      </div>

      {/* Right promo banner */}
      {rightBanner && (
        <MegaMenuPromoBanner banner={rightBanner} onNavigate={onNavigate} />
      )}
    </div>
  )
}

// ─── Promo Banner ─────────────────────────────────────────────────────────────

function MegaMenuPromoBanner({
  banner,
  onNavigate,
}: {
  banner: MegaMenuBanner
  onNavigate: () => void
}) {
  const img = (
    <img
      src={banner.imageUrl}
      alt={banner.imageAlt ?? ''}
      className="w-full h-full object-cover rounded-xl"
    />
  )

  if (banner.link) {
    return (
      <Link
        to={banner.link}
        onClick={onNavigate}
        className="flex-1 min-w-[140px] max-w-[220px] aspect-[3/4] rounded-xl overflow-hidden hover:opacity-90 transition-opacity"
      >
        {img}
      </Link>
    )
  }

  return (
    <div className="flex-1 min-w-[140px] max-w-[220px] aspect-[3/4] rounded-xl overflow-hidden">
      {img}
    </div>
  )
}

// ─── Mobile Mega Menu (accordion) ─────────────────────────────────────────────

export function MobileMegaMenu({ items, onNavigate }: { items: ShopifyMenuItem[]; onNavigate: () => void }) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  function toggle(idx: number) {
    setExpandedIndex(prev => prev === idx ? null : idx)
  }

  return (
    <ul className="space-y-0.5 px-3">
      {items.map((item, idx) => {
        const isOpen = expandedIndex === idx
        const isAccent = ACCENT_LABELS.has(item.title.toLowerCase())
        const hasChildren = item.items.length > 0

        if (!hasChildren) {
          return (
            <li key={item.title}>
              <Link
                to={toRelativePath(item.url)}
                onClick={onNavigate}
                className={[
                  'w-full flex items-center px-4 py-3 rounded-xl text-base font-medium transition-all',
                  isAccent
                    ? 'text-coral font-semibold'
                    : 'text-ink hover:bg-cream-2 hover:text-sage',
                ].join(' ')}
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {item.title}
              </Link>
            </li>
          )
        }

        return (
          <li key={item.title}>
            <button
              onClick={() => toggle(idx)}
              className={[
                'w-full flex items-center justify-between px-4 py-3 rounded-xl text-base font-medium transition-all',
                isAccent
                  ? 'text-coral font-semibold'
                  : isOpen
                    ? 'bg-cream-2 text-sage font-semibold'
                    : 'text-ink hover:bg-cream-2 hover:text-sage',
              ].join(' ')}
              style={{ fontFamily: 'var(--font-display)' }}
              aria-expanded={isOpen}
            >
              {item.title}
              <ChevronIcon open={isOpen} />
            </button>

            {isOpen && (
              <div className="pb-2 pt-1 px-2">
                {item.items.map((col) => (
                  <div key={col.title} className="mb-3 last:mb-0">
                    <Link
                      to={toRelativePath(col.url)}
                      onClick={onNavigate}
                      className="text-xs font-semibold uppercase tracking-wider text-ink/40 px-3 mb-1.5 block hover:text-sage transition-colors"
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      {col.title}
                    </Link>
                    {col.items.length > 0 && (
                      <ul>
                        {col.items.map((link) => (
                          <li key={link.url}>
                            <Link
                              to={toRelativePath(link.url)}
                              onClick={onNavigate}
                              className="block px-3 py-1.5 rounded-lg text-sm text-ink/70 hover:text-sage hover:bg-cream-2/50 transition-colors"
                            >
                              {link.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}
