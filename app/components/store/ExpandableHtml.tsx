import { useLayoutEffect, useRef, useState } from 'react'

interface ExpandableHtmlProps {
  /** HTML content to display. */
  html:        string
  /** Max number of lines before clamping. Defaults to 12. */
  clampLines?: number
  /** Tailwind classes applied to the body. */
  bodyClass?:  string
}

/**
 * Renders HTML in a line-clamped body. When the content overflows, shows a
 * "more" link that expands the box in place to reveal the full text. In the
 * expanded state, a "close" link collapses back to the clamp.
 */
export function ExpandableHtml({
  html,
  clampLines = 12,
  bodyClass = '',
}: ExpandableHtmlProps) {
  const measureRef = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // Detect overflow against the clamped layout so we only show the link when
  // the content actually doesn't fit.
  useLayoutEffect(() => {
    if (expanded) return
    const el = measureRef.current
    if (!el) return
    const check = () => {
      setOverflows(el.scrollHeight - el.clientHeight > 1)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    window.addEventListener('resize', check)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', check)
    }
  }, [html, clampLines, expanded])

  const clampStyle: React.CSSProperties | undefined = expanded ? undefined : {
    display: '-webkit-box',
    WebkitLineClamp: clampLines,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  }

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
