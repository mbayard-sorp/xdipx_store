/**
 * Variant A "The Compass" home page composition.
 *
 * Layout:
 *   DailyDealStrip (full width)
 *   WelcomeBackBanner (full width)
 *   Grid:
 *     Left col: H1 + ChipGroups + BudgetSlider + Rails
 *     Right col (>= md): EmmaSidekick (sticky)
 *
 * Uses useFetcher to POST DiscoveryState to /api/discovery and swap rails
 * without a full navigation. Falls back to SSR rails on first render.
 *
 * On mount: trackHomeVariantView({ variant: 'a', hadPriorSession })
 */

import { useEffect, useRef } from 'react'
import { useFetcher } from 'react-router'
import { trackHomeVariantView } from '~/lib/analytics.client'
import type { Rail as RailType } from '~/types/discovery'
import { DiscoveryProvider, useDiscovery } from '~/stores/discovery'
import { ChipGroup } from './ChipGroup'
import { BudgetSlider } from './BudgetSlider'
import { Rail } from './Rail'
import { EmmaSidekick } from './EmmaSidekick'
import { DailyDealStrip } from './DailyDealStrip'
import { WelcomeBackBanner } from './WelcomeBackBanner'
import { DEFAULT_BUDGET } from '~/types/discovery'

interface HomeAProps {
  rails: RailType[]
  total: number
  deal: { title: string; handle: string } | null
  welcomeBackEnabled: boolean
  /** Chip vocabularies sourced from Shopify metafields (24h cached). */
  moods:     string[]
  audiences: string[]
  matters:   string[]
}

/* ── Inner component (needs DiscoveryProvider in scope) ─────────────────── */

interface InnerProps {
  initialRails: RailType[]
  deal: { title: string; handle: string } | null
  welcomeBackEnabled: boolean
  moods:     string[]
  audiences: string[]
  matters:   string[]
}

function HomeAInner({ initialRails, deal, welcomeBackEnabled, moods, audiences, matters: mattersVocab }: InnerProps) {
  const { state, toggleMood, toggleAudience, toggleMatters, setBudget, clearAll, hasPriorSession } =
    useDiscovery()

  const fetcher = useFetcher<{ rails: RailType[]; total: number; hasAny: boolean }>()
  const trackedRef = useRef(false)

  // Active rails: prefer fetcher data when fresh, else SSR initial
  const activeRails: RailType[] = fetcher.data?.rails ?? initialRails

  // Track variant view on mount (once)
  useEffect(() => {
    if (trackedRef.current) return
    trackedRef.current = true
    trackHomeVariantView({ variant: 'a', hadPriorSession: hasPriorSession })
  }, [])

  // Re-fetch rails whenever state changes (after hydration)
  const prevStateRef = useRef<string>('')
  useEffect(() => {
    const key = JSON.stringify(state)
    if (key === prevStateRef.current) return
    prevStateRef.current = key

    const params = new URLSearchParams()
    for (const m of state.mood)     params.append('mood', m)
    for (const a of state.audience) params.append('audience', a)
    for (const k of state.matters)  params.append('matters', k)
    params.set('budget', String(state.budget))
    params.set('variant', 'a')

    fetcher.load(`/api/discovery?${params.toString()}`)
  }, [state])

  const hasSelections =
    state.mood.length > 0 || state.audience.length > 0 || state.matters.length > 0

  return (
    <>
      <DailyDealStrip deal={deal} />
      <WelcomeBackBanner welcomeBackEnabled={welcomeBackEnabled} />

      <div className="max-w-7xl mx-auto px-4 py-8 md:py-12">
        <div className="flex gap-10 items-start">
          {/* ── Left column ─────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0">

            {/* Hero headline */}
            <div className="mb-8">
              <h1
                className="text-4xl md:text-6xl font-black text-ink leading-tight tracking-tight mb-2"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Find you in
                <br />
                <em className="italic text-coral not-italic" style={{ fontStyle: 'italic' }}>
                  a product.
                </em>
              </h1>
              <p
                className="text-base text-muted leading-relaxed max-w-md"
                style={{ fontFamily: 'var(--font-body)' }}
              >
                Tap anything that calls to you. No wrong answers.
              </p>
            </div>

            {/* Chip groups */}
            <div className="flex flex-col gap-6 mb-6">
              {moods.length > 0 && (
                <ChipGroup
                  label="Mood"
                  group="mood"
                  values={moods}
                  selected={state.mood}
                  onToggle={v => toggleMood(v)}
                />
              )}
              {audiences.length > 0 && (
                <ChipGroup
                  label="For"
                  group="audience"
                  values={audiences}
                  selected={state.audience}
                  onToggle={v => toggleAudience(v)}
                />
              )}
              {mattersVocab.length > 0 && (
                <ChipGroup
                  label="What matters"
                  group="matters"
                  values={mattersVocab}
                  selected={state.matters}
                  onToggle={v => toggleMatters(v)}
                />
              )}
            </div>

            {/* Budget slider */}
            <div className="mb-6 max-w-sm">
              <BudgetSlider
                value={state.budget === DEFAULT_BUDGET ? null : state.budget}
                onChange={v => setBudget(v ?? DEFAULT_BUDGET)}
              />
            </div>

            {/* Clear all */}
            {hasSelections && (
              <button
                onClick={clearAll}
                className="text-xs text-muted underline underline-offset-2 hover:text-ink mb-8"
                style={{ fontFamily: 'var(--font-body)' }}
              >
                Clear all
              </button>
            )}

            {/* Divider */}
            <div className="border-t border-line mb-8" />

            {/* Rails */}
            <div className="flex flex-col gap-12">
              {activeRails.map(rail => (
                <Rail
                  key={rail.category}
                  rail={rail}
                  state={state}
                  cards={4}
                />
              ))}
            </div>
          </div>

          {/* ── Right column: Emma sidekick (desktop only) ───────────────── */}
          <EmmaSidekick />
        </div>
      </div>
    </>
  )
}

/* ── Public export — wraps with DiscoveryProvider ───────────────────────── */

export function HomeA({ rails, deal, welcomeBackEnabled, moods, audiences, matters }: HomeAProps) {
  return (
    <DiscoveryProvider>
      <HomeAInner
        initialRails={rails}
        deal={deal}
        welcomeBackEnabled={welcomeBackEnabled}
        moods={moods}
        audiences={audiences}
        matters={matters}
      />
    </DiscoveryProvider>
  )
}
