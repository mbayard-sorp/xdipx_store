import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import type { ShopifyMenuItem } from '~/lib/shopify.server'

// Convert absolute Shopify URLs to relative paths so React Router <Link>
// handles navigation in-app (no full reload). Mirrors MegaMenu.tsx:8.
function toRelativePath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

// Top-level "Sale" tab gets plum accent treatment to match the desktop
// (plum = emphasis per the doctrine; coral stays reserved for the one
// primary CTA per viewport)
// mega-menu (MegaMenu.tsx:17 — ACCENT_LABELS).
const isAccentLabel = (label: string) => label.trim().toLowerCase() === 'sale'

const TAB_BAR_HEIGHT = 56

interface MobileExploreMenuProps {
  menuItems: ShopifyMenuItem[]
}

/**
 * Mobile-only fixed bottom tab bar showing the top-level Shopify menu
 * labels. Tapping a tab pops UP a sub-menu panel that drills into the
 * Shopify menu tree (top-level → children → grandchildren). Children
 * with their own children become drill-in buttons; leaves navigate.
 */
export function MobileExploreMenu({ menuItems }: MobileExploreMenuProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  // Indices into the active tab's items (and items.items, etc.) for nested drill-down.
  const [drillPath, setDrillPath] = useState<number[]>([])
  const location = useLocation()

  // Close on route change so navigating from a leaf auto-collapses.
  useEffect(() => {
    setActiveIndex(null)
    setDrillPath([])
  }, [location.pathname])

  // Close on Escape (mirrors CircleOptionSelector.tsx:124-128).
  useEffect(() => {
    if (activeIndex === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (drillPath.length > 0) {
          // Pop one drill level instead of closing entirely.
          setDrillPath(prev => prev.slice(0, -1))
        } else {
          setActiveIndex(null)
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [activeIndex, drillPath])

  // Lock body scroll while a sub-menu is open so swipes feel anchored.
  useEffect(() => {
    if (activeIndex === null) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [activeIndex])

  // Walk the menu tree from the active tab + drillPath to find the current node.
  const currentNode = useMemo<ShopifyMenuItem | null>(() => {
    if (activeIndex === null) return null
    let node: ShopifyMenuItem | undefined = menuItems[activeIndex]
    for (const i of drillPath) {
      if (!node) return null
      node = node.items[i]
    }
    return node ?? null
  }, [activeIndex, drillPath, menuItems])

  // Breadcrumb labels for the panel header (e.g. "PLEASURE › VIBRATORS").
  const breadcrumb = useMemo<string[]>(() => {
    if (activeIndex === null) return []
    const root = menuItems[activeIndex]
    if (!root) return []
    const labels: string[] = [root.title]
    let node: ShopifyMenuItem | undefined = root
    for (const i of drillPath) {
      node = node?.items[i]
      if (!node) break
      labels.push(node.title)
    }
    return labels
  }, [activeIndex, drillPath, menuItems])

  if (menuItems.length === 0) return null

  const open = activeIndex !== null && currentNode !== null
  const canGoBack = drillPath.length > 0

  const handleTabTap = (i: number) => {
    if (activeIndex === i) {
      setActiveIndex(null)
      setDrillPath([])
    } else {
      setActiveIndex(i)
      setDrillPath([])
    }
  }

  const handleDrillIn = (childIndex: number) => {
    setDrillPath(prev => [...prev, childIndex])
  }

  const handleBack = () => {
    setDrillPath(prev => prev.slice(0, -1))
  }

  return (
    <div className="md:hidden">
      <AnimatePresence>
        {open && currentNode && (
          <>
            {/* Backdrop — tap anywhere to close */}
            <motion.div
              key="explore-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="fixed inset-0 z-[54] bg-ink/40 backdrop-blur-sm"
              onClick={() => {
                setActiveIndex(null)
                setDrillPath([])
              }}
              aria-hidden="true"
            />

            {/* Sub-menu panel — pops up above the active tab */}
            <motion.div
              key="explore-panel"
              role="dialog"
              aria-modal="true"
              aria-label={`${currentNode.title} sub-menu`}
              id="explore-panel"
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96 }}
              transition={{ type: 'tween', duration: 0.22, ease: 'easeOut' }}
              style={{
                bottom: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom) + 8px)`,
                transformOrigin: 'bottom center',
                maxHeight: `calc(100dvh - ${TAB_BAR_HEIGHT + 24}px - env(safe-area-inset-bottom) - env(safe-area-inset-top))`,
              }}
              className="fixed inset-x-3 z-[56] flex flex-col rounded-2xl border border-line bg-paper shadow-2xl overflow-hidden"
            >
              {/* Header — breadcrumb + back button when nested */}
              <header className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-line/60">
                {canGoBack && (
                  <button
                    type="button"
                    onClick={handleBack}
                    aria-label="Back"
                    className="-ml-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-ink hover:bg-paper-2 active:scale-95"
                  >
                    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 5l-5 5 5 5" />
                    </svg>
                  </button>
                )}
                <div
                  className="flex-1 min-w-0 truncate"
                  style={{
                    fontFamily: 'var(--font-body)',
                    fontWeight: 800,
                    fontSize: '11px',
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    color: 'var(--color-coral-deep)',
                  }}
                >
                  {breadcrumb.join(' › ')}
                </div>
              </header>

              {/* Pane — content swaps in place when the user drills/back */}
              <div className="flex flex-col gap-2 overflow-y-auto px-3 py-3">
                {/* "Browse all" link to the current node's collection */}
                <Link
                  to={toRelativePath(currentNode.url)}
                  prefetch="intent"
                  className="flex min-h-[52px] items-center justify-center rounded-full border-[1.5px] border-ink bg-ink px-5 text-base font-semibold text-paper transition-all active:scale-[0.98]"
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  Browse all {currentNode.title}
                </Link>

                {/* Children — leaves navigate, parents drill deeper */}
                {(currentNode.items ?? []).map((child, i) => {
                  const hasChildren = (child.items?.length ?? 0) > 0
                  const baseClass =
                    'flex min-h-[52px] items-center gap-3 rounded-full border-[1.5px] border-ink/15 bg-paper-2 px-5 text-base font-semibold text-ink transition-all hover:border-coral hover:text-coral active:scale-[0.98]'
                  if (hasChildren) {
                    return (
                      <button
                        key={child.url || child.title}
                        type="button"
                        onClick={() => handleDrillIn(i)}
                        className={`${baseClass} text-left`}
                        style={{ fontFamily: 'var(--font-body)' }}
                      >
                        <span className="flex-1 min-w-0 truncate">{child.title}</span>
                        <svg
                          aria-hidden="true"
                          width="16"
                          height="16"
                          viewBox="0 0 20 20"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="shrink-0 opacity-60"
                        >
                          <path d="M8 5l5 5-5 5" />
                        </svg>
                      </button>
                    )
                  }
                  return (
                    <Link
                      key={child.url || child.title}
                      to={toRelativePath(child.url)}
                      prefetch="intent"
                      className={`${baseClass} justify-center`}
                      style={{ fontFamily: 'var(--font-body)' }}
                    >
                      {child.title}
                    </Link>
                  )
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Tab bar — always visible, anchored to the bottom edge. px-6 (ticket
          #14124): the doctrine's standard band inset every other element on
          the page respects — without it the first tab's label sits flush
          against the viewport edge at 375px (measured trimmed bbox x=0 to
          x=357, no gutter at all). */}
      <nav
        className="fixed inset-x-0 bottom-0 z-[55] flex items-stretch border-t border-line bg-paper px-6"
        style={{
          height: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`,
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
        aria-label="Browse categories"
      >
        {/* The tabs scroll; the account tab does not. Seven Sanity-published
            menu items share this row, and `flex-1` gave each of them an equal
            slice of it that is narrower than its own label at 375: measured on
            a consented capture (run 1703), the seven labels ran from x=25 to
            x=304 as ONE continuous glyph run, with inter-WORD gaps of 1-2px —
            indistinguishable from the 1-2px gaps between letters inside a word.
            The bar read "PleasurePlayBodyWearDiscoverSaleNotebook". Labels are
            `shrink-0` with their own padding now, so each one always renders at
            its natural width and the row scrolls when the item count outgrows
            the viewport, the same strip idiom the hero pill row and the rails
            already use. The account tab stays outside the scroller so it stays
            pinned to the right edge where it was.

            Why nobody had seen this: the `:has()` rule in app.css hides this
            entire nav while the cookie-consent dialog is in the DOM, and the
            capture CLI seeded only the age gate, never a consent choice. So
            every design-critic capture in this project's history has scored a
            page with the primary mobile navigation display:none. It surfaced
            the first time a capture was taken with `--consent`. */}
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {menuItems.map((item, i) => {
          const active = activeIndex === i
          const accent = isAccentLabel(item.title)
          return (
            <button
              key={item.url || item.title}
              type="button"
              onClick={() => handleTabTap(i)}
              aria-expanded={active}
              aria-controls="explore-panel"
              // `shrink-0 grow`, not `flex-1`. Both let a tab fill spare room;
              // only one of them refuses to go narrower than its own label.
              // `flex-1` is `flex: 1 1 0%`, and that 0% basis is what let seven
              // labels be squeezed into slices too small for them. `grow` with
              // `shrink-0` keeps the basis at `auto` (the label's natural
              // width), so the tabs still spread evenly across the bar when the
              // Sanity menu is short enough to fit — which matters, because the
              // item count is content, not a constant — and overflow into the
              // scroller instead of overlapping when it is not.
              className="relative shrink-0 grow inline-flex items-center justify-center px-3 transition-colors"
              style={{
                // Doctrine §2 gives DM Sans "Body copy, nav, labels, CTA text".
                // Run 1298 moved the desktop nav and the mobile drawer off the
                // display serif (#12612 defect 1) across MegaMenu.tsx and
                // Navbar.tsx; this bar is the third nav surface and it kept the
                // serif, because the guard that fix added reads only those two
                // files. Same lesson the playbook already draws from run 1298,
                // one file further out: the surface was wider than the fix.
                // Family only, no weight change, exactly as that fix was scoped.
                fontFamily: 'var(--font-body)',
                fontWeight: 700,
                fontSize: '13px',
                letterSpacing: '0.01em',
                color: active
                  // `coral-deep` is a v2 compatibility alias that maps 1:1 onto
                  // plum-2 in app.css, so this renders the identical color.
                  // Doctrine §3 says migrate the aliases opportunistically on
                  // touch, and this line is being touched.
                  ? 'var(--color-plum-2)'
                  : accent
                    ? 'var(--color-plum)'
                    : 'var(--color-ink)',
              }}
            >
              {item.title}
              {/* Active indicator — coral underline that animates between tabs */}
              {active && (
                <motion.span
                  layoutId="explore-active-underline"
                  aria-hidden="true"
                  className="absolute left-3 right-3 top-0 h-[3px] rounded-b-full bg-coral"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
            </button>
          )
        })}
        </div>

        {/* My account — fixed-width tab on the right */}
        <Link
          to="/account"
          aria-label="My account"
          className="shrink-0 inline-flex items-center justify-center px-4 text-ink hover:text-coral transition-colors border-l border-line"
          onClick={() => setActiveIndex(null)}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </Link>
      </nav>
    </div>
  )
}
