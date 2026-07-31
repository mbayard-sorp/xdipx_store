import { useEffect, useMemo, useRef } from 'react'
import { useFetcher, useNavigate, useRouteLoaderData, useSearchParams } from 'react-router'
import { useSession } from '~/lib/session-context'
import type { DiscoveryCandidate, DiscoveryResult } from '~/lib/emma-discovery.server'
import type { EmmaPersona } from '~/types/cms'

interface EmmaDiscoveryRailProps {
  surface:     'search' | 'collection'
  query?:      string
  collection?: string
  candidates:  DiscoveryCandidate[]
  recentViews?: string[]
  /** Called when Emma's starred picks change so the grid can highlight tiles. */
  onStarredChange?: (starred: Record<string, string>) => void
  className?: string
}

const ACTIVE_PARAM_KEYS = ['mood', 'audience', 'matters', 'budgetMax'] as const

function useActiveFilters() {
  const [params] = useSearchParams()
  return useMemo(() => ({
    moods:     params.getAll('mood'),
    audiences: params.getAll('audience'),
    matters:   params.getAll('matters'),
    budgetMax: params.get('budgetMax') ? Number(params.get('budgetMax')) : null,
  }), [params])
}

export function EmmaDiscoveryRail({
  surface,
  query = '',
  collection,
  candidates,
  recentViews = [],
  onStarredChange,
  className,
}: EmmaDiscoveryRailProps) {
  const { customerFirstName } = useSession()
  const layoutData = useRouteLoaderData('routes/_layout') as { emmaPersona?: EmmaPersona | null } | undefined
  const emmaPersona = layoutData?.emmaPersona ?? null
  const activeFilters = useActiveFilters()
  const fetcher = useFetcher<DiscoveryResult>()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const lastKeyRef = useRef<string>('')

  // Stable key representing the current request so we only POST when it changes.
  const requestKey = useMemo(() => {
    const topHandles = candidates.slice(0, 12).map(c => c.handle).join(',')
    return JSON.stringify({
      surface,
      collection: collection ?? '',
      query: query.trim().toLowerCase(),
      moods: [...activeFilters.moods].sort(),
      audiences: [...activeFilters.audiences].sort(),
      matters: [...activeFilters.matters].sort(),
      budgetMax: activeFilters.budgetMax,
      topHandles,
      recentViews: recentViews.slice(0, 5),
      firstName: customerFirstName ?? '',
    })
  }, [surface, collection, query, activeFilters, candidates, recentViews, customerFirstName])

  useEffect(() => {
    if (requestKey === lastKeyRef.current) return
    if (candidates.length === 0) return
    lastKeyRef.current = requestKey

    fetcher.submit(
      JSON.stringify({
        surface,
        query,
        collection,
        filters: activeFilters,
        firstName: customerFirstName ?? null,
        recentViews: recentViews.slice(0, 10),
        candidates: candidates.slice(0, 20).map(c => ({
          handle: c.handle,
          title:  c.title,
          vendor: c.vendor ?? null,
          price:  c.price ?? null,
          tags:   c.tags ?? [],
          mattersTags: c.mattersTags ?? [],
          moodTags:    c.moodTags ?? [],
        })),
      }),
      { method: 'post', action: '/api/emma-discovery', encType: 'application/json' },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])

  // Error responses (e.g. 429) don't have the DiscoveryResult shape — treat
  // them as "no data" so the rail degrades to its fallback copy instead of
  // crashing on `.length` reads.
  const raw = fetcher.data as DiscoveryResult | { error?: string } | undefined
  const data = raw && Array.isArray((raw as DiscoveryResult).starredHandles)
    ? (raw as DiscoveryResult)
    : undefined
  const loading = fetcher.state !== 'idle' && !data

  useEffect(() => {
    if (!onStarredChange) return
    if (!data?.starredHandles) {
      onStarredChange({})
      return
    }
    const map: Record<string, string> = {}
    for (const s of data.starredHandles) map[s.handle] = s.reason
    onStarredChange(map)
  }, [data, onStarredChange])

  function applyRefinement(refinement: { label: string; params: Record<string, string | number> }) {
    const next = new URLSearchParams(params)
    for (const k of ACTIVE_PARAM_KEYS) next.delete(k)
    for (const [k, v] of Object.entries(refinement.params)) {
      if (k === 'q') {
        if (typeof v === 'string' && v) next.set('q', v)
      } else if (k === 'budgetMax') {
        next.set('budgetMax', String(v))
      } else if (k === 'mood' || k === 'audience' || k === 'matters') {
        next.append(k, String(v))
      }
    }
    next.delete('page')
    const suffix = next.toString()
    const base = surface === 'search'
      ? '/search'
      : `/collections/${collection ?? ''}`
    navigate(suffix ? `${base}?${suffix}` : base, { preventScrollReset: true })
  }

  const greeting =
    data?.greeting ??
    (customerFirstName ? `Hey ${customerFirstName}, quick note` : 'Hey friend, quick note')

  const narrator = data?.narrator ?? (loading ? '' : 'Settling in. I\'ll star anything good.')

  const showRecent = recentViews.length > 0

  return (
    <aside
      className={[
        'w-full md:w-[220px] md:shrink-0',
        'rounded-2xl border border-line bg-paper/70 backdrop-blur-sm',
        'p-4 text-sm text-ink/80',
        className ?? '',
      ].join(' ')}
      aria-label="Emma's discovery rail"
    >
      <div>
        {/* Avatar + greeting + narrator
            - Mobile: salutation as title; avatar (left) — text (right)
            - Desktop: existing centered column with avatar above greeting */}
        {/* MOBILE LAYOUT */}
        <div className="md:hidden mb-3">
          <p
            className="text-xs uppercase tracking-wider text-coral font-semibold mb-2"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {greeting}
          </p>
          <div className="flex items-start gap-3">
            {emmaPersona?.avatarUrl ? (
              <img
                src={emmaPersona.avatarUrl}
                alt={emmaPersona.avatarAlt || emmaPersona.displayName || 'Emma'}
                width={48}
                height={48}
                className="w-12 h-12 rounded-full object-cover ring-2 ring-coral/30 shrink-0"
                loading="lazy"
              />
            ) : (
              <div
                className="w-12 h-12 rounded-full bg-coral text-paper flex items-center justify-center font-bold text-base ring-2 ring-coral/30 shrink-0"
                style={{ fontFamily: 'var(--font-display)' }}
                aria-hidden="true"
              >
                E
              </div>
            )}
            <div className="flex-1 min-w-0">
              {loading && !data ? (
                <div className="space-y-2">
                  <div className="h-3 rounded bg-cream-2 animate-pulse" />
                  <div className="h-3 w-3/4 rounded bg-cream-2 animate-pulse" />
                </div>
              ) : (
                <p className="text-ink text-sm leading-snug">{narrator}</p>
              )}
            </div>
          </div>
        </div>

        {/* DESKTOP LAYOUT */}
        <div className="hidden md:block">
          <div className="flex flex-col items-center mb-3">
            {emmaPersona?.avatarUrl ? (
              <img
                src={emmaPersona.avatarUrl}
                alt={emmaPersona.avatarAlt || emmaPersona.displayName || 'Emma'}
                width={56}
                height={56}
                className="w-14 h-14 rounded-full object-cover ring-2 ring-coral/30 mb-2"
                loading="lazy"
              />
            ) : (
              <div
                className="w-14 h-14 rounded-full bg-coral text-paper flex items-center justify-center font-bold text-lg ring-2 ring-coral/30 mb-2"
                style={{ fontFamily: 'var(--font-display)' }}
                aria-hidden="true"
              >
                E
              </div>
            )}
            <p
              className="text-xs uppercase tracking-wider text-coral font-semibold text-center"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {greeting}
            </p>
          </div>
          <div className="mb-3">
            {loading && !data ? (
              <div className="space-y-2">
                <div className="h-3 rounded bg-cream-2 animate-pulse" />
                <div className="h-3 w-3/4 rounded bg-cream-2 animate-pulse" />
              </div>
            ) : (
              <p className="text-ink text-sm leading-snug">{narrator}</p>
            )}
          </div>
        </div>

        {data && data.didYouMean.length > 0 && (
          <div className="mb-3">
            <p className="text-[11px] uppercase tracking-wider text-muted mb-1.5">
              Did you mean
            </p>
            <ul className="space-y-1">
              {data.didYouMean.map((r, i) => (
                <li key={`dym-${i}`}>
                  <button
                    type="button"
                    onClick={() => applyRefinement(r)}
                    className="text-sage text-xs hover:underline underline-offset-2"
                  >
                    {r.label} →
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {showRecent && (
          <div className="mb-3">
            <p className="text-[11px] uppercase tracking-wider text-muted mb-1.5">
              You looked at
            </p>
            <ul className="space-y-1 text-xs text-ink/70">
              {recentViews.slice(0, 3).map(handle => (
                <li key={`rv-${handle}`} className="truncate">
                  <a
                    href={`/products/${handle}`}
                    className="hover:text-coral"
                  >
                    ♥ {handle.replace(/-/g, ' ')}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {data && data.refinements.length > 0 && (
          <div className="mt-3 pt-3 border-t border-line">
            <p className="text-[11px] uppercase tracking-wider text-muted mb-1.5">
              Curated for you, by me
            </p>
            {data.refinementsNote && (
              <p className="text-[11px] italic text-ink/70 leading-snug mb-2">
                {data.refinementsNote}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {data.refinements.map((r, i) => (
                <button
                  key={`ref-${i}`}
                  type="button"
                  onClick={() => applyRefinement(r)}
                  className="px-2.5 py-1 rounded-full text-xs bg-cream-2 hover:bg-coral hover:text-paper transition-colors border border-line"
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
