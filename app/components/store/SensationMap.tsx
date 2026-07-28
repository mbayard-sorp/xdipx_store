/**
 * Nº 07 · The Sensation Map — an on-page discovery instrument.
 *
 * The visitor turns two dials, Type and Feel, and Emma maps the choice, live, to
 * a few real products, each a `/products/{handle}` link. It teaches a small
 * vocabulary for preference while moving straight toward product. v1 reuses the
 * live discovery index + scoring; it invents no taxonomy (docs/homepage-team/
 * concepts/sensation-map.md).
 *
 * Design follows docs/design-doctrine.md (doctrine wins over the concept wire on
 * visual calls):
 *  - Ground: plum-soft full-band tint (plum = guided discovery).
 *  - Coral budget: the selected Type notch is the ONE coral element in the band.
 *    Feel-active = sage. The "See the full fit" link is a quiet ink→plum text
 *    link, not coral.
 *  - Feel dial ships as NAMED mood segments (not a fake continuous slider) —
 *    honest to tags that carry no ordering.
 *  - Motion / zero-CLS: the heading group is one Reveal; the instrument SSRs its
 *    default matched set (no empty-then-fill flash); a dial change cross-fades
 *    the fixed-dimension result cards (opacity only) so nothing reflows.
 *
 * RR7: the default set comes from the loader; dial re-queries go through a
 * useFetcher to /api/sensation-map — never a useEffect fetch.
 *
 * Copy note: Emma strings here are written to the voice charter (no em-dashes,
 * AI guide with no lived experience, CTA/whitelist-safe) and route through the
 * emma-empathy-reviewer voice gate before merge.
 */

import { useState } from 'react'
import { Link, useFetcher } from 'react-router'
import { StorefrontProductCard } from '~/components/store/StorefrontProductCard'
import { Reveal } from '~/components/motion/Reveal'
import { TYPE_LABELS, type SensationDialState, type SensationMatch, type TypeNotch } from '~/lib/sensation-map'
import type { ProductTypeDial } from '~/types'

const MONO = { fontFamily: 'var(--font-mono)' } as const
const DISPLAY = { fontFamily: 'var(--font-display)', fontWeight: 400 } as const
const BODY = { fontFamily: 'var(--font-body)' } as const

/**
 * Verified collection handles only (checked live against
 * https://xdipx.com/sitemaps/collections.xml, each returns 200); everything
 * else resolves to best-sellers so the "See the full fit" link never 404s.
 *
 * `novelty`, `book-media`, and `sex-machine` have no matching live collection
 * (only brand-named collections like `curve-novelties`/`ns-novelties` for
 * novelty, and `sex-furniture` is a distinct category from "sex machine") and
 * stay on the best-sellers fallback.
 */
const TYPE_COLLECTION: Partial<Record<ProductTypeDial, string>> = {
  vibrator:    '/collections/vibrators',
  dildo:       '/collections/dildos',
  anal:        '/collections/anal',
  bondage:     '/collections/all-bondage',
  'cock-ring': '/collections/cock-rings',
  stroker:     '/collections/strokers',
  couples:     '/collections/couples',
  harness:     '/collections/strap-on-harnesses',
  extender:    '/collections/pumps-extenders',
  pump:        '/collections/penis-pumps',
  lube:        '/collections/lubricants',
  massage:     '/collections/massage-mood',
  enhancer:    '/collections/enhancers-arousal',
  wear:        '/collections/wear',
  condom:      '/collections/condoms',
  wellness:    '/collections/wellness-care',
}
function fullFitHref(type: ProductTypeDial): string {
  return TYPE_COLLECTION[type] ?? '/collections/best-sellers'
}

function emmaLine(typeLabel: string, feel: string | null, relaxed: boolean): string {
  const feelPhrase = feel ? `, on the ${feel.toLowerCase()} side` : ''
  const tail = relaxed
    ? 'Here is the closest fit.'
    : feel
      ? 'A few that fit, closest first.'
      : 'A few that fit.'
  return `${typeLabel}${feelPhrase}. ${tail}`
}

interface SensationMapProps {
  types: TypeNotch[]
  feels: string[]
  /** Non-null: the parent only renders the band when the index has products. */
  defaultState: SensationDialState
  defaultMatch: SensationMatch
}

export function SensationMap({ types, feels, defaultState, defaultMatch }: SensationMapProps) {
  const [state, setState] = useState<SensationDialState>(defaultState)
  const fetcher = useFetcher<SensationMatch>()

  // Show the fetched set once it arrives; the SSR default until then. During a
  // re-query fetcher.data still holds the previous set, which cross-fades out.
  const match: SensationMatch = fetcher.data?.items ? fetcher.data : defaultMatch
  const loading = fetcher.state !== 'idle'

  function select(next: SensationDialState) {
    setState(next)
    const params = new URLSearchParams({ type: next.type })
    if (next.feel) params.set('feel', next.feel)
    fetcher.load(`/api/sensation-map?${params.toString()}`)
  }

  const resolvedLabel = TYPE_LABELS[match.resolved.type] ?? match.resolved.type

  return (
    <section className="bg-plum-soft py-16 md:py-20">
      <div className="mx-auto max-w-[1320px] px-6 md:px-16">
        <Reveal variant="up" className="mb-9 max-w-[48ch]">
          <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>Nº 07</p>
          <p className="mb-3.5 text-[11px] uppercase tracking-[0.18em] text-plum" style={MONO}>Find your feel</p>
          <h2 className="text-[1.9rem] leading-[1.1] tracking-[-0.01em] text-ink md:text-[2.9rem]" style={DISPLAY}>
            What are you <em className="em">curious</em> about?
          </h2>
          <p className="mt-5 text-[16.5px] leading-relaxed text-ink-3" style={BODY}>
            Two quick dials, and I'll narrow it to a few that fit.
          </p>
        </Reveal>

        <div className="md:grid md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:items-start md:gap-12">
          {/* Left column — the instrument */}
          <div className="mb-8 md:mb-0">
            {/* Dial A · Type — the one coral element in the band.
                min-w-0 defeats <fieldset>'s default min-width:min-content so the
                inner overflow-x-auto row clips instead of overflowing the page. */}
            <fieldset className="min-w-0">
              <legend className="mb-3 text-[11px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>
                Dial A · Type
              </legend>
              <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {types.map(t => {
                  const active = state.type === t.value
                  return (
                    <button
                      key={t.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => select({ type: t.value, feel: state.feel })}
                      className={[
                        'flex-none snap-start whitespace-nowrap rounded-full px-[18px] py-2.5 text-[14px] font-medium transition-colors',
                        active
                          ? 'bg-coral text-white'
                          : 'border border-line bg-paper text-ink hover:bg-paper-2',
                      ].join(' ')}
                      style={BODY}
                    >
                      {t.label}
                    </button>
                  )
                })}
              </div>
            </fieldset>

            {/* Dial B · Feel — named mood segments, sage active */}
            {feels.length > 0 && (
              <fieldset className="mt-5 min-w-0">
                <legend className="mb-3 text-[11px] uppercase tracking-[0.18em] text-ink-4" style={MONO}>
                  Dial B · Feel
                </legend>
                <div className="flex flex-wrap gap-2">
                  <FeelChip label="Any" active={state.feel === null} onClick={() => select({ type: state.type, feel: null })} />
                  {feels.map(f => (
                    <FeelChip
                      key={f}
                      label={f}
                      active={state.feel === f}
                      onClick={() => select({ type: state.type, feel: f })}
                    />
                  ))}
                </div>
              </fieldset>
            )}

            {/* Emma's read on the current dial state */}
            <p className="mt-6 text-[1.05rem] italic text-sage" style={DISPLAY} aria-live="polite">
              <span className="mr-1 not-italic" aria-hidden="true">♥</span>
              {emmaLine(resolvedLabel, match.resolved.feel, match.relaxed)}
            </p>
          </div>

          {/* Right column — the payoff: real, clickable product */}
          <div>
            <div
              className={[
                '-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 transition-opacity duration-[var(--duration-base)] ease-[var(--ease-standard)]',
                '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
                loading ? 'opacity-60' : 'opacity-100',
              ].join(' ')}
              aria-busy={loading}
            >
              {match.items.map(p => (
                <div key={p.id} className="w-[44%] shrink-0 snap-start sm:w-[200px]">
                  <StorefrontProductCard product={p} fluid />
                </div>
              ))}
            </div>

            <Link
              to={fullFitHref(state.type)}
              className="mt-5 inline-flex items-center gap-1.5 text-[15px] font-medium text-ink transition-colors hover:text-plum"
              style={BODY}
            >
              See the full fit <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

function FeelChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={[
        'rounded-full px-4 py-2 text-[14px] font-medium transition-colors',
        active
          ? 'bg-sage text-white'
          : 'border border-line bg-paper text-ink-3 hover:text-ink',
      ].join(' ')}
      style={BODY}
    >
      {label}
    </button>
  )
}
