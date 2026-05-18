/**
 * Discovery rail — one top-level category.
 * Mobile: horizontal scroll with snap.
 * >= md: 3-col or 4-col grid based on cards prop.
 * Empty state: shows getRailEmptyLine() copy.
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useFetcher } from 'react-router'
import { getRailEmptyLine, railTitleSegments } from '~/lib/discovery-emma'
import type { DiscoveryState, Rail as RailType, ScoredProduct } from '~/types/discovery'
import { EMPTY_STATE } from '~/types/discovery'
import { ProductCard } from './ProductCard'

const RAIL_PAGE = 12

interface RailProps {
  rail: RailType
  state?: DiscoveryState
  cards?: 3 | 4
}

// Map top-level category → its PLP route slug.
const CATEGORY_SLUG: Record<string, string> = {
  Pleasure: 'pleasure',
  Play:     'play',
  Body:     'body',
  Wear:     'wear',
}

export function Rail({ rail, state = EMPTY_STATE, cards = 4 }: RailProps) {
  const segments = railTitleSegments(rail.category, state)
  const listId   = `discovery_${rail.category.toLowerCase()}`
  const listName = segments.map(s => s.text).join('')
  const slug     = CATEGORY_SLUG[rail.category]

  // "View more" pagination — appends additional pages of this rail without
  // refetching siblings. Reset when the parent re-feeds the SSR'd `rail`
  // (i.e. when chip selections change and HomeA gets a fresh response).
  const [extra, setExtra] = useState<ScoredProduct[]>([])
  const seedSig = `${rail.category}:${rail.items.length}:${rail.total}`
  const lastSeedRef = useRef(seedSig)
  if (lastSeedRef.current !== seedSig) {
    lastSeedRef.current = seedSig
    // Safe to setState during render when guarded — React batches it before
    // commit. Keeps extras in sync with parent state without an effect tick.
    setExtra([])
  }

  const fetcher = useFetcher<{ items: ScoredProduct[]; total: number; offset: number }>()
  const lastConsumedRef = useRef<number>(-1)
  const shown = rail.items.length + extra.length
  const canLoadMore = shown < rail.total
  const loading = fetcher.state !== 'idle'

  // Merge fetcher payloads into `extra` exactly once per response, keyed by
  // the returned offset so re-renders don't re-append.
  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return
    const { items, offset } = fetcher.data
    if (offset === lastConsumedRef.current) return
    lastConsumedRef.current = offset
    if (!items?.length) return
    setExtra(prev => {
      const have = new Set([...rail.items, ...prev].map(i => i.product.id))
      const fresh = items.filter(i => !have.has(i.product.id))
      return fresh.length ? [...prev, ...fresh] : prev
    })
  }, [fetcher.state, fetcher.data, rail.items])

  function loadMore() {
    const params = new URLSearchParams()
    for (const m of state.mood)     params.append('mood', m)
    for (const a of state.audience) params.append('audience', a)
    for (const k of state.matters)  params.append('matters', k)
    params.set('budget', String(state.budget))
    params.set('category', rail.category)
    params.set('offset', String(shown))
    params.set('limit', String(RAIL_PAGE))
    fetcher.load(`/api/discovery?${params.toString()}`)
  }

  return (
    <section aria-label={listName}>
      {/* Rail header — Style Guide §09: italic plum on variable segments,
          coral hairline underline on "See all" link. */}
      <header className="flex items-end justify-between gap-4 pb-4 mb-5 border-b border-line">
        <h2
          className="text-2xl md:text-[28px] text-ink leading-none tracking-[-0.02em]"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}
        >
          {segments.map((seg, i) =>
            seg.emphasized
              ? <em key={i} className="em">{seg.text}</em>
              : <span key={i}>{seg.text}</span>
          )}
        </h2>
        {slug && rail.items.length > 0 && (
          <Link
            to={`/collections/${slug}`}
            className="text-[13px] md:text-[15px] text-ink link-coral italic whitespace-nowrap hover:text-plum-2"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            See all in {rail.category} →
          </Link>
        )}
      </header>

      {rail.relaxed && rail.relaxedReason && (
        <p
          className="py-2 text-[14px] text-ink-3 italic"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {rail.relaxedReason}
        </p>
      )}

      {rail.items.length === 0 && !rail.relaxed ? (
        <div
          className="border border-dashed border-line-2 rounded-[var(--radius-md)] px-7 py-8 text-center text-ink-3"
          style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 18 }}
        >
          {getRailEmptyLine(rail.category)}
        </div>
      ) : rail.items.length > 0 ? (
        <>
          {/* Mobile: snap scroll — also the relaxed path when items > 0 */}
          <div
            className={`
              md:hidden
              flex gap-3 overflow-x-auto snap-x snap-mandatory
              pb-2 -mx-4 px-4
              scrollbar-none
            `}
            style={{ scrollbarWidth: 'none' }}
          >
            {[...rail.items, ...extra].map(({ product }, i) => (
              <div key={product.id} className="snap-start flex-none w-44">
                <ProductCard
                  product={product}
                  index={i}
                  listId={listId}
                  listName={listName}
                />
              </div>
            ))}
          </div>

          {/* Desktop: grid */}
          <div
            className={`
              hidden md:grid gap-4
              ${cards === 3 ? 'grid-cols-3' : 'grid-cols-4'}
            `}
          >
            {[...rail.items, ...extra].map(({ product }, i) => (
              <ProductCard
                key={product.id}
                product={product}
                index={i}
                listId={listId}
                listName={listName}
              />
            ))}
          </div>

          {/* View more — inline pagination. Loads the next page of THIS
              rail without refetching siblings. Hides when nothing left. */}
          {canLoadMore && (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loading}
                aria-busy={loading || undefined}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-line-2 text-[14px] text-ink hover:border-ink hover:text-plum-2 transition-colors disabled:opacity-60 disabled:cursor-wait"
                style={{ fontFamily: 'var(--font-body)', fontWeight: 500 }}
              >
                {loading
                  ? <>Loading more <em className="em not-italic" style={{ fontStyle: 'italic' }}>{rail.category}</em>…</>
                  : <>View more in <em className="em not-italic" style={{ fontStyle: 'italic' }}>{rail.category}</em> <span aria-hidden="true">↓</span></>}
              </button>
            </div>
          )}
        </>
      ) : null}
    </section>
  )
}
