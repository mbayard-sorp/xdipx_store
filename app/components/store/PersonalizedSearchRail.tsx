import { useEffect, useState } from 'react'
import { Link } from 'react-router'

interface RailProduct {
  handle: string
  title:  string
  image:  string | null
  price:  number
}

interface PersonalizedSearchRailProps {
  /** Resolved first name from customer loader (empty string when logged out). */
  firstName?:    string
  /** Active search query. */
  query?:        string
  /** Suggested refinements derived from the current result facets. */
  refinements?:  { label: string; href: string }[]
  /** Products purchased in the customer's most recent order (server-side). */
  lastOrderProducts?: RailProduct[]
  /** Shopify spell-check suggestions — optional. */
  didYouMean?:   { label: string; href: string }[]
  /** Common quick-categories for logged-out fallback. */
  categories?:   { label: string; href: string }[]
}

const RECENT_KEY = 'xdipx:recently-browsed'

/**
 * Left sidebar on search — tells each visitor a slightly different story.
 * Most data comes from the loader; recently-browsed is client-only.
 */
export function PersonalizedSearchRail({
  firstName,
  query,
  refinements = [],
  lastOrderProducts = [],
  didYouMean = [],
  categories = [],
}: PersonalizedSearchRailProps) {
  const [recent, setRecent] = useState<RailProduct[]>([])
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    let handles: string[] = []
    try {
      const raw = localStorage.getItem(RECENT_KEY)
      handles = raw ? (JSON.parse(raw) as string[]).slice(0, 3) : []
    } catch {
      handles = []
    }
    if (handles.length === 0) return

    const controller = new AbortController()
    fetch(`/api/products-by-handles?handles=${encodeURIComponent(handles.join(','))}`, {
      signal: controller.signal,
    })
      .then(r => r.json() as Promise<{ products: RailProduct[] }>)
      .then(data => setRecent((data.products ?? []).slice(0, 3)))
      .catch(() => {})
    return () => controller.abort()
  }, [])

  const timeNote = buildTimeNote()
  const isLoggedIn = !!firstName

  return (
    <aside className="md:w-[240px] md:shrink-0 space-y-6" aria-label="Personalized suggestions">
      {isLoggedIn ? (
        <Section>
          <p className="text-sm text-ink">
            Hey <span className="font-semibold" style={{ fontFamily: 'var(--font-display)' }}>{firstName}</span> —
          </p>
          <p className="text-xs text-muted mt-1 italic">quick note</p>
          <p className="text-sm text-ink/75 mt-2 leading-relaxed">
            Whatever you're after, start here. If nothing clicks, tap Ask Emma and I'll narrow it.
          </p>
        </Section>
      ) : (
        <Section>
          <p className="text-sm text-ink">Hey there —</p>
          <p className="text-sm text-ink/75 mt-2 leading-relaxed">
            First time? Start with a preset on the left, or ask Emma anything ♥
          </p>
        </Section>
      )}

      {query && refinements.length > 0 && (
        <Section title={`Because you searched "${query}"`}>
          <ul className="space-y-1.5">
            {refinements.slice(0, 6).map((r, i) => (
              <li key={i}>
                <Link to={r.href} className="text-sm text-ink/75 hover:text-coral">
                  → {r.label}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {didYouMean.length > 0 && (
        <Section title="Did you mean">
          <ul className="space-y-1.5">
            {didYouMean.slice(0, 4).map((d, i) => (
              <li key={i}>
                <Link to={d.href} className="text-sm text-coral hover:underline">
                  {d.label}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {mounted && recent.length > 0 && (
        <Section title="You looked at last week">
          <ul className="space-y-2.5">
            {recent.map(p => (
              <li key={p.handle}>
                <Link to={`/products/${p.handle}`} className="flex gap-2.5 items-center group">
                  <div className="w-12 h-12 rounded-md bg-cream-2 overflow-hidden shrink-0">
                    {p.image ? (
                      <img src={p.image} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-ink/20">♥</div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-ink line-clamp-2 group-hover:text-coral">{p.title}</p>
                    <p className="text-[11px] text-muted">${p.price.toFixed(2)}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {isLoggedIn && lastOrderProducts.length > 0 && (
        <Section title="From your last order">
          <ul className="space-y-2.5">
            {lastOrderProducts.slice(0, 3).map(p => (
              <li key={p.handle}>
                <Link to={`/products/${p.handle}`} className="flex gap-2.5 items-center group">
                  <div className="w-12 h-12 rounded-md bg-cream-2 overflow-hidden shrink-0">
                    {p.image ? (
                      <img src={p.image} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-ink/20">♥</div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-ink line-clamp-2 group-hover:text-coral">{p.title}</p>
                    <p className="text-[11px] text-muted">${p.price.toFixed(2)}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!isLoggedIn && categories.length > 0 && (
        <Section title="Categories">
          <ul className="space-y-1.5">
            {categories.slice(0, 6).map((c, i) => (
              <li key={i}>
                <Link to={c.href} className="text-sm text-ink/75 hover:text-coral">
                  {c.label}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {timeNote && (
        <p className="text-[11px] italic text-muted leading-relaxed">{timeNote}</p>
      )}
    </aside>
  )
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-line bg-paper p-4">
      {title && (
        <h3
          className="text-[11px] uppercase tracking-wide text-muted mb-2.5 font-semibold"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {title}
        </h3>
      )}
      {children}
    </div>
  )
}

function buildTimeNote(): string | null {
  const h = new Date().getHours()
  if (h < 6)  return '3 a.m. browsing — no judgement. Start slow.'
  if (h < 11) return 'Morning coffee and a quiet scroll — I love that for you.'
  if (h < 17) return "Afternoon shop. Take your time — I'm here if you need me."
  if (h < 22) return 'Evening picks tend to be the good ones.'
  return 'Late-night tab with good intentions. Take a peek ♥'
}
