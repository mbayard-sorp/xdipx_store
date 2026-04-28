import { useLayoutEffect, useRef, useState } from 'react'

interface ExpandableHtmlProps {
  /** HTML content to display. */
  html:        string
  /** Max number of lines before clamping. Defaults to 12. Used when
   *  `clampItems` is not provided. Approximated as max-height = N × 1.5rem,
   *  which lines up with the body line-height for paragraph text. */
  clampLines?: number
  /** Item-aware clamp: when set, shows the first N top-level `<li>` children
   *  by default and reveals the rest behind the "more" toggle. Use this for
   *  bullet content where the editorial budget is in items, not lines —
   *  wrapping bullets won't surface the toggle prematurely. */
  clampItems?: number
  /** Tailwind classes applied to the body. */
  bodyClass?:  string
}

/**
 * Renders HTML in a clamped body. When the content overflows, shows a "more"
 * link that expands the box in place to reveal the full content. In the
 * expanded state, a "close" link collapses back to the clamp.
 *
 * Two clamp modes:
 *  - `clampLines` (default) — line-budget for paragraph copy.
 *  - `clampItems`           — item-budget for `<li>`-based bullet content.
 */
export function ExpandableHtml({
  html,
  clampLines = 12,
  clampItems,
  bodyClass = '',
}: ExpandableHtmlProps) {
  const measureRef = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [itemMaxHeight, setItemMaxHeight] = useState<number | null>(null)

  // Detect overflow against the clamped layout so we only show the link when
  // the content actually doesn't fit. For clampItems, also compute the
  // pixel max-height that matches "first N items" against the rendered DOM.
  useLayoutEffect(() => {
    if (expanded) return
    const el = measureRef.current
    if (!el) return
    const check = () => {
      if (clampItems) {
        const list = el.querySelector('ul, ol') as HTMLElement | null
        const items = list
          ? Array.from(list.children).filter(c => c.tagName === 'LI') as HTMLElement[]
          : []
        if (items.length > clampItems) {
          const nth = items[clampItems - 1]
          if (!nth) {
            setItemMaxHeight(null)
            setOverflows(false)
            return
          }
          const elTop  = el.getBoundingClientRect().top
          const nthBot = nth.getBoundingClientRect().bottom
          setItemMaxHeight(nthBot - elTop)
          setOverflows(true)
        } else {
          setItemMaxHeight(null)
          setOverflows(false)
        }
      } else {
        setOverflows(el.scrollHeight - el.clientHeight > 1)
      }
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    window.addEventListener('resize', check)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', check)
    }
  }, [html, clampLines, clampItems, expanded])

  // Use max-height (not -webkit-line-clamp) so the clamp also works for
  // bullet-list content. line-clamp counts text-line breaks and ignores
  // block-level <li> children, which left list cards uncapped. For
  // clampItems, max-height is computed from the Nth item's measured bottom.
  const clampStyle: React.CSSProperties | undefined = expanded
    ? undefined
    : clampItems
      ? itemMaxHeight !== null
        ? { maxHeight: `${itemMaxHeight}px`, overflow: 'hidden' }
        : undefined
      : { maxHeight: `calc(${clampLines} * 1.5rem)`, overflow: 'hidden' }

  return (
    <div className="relative">
      <div
        ref={measureRef}
        className={bodyClass}
        style={clampStyle}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-2 text-xs font-semibold text-coral hover:underline"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          close
        </button>
      ) : overflows ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 text-xs font-semibold text-coral hover:underline"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          more
        </button>
      ) : null}
    </div>
  )
}
