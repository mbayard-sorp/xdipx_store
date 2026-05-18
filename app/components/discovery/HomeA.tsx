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
import type { ChipAvailabilityArrays } from '~/lib/discovery-emma'
import { EMMA_LINES } from '~/lib/discovery-emma'
import { DiscoveryProvider, useDiscovery } from '~/stores/discovery'
import { ChipGroup } from './ChipGroup'
import { BudgetSlider } from './BudgetSlider'
import { Rail } from './Rail'
import { EmmaSidekick } from './EmmaSidekick'
import { EmmaChatPanel } from './EmmaChatPanel'
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
  /** Which chip values still yield ≥1 product under the SSR (empty) state. */
  available: ChipAvailabilityArrays
  /** When true, render EmmaChatPanel in place of EmmaSidekick. Sourced from HOME_EMMA_CHAT env flag via loader. */
  emmaChatEnabled?: boolean
}

/* ── Inner component (needs DiscoveryProvider in scope) ─────────────────── */

interface InnerProps {
  initialRails: RailType[]
  initialAvailable: ChipAvailabilityArrays
  deal: { title: string; handle: string } | null
  welcomeBackEnabled: boolean
  moods:     string[]
  audiences: string[]
  matters:   string[]
  emmaChatEnabled: boolean
}

function HomeAInner({ initialRails, initialAvailable, deal, welcomeBackEnabled, moods, audiences, matters: mattersVocab, emmaChatEnabled }: InnerProps) {
  const { state, toggleMood, toggleAudience, toggleMatters, setBudget, clearAll, hasPriorSession } =
    useDiscovery()

  const fetcher = useFetcher<{ rails: RailType[]; total: number; hasAny: boolean; available: ChipAvailabilityArrays }>()
  const trackedRef = useRef(false)

  // Active rails + availability: prefer fetcher data when fresh, else SSR initial
  const activeRails: RailType[] = fetcher.data?.rails ?? initialRails
  const activeAvailable: ChipAvailabilityArrays = fetcher.data?.available ?? initialAvailable

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

      <div className="max-w-[1320px] mx-auto px-6 md:px-10 py-8 md:py-14">
        {/* Hero grid: left = headline + filters, right = sticky Emma (340px). */}
        <div className="flex gap-8 md:gap-14 items-start">
          {/* ── Left column ─────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0">

            {/* Hero headline — Style Guide Nº 01 §03: "Find you in a product."
                Mono "Discovery, Vol. I" kicker above; H1 wraps "Find you in /
                a product." with italic-plum on you and a hand-drawn coral
                squiggle beneath it. */}
            <div className="mb-10 md:mb-14">
              <p
                className="text-[10px] uppercase tracking-[0.18em] text-ink-3 mb-6"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                Discovery, Vol. <span className="text-coral font-medium">I</span>
              </p>
              <h1
                className="text-5xl md:text-7xl text-ink leading-[0.95] tracking-[-0.03em] mb-5"
                style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}
              >
                Find{' '}
                <span className="relative inline-block">
                  <em className="em">you</em>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 200 18"
                    preserveAspectRatio="none"
                    className="absolute left-0 right-0 pointer-events-none"
                    style={{ bottom: '-0.18em', width: '100%', height: '0.32em' }}
                  >
                    <path
                      d="M4,12 C40,2 80,18 120,8 S180,12 196,9"
                      fill="none"
                      stroke="var(--color-coral)"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>{' '}
                in
                <br />
                a product.
              </h1>
              <p
                className="text-base text-ink-2 leading-relaxed max-w-[460px]"
                style={{ fontFamily: 'var(--font-body)' }}
              >
                {EMMA_LINES.heroLede}
              </p>
            </div>

            {/* Chip groups — each gets a rich header row per Style Guide §06:
                mono numeric kicker + serif label with italic emphasis word
                + light hint on the right. */}
            <div className="flex flex-col gap-8 mb-10">
              {moods.length > 0 && (
                <FilterBlock
                  num="01"
                  label={<>A <em className="em">mood</em> or sensation</>}
                  hint="Tap any. Multiple is fine."
                >
                  <ChipGroup
                    label="Mood"
                    group="mood"
                    values={moods}
                    selected={state.mood}
                    available={activeAvailable.moods}
                    hideLabel
                    showAvailability={hasSelections}
                    onToggle={v => toggleMood(v)}
                  />
                </FilterBlock>
              )}
              {audiences.length > 0 && (
                <FilterBlock
                  num="02"
                  label={<>Who's it <em className="em">for</em></>}
                  hint="Optional. Pick a few if it helps narrow."
                >
                  <ChipGroup
                    label="Audience"
                    group="audience"
                    values={audiences}
                    selected={state.audience}
                    available={activeAvailable.audiences}
                    hideLabel
                    showAvailability={hasSelections}
                    onToggle={v => toggleAudience(v)}
                  />
                </FilterBlock>
              )}
              {mattersVocab.length > 0 && (
                <FilterBlock
                  num="03"
                  label={<>What <em className="em">matters</em> most</>}
                  hint="Optional. Pick a few if it helps narrow."
                >
                  <ChipGroup
                    label="What matters"
                    group="matters"
                    values={mattersVocab}
                    selected={state.matters}
                    available={activeAvailable.matters}
                    hideLabel
                    showAvailability={hasSelections}
                    onToggle={v => toggleMatters(v)}
                  />
                </FilterBlock>
              )}
            </div>

            {/* Budget panel — Style Guide §10: labeled "Budget (last)" with
                italic plum emphasis on the "(last)". Slider stays compact;
                "Clear all" hairline link sits beside it. */}
            <div className="mb-12 flex items-center gap-6 flex-wrap">
              <div className="flex items-center gap-4 flex-1 min-w-[260px] max-w-sm">
                <p
                  className="text-[15px] text-ink whitespace-nowrap"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Budget <em className="em">(last)</em>
                </p>
                <div className="flex-1">
                  <BudgetSlider
                    value={state.budget === DEFAULT_BUDGET ? null : state.budget}
                    onChange={v => setBudget(v ?? DEFAULT_BUDGET)}
                  />
                </div>
              </div>
              {hasSelections && (
                <button
                  onClick={clearAll}
                  className="text-[13px] text-ink link-coral hover:text-plum-2"
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  Clear all
                </button>
              )}
            </div>

            {/* Rails section — Style Guide §09: "Shaped for you" header with
                a mono "X of Y" count and "Reordered by relevance ↓" note. */}
            <div className="border-t border-line-2 pt-10">
              <header className="flex items-end justify-between mb-8 flex-wrap gap-4">
                <h2
                  className="text-3xl md:text-4xl text-ink leading-none tracking-[-0.025em]"
                  style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}
                >
                  Shaped <em className="em">for you</em>
                </h2>
                <p
                  className="text-[10px] uppercase tracking-[0.18em] text-ink-3"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  {hasSelections
                    ? <>Reordered by relevance <span className="text-coral">↓</span></>
                    : 'Pick anything to reshape'}
                </p>
              </header>
              <div className="flex flex-col gap-14">
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
          </div>

          {/* ── Right column: Emma sidekick or chat panel (desktop only) ── */}
          {emmaChatEnabled
            ? <EmmaChatPanel />
            : <EmmaSidekick />}
        </div>
      </div>
    </>
  )
}

/* ── FilterBlock — rich header row for each filter group ────────────────── */

interface FilterBlockProps {
  num: string
  label: React.ReactNode
  hint: string
  children: React.ReactNode
}

function FilterBlock({ num, label, hint, children }: FilterBlockProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div className="flex items-baseline gap-4">
          <span
            className="text-[10px] uppercase tracking-[0.18em] text-coral font-medium"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {num}
          </span>
          <p
            className="text-lg md:text-xl text-ink leading-none"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}
          >
            {label}
          </p>
        </div>
        <p
          className="text-[12px] text-ink-3 italic"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {hint}
        </p>
      </div>
      {children}
    </div>
  )
}

/* ── Public export — wraps with DiscoveryProvider ───────────────────────── */

export function HomeA({ rails, deal, welcomeBackEnabled, moods, audiences, matters, available, emmaChatEnabled }: HomeAProps) {
  return (
    <DiscoveryProvider>
      <HomeAInner
        initialRails={rails}
        initialAvailable={available}
        deal={deal}
        welcomeBackEnabled={welcomeBackEnabled}
        moods={moods}
        audiences={audiences}
        matters={matters}
        emmaChatEnabled={emmaChatEnabled ?? false}
      />
    </DiscoveryProvider>
  )
}
