import { useState, useEffect, useMemo } from 'react'

interface TOCItem {
  id: string
  text: string
  level: 'h2' | 'h3'
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function extractHeadings(body: unknown[]): TOCItem[] {
  return (body ?? [])
    .filter((b: any) => b._type === 'block' && (b.style === 'h2' || b.style === 'h3'))
    .map((b: any) => {
      const text = (b.children ?? []).map((c: any) => c.text ?? '').join('')
      return { id: slugify(text), text, level: b.style as 'h2' | 'h3' }
    })
}

export function TableOfContents({
  body,
  embedded = false,
}: {
  body: unknown[]
  /**
   * When true, the desktop nav renders without its own sticky/scroll context.
   * Use this when the TOC sits inside an already-sticky rail so the two sticky
   * contexts don't fight and overlap sibling content.
   */
  embedded?: boolean
}) {
  const headings = useMemo(() => extractHeadings(body), [body])
  const [activeId, setActiveId] = useState<string>('')
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
            break
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
    )

    for (const h of headings) {
      const el = document.getElementById(h.id)
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [headings])

  if (headings.length < 2) return null

  return (
    <>
      {/* Mobile: collapsible */}
      <div className="lg:hidden mb-6">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 text-sm font-semibold text-ink w-full py-2"
        >
          <span>Table of Contents</span>
          <svg
            className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {isOpen && <TOCList headings={headings} activeId={activeId} />}
      </div>

      {/* Desktop: sticky sidebar */}
      <nav
        className={
          embedded
            ? 'hidden lg:block'
            : 'hidden lg:block sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto'
        }
        aria-label="Table of contents"
      >
        <p className="kicker mb-3">On this page</p>
        <TOCList headings={headings} activeId={activeId} />
      </nav>
    </>
  )
}

function TOCList({ headings, activeId }: { headings: TOCItem[]; activeId: string }) {
  return (
    <ul className="space-y-1 text-sm">
      {headings.map(h => (
        <li key={h.id} className={h.level === 'h3' ? 'pl-4' : ''}>
          <a
            href={`#${h.id}`}
            onClick={e => {
              e.preventDefault()
              document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth' })
            }}
            className={`block py-1 transition-colors border-l-2 pl-3 ${
              activeId === h.id
                ? 'border-coral text-ink font-medium'
                : 'border-transparent text-ink-3 hover:text-ink hover:border-line'
            }`}
          >
            {h.text}
          </a>
        </li>
      ))}
    </ul>
  )
}
