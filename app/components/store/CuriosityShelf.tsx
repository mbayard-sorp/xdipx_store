/**
 * Nº 07 · The Curiosity Shelf — the homepage discovery band.
 *
 * One question, one row of named appetites (the pills), and a shelf of six real
 * products underneath that restocks in place when you touch it. Replacement for
 * the Sensation Map; see docs/homepage-team/discovery-band-redesign-spec.md.
 *
 * The single most important property: THIS COMPONENT DOES NOT FETCH. Every lane
 * arrives fully resolved in the SSR payload, so selecting a lane is local
 * `useState` over data already in memory — no `useFetcher`, no `useEffect` data
 * fetch, no `/api/*` round trip, no rate limit, no error path. There is no way
 * for a tap to flip a pill without changing the products (the "feels broken"
 * defect this redesign retires).
 *
 * Design follows docs/design-doctrine.md: plum-soft ground, one coral element
 * (the selected pill's ring + dot), Newsreader H2 with a single plum italic word,
 * the shelf as a fixed six-slot grid (zero CLS), and Reveal for scroll entrance
 * only — the in-place restock is the CSS `.shelf-restock` crossfade, not a
 * Reveal. Reduced motion renders the final state with no animation.
 */

import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router'
import { StorefrontProductCard } from '~/components/store/StorefrontProductCard'
import { Reveal } from '~/components/motion/Reveal'
import { SHELF_SLOTS } from '~/types/curiosity'
import type { CuriosityShelfData, ResolvedLane } from '~/types/curiosity'

const MONO = { fontFamily: 'var(--font-mono)' } as const
const DISPLAY = { fontFamily: 'var(--font-display)', fontWeight: 400 } as const
const BODY = { fontFamily: 'var(--font-body)' } as const

/** Split a heading into [before, emphasis, after] when the emphasis word occurs. */
function splitEmphasis(heading: string, emphasis: string): [string, string, string] | null {
  if (!emphasis) return null
  const i = heading.indexOf(emphasis)
  if (i < 0) return null
  return [heading.slice(0, i), emphasis, heading.slice(i + emphasis.length)]
}

/** page0 = deck[0..5]; page1 = deck[6..11] when the lane shipped a full deck. */
function pageSlice(lane: ResolvedLane, page: number) {
  return lane.deck.slice(page * SHELF_SLOTS, page * SHELF_SLOTS + SHELF_SLOTS)
}
function hasSecondPage(lane: ResolvedLane): boolean {
  return lane.deck.length >= SHELF_SLOTS * 2
}

export function CuriosityShelf({ data }: { data: CuriosityShelfData }) {
  const { lanes, eyebrow, heading, emphasis, emmaLine, defaultLane } = data
  const [sel, setSel] = useState({ lane: Math.min(defaultLane, lanes.length - 1), page: 0 })
  // `interacted` gates the restock crossfade: the server renders the final state,
  // and cards only animate once the visitor actually changes the shelf.
  const [interacted, setInteracted] = useState(false)
  const [announce, setAnnounce] = useState('')
  const pillRefs = useRef<(HTMLButtonElement | null)[]>([])
  const warmed = useRef(false)

  const lane = lanes[sel.lane]!
  const cards = pageSlice(lane, sel.page)
  const emphasisParts = splitEmphasis(heading, emphasis)

  // Warm page-2 imagery on first interaction (idle), so a reshuffle never waits on
  // the network. Fixed-aspect card frames mean a late image fills in with no CLS.
  const warmPageTwo = useCallback(() => {
    if (warmed.current || typeof window === 'undefined') return
    warmed.current = true
    const run = () => {
      for (const l of lanes) {
        for (const p of pageSlice(l, 1)) {
          if (p.imageUrl) {
            const img = new Image()
            img.src = p.imageUrl
          }
        }
      }
    }
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
    if (ric) ric(run)
    else window.setTimeout(run, 200)
  }, [lanes])

  const selectLane = useCallback(
    (next: number, focus = false) => {
      const idx = ((next % lanes.length) + lanes.length) % lanes.length
      setInteracted(true)
      setSel({ lane: idx, page: 0 })
      setAnnounce('Six picks.')
      if (focus) pillRefs.current[idx]?.focus()
    },
    [lanes.length],
  )

  const reshuffle = useCallback(() => {
    setInteracted(true)
    setSel(s => {
      const nextPage = hasSecondPage(lane) ? (s.page + 1) % 2 : 0
      setAnnounce(nextPage === 0 ? `Back to the first six under ${lane.label}.` : 'Six more.')
      return { lane: s.lane, page: nextPage }
    })
  }, [lane])

  function onPillKeyDown(e: React.KeyboardEvent, i: number) {
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        selectLane(i - 1, true)
        break
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        selectLane(i + 1, true)
        break
      case 'Home':
        e.preventDefault()
        selectLane(0, true)
        break
      case 'End':
        e.preventDefault()
        selectLane(lanes.length - 1, true)
        break
    }
  }

  return (
    <section className="bg-plum-soft py-16 md:py-20">
      <div className="mx-auto max-w-[1320px] px-6 md:px-16">
        {/* Heading + pills: a 5/7 split on lg — question left, choices right. */}
        <div className="lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-12">
          <Reveal variant="up" className="mb-7 max-w-[46ch] lg:mb-0">
            <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-plum" style={MONO}>
              Nº 07 · {eyebrow}
            </p>
            <h2
              className="text-[1.9rem] leading-[1.1] tracking-[-0.01em] text-ink md:text-[2.9rem] lg:max-w-[18ch]"
              style={DISPLAY}
            >
              {emphasisParts ? (
                <>
                  {emphasisParts[0]}
                  <em className="em">{emphasisParts[1]}</em>
                  {emphasisParts[2]}
                </>
              ) : (
                heading
              )}
            </h2>
            <p className="mt-5 text-[16.5px] leading-relaxed text-ink-3" style={BODY}>
              {emmaLine}
            </p>
          </Reveal>

          <div>
            <Reveal variant="fade" delay={0.06}>
              <div
                role="radiogroup"
                aria-label={heading}
                className="flex flex-wrap gap-2 [touch-action:manipulation]"
              >
                {lanes.map((l, i) => {
                  const active = i === sel.lane
                  return (
                    <button
                      key={l.key}
                      ref={el => {
                        pillRefs.current[i] = el
                      }}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      tabIndex={active ? 0 : -1}
                      onKeyDown={e => onPillKeyDown(e, i)}
                      onFocus={warmPageTwo}
                      onClick={() => selectLane(i)}
                      className={[
                        'inline-flex min-h-[44px] items-center gap-2 rounded-[var(--radius-lg)] px-[18px] py-3 text-[15px] font-medium transition-colors',
                        'transition-transform duration-[var(--duration-fast)] ease-[var(--ease-standard)] active:scale-[0.97]',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-plum-soft',
                        active
                          ? 'bg-paper text-ink ring-[1.5px] ring-coral'
                          : 'border border-line bg-transparent text-ink-3 hover:border-line-2 hover:text-ink',
                      ].join(' ')}
                      style={BODY}
                    >
                      {active && (
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 rounded-full bg-coral"
                        />
                      )}
                      {l.label}
                    </button>
                  )
                })}
              </div>
            </Reveal>

            {/* Emma's lane line, the single aria-live region. The visually-hidden
                suffix announces the change without reading six product names. */}
            <p
              className="mt-6 text-[1.15rem] italic text-ink-3 lg:mt-8"
              style={DISPLAY}
              aria-live="polite"
            >
              <span className="mr-1 not-italic text-sage" aria-hidden="true">
                ♥
              </span>
              {lane.emmaLine}
              <span className="sr-only"> {announce}</span>
            </p>
          </div>
        </div>

        {/* The shelf: a fixed six-slot grid. 2-up at 375px, 3-up md, 6-up lg. */}
        <Reveal variant="fade" className="mt-7 md:mt-9">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-6">
            {cards.map((p, i) => (
              <div
                key={`${lane.key}:${sel.page}:${p.id}`}
                className={interacted ? 'shelf-restock' : undefined}
                style={interacted ? ({ '--i': i } as React.CSSProperties) : undefined}
              >
                <StorefrontProductCard product={p} fluid />
              </div>
            ))}
          </div>
        </Reveal>

        {/* Footer: reshuffle (left) + see-all (right). Reshuffle only when the
            lane shipped a genuine second page, so it can never be a no-op; the
            See-all renders only when the lane resolved a verified destination
            (mission brief §1: no silent best-sellers fallback). The whole row is
            skipped when the lane has neither, so it is never an empty rule. */}
        {(hasSecondPage(lane) || lane.seeAllHref) && (
          <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
            {hasSecondPage(lane) ? (
              <button
                type="button"
                onClick={reshuffle}
                className="group inline-flex min-h-[44px] items-center gap-2 rounded-[var(--radius-lg)] border border-line-2 px-5 text-[15px] font-medium text-ink transition-colors hover:border-ink active:scale-[0.97]"
                style={BODY}
              >
                <svg
                  aria-hidden="true"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="transition-transform duration-[var(--duration-fast)] group-active:rotate-180"
                >
                  <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                  <path d="M21 3v5h-5" />
                </svg>
                Show me another six
              </button>
            ) : (
              <span />
            )}
            {lane.seeAllHref && (
              <Link
                to={lane.seeAllHref}
                className="inline-flex items-center gap-1.5 text-[15px] font-medium text-ink transition-colors hover:text-plum"
                style={BODY}
              >
                See the full fit <span aria-hidden="true">→</span>
              </Link>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
