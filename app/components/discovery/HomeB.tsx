/**
 * Variant B "Emma Asks" home page composition.
 *
 * Layout:
 *   DailyDealPill (fixed bottom-right)
 *   WelcomeBackBanner (full-width, above thread, when returning)
 *   EmmaThread:
 *     Intro bubble
 *     Q1 mood chips (always visible)
 *     Step >= 1: SaidPill row for mood + Q2 audience chips
 *     Step >= 2: SaidPill row for audience + Q3 matters chips
 *     Step >= 3: done bubble + full ProgressPips
 *   Results section (step === 3): Rails per category
 *
 * Step gating:
 *   - Step advances when the user toggles their FIRST chip in a group.
 *   - Skip advances step without setting chips.
 *   - Editing a SaidPill rewinds step to that question without clearing later selections.
 *
 * Uses useFetcher to GET /api/discovery and live-swap rails on state change.
 * On mount: trackHomeVariantView({ variant: 'b', hadPriorSession })
 */

import { useEffect, useRef } from 'react'
import { useFetcher } from 'react-router'
import { trackHomeVariantView } from '~/lib/analytics.client'
import type { Rail as RailType } from '~/types/discovery'
import type { ChipAvailabilityArrays } from '~/lib/discovery-emma'
import { emmaQuestions } from '~/lib/discovery-emma'
import { displayLabel } from '~/lib/discovery-tags'
import { DiscoveryProvider, useDiscovery } from '~/stores/discovery'
import { Chip } from './Chip'
import { Rail } from './Rail'
import { WelcomeBackBanner } from './WelcomeBackBanner'
import { EmmaBubble } from './EmmaBubble'
import { SaidPill } from './SaidPill'
import { ProgressPips } from './ProgressPips'
import { DailyDealPill } from './DailyDealPill'
import { EmmaThread } from './EmmaThread'
import type { Mood, Audience } from '~/types/discovery'

/* ── Match-percent helper ────────────────────────────────────────────────── */

/**
 * Express each rail's aggregate score as a percentage, capped at 99%.
 * The top rail anchors the scale — it always reads >= 80% so the display
 * feels meaningful rather than showing tiny raw integers.
 */
function computeMatchPct(rails: RailType[], totalChips: number): Map<string, number> {
  const result = new Map<string, number>()
  if (totalChips === 0) return result

  const maxScore = Math.max(...rails.map(r => r.score), 1)
  for (const rail of rails) {
    if (rail.score === 0) continue
    // Scale so top rail shows ~90%, others are proportional, cap at 99
    const raw = (rail.score / maxScore) * 90
    result.set(rail.category, Math.min(99, Math.round(raw)))
  }
  return result
}

/* ── Inner component (needs DiscoveryProvider in scope) ─────────────────── */

interface HomeBInnerProps {
  initialRails: RailType[]
  initialAvailable: ChipAvailabilityArrays
  deal: { title: string; handle: string } | null
  welcomeBackEnabled: boolean
  moods: string[]
  audiences: string[]
  matters: string[]
}

function HomeBInner({
  initialRails,
  initialAvailable,
  deal,
  welcomeBackEnabled,
  moods,
  audiences,
  matters: mattersVocab,
}: HomeBInnerProps) {
  const {
    state,
    toggleMood,
    toggleAudience,
    toggleMatters,
    advanceStep,
    resetToStep,
    hasPriorSession,
  } = useDiscovery()

  const fetcher = useFetcher<{
    rails: RailType[]
    total: number
    hasAny: boolean
    available: ChipAvailabilityArrays
  }>()

  const trackedRef = useRef(false)
  const prevStateRef = useRef<string>('')

  // Track variant view on mount (once)
  useEffect(() => {
    if (trackedRef.current) return
    trackedRef.current = true
    trackHomeVariantView({ variant: 'b', hadPriorSession: hasPriorSession })
  }, [])

  // Re-fetch rails on state change (after hydration)
  useEffect(() => {
    const key = JSON.stringify(state)
    if (key === prevStateRef.current) return
    prevStateRef.current = key

    const params = new URLSearchParams()
    for (const m of state.mood)     params.append('mood', m)
    for (const a of state.audience) params.append('audience', a)
    for (const k of state.matters)  params.append('matters', k)
    params.set('budget', String(state.budget))
    params.set('variant', 'b')

    fetcher.load(`/api/discovery?${params.toString()}`)
  }, [state])

  const activeRails: RailType[] = fetcher.data?.rails ?? initialRails
  const activeAvailable: ChipAvailabilityArrays = fetcher.data?.available ?? initialAvailable

  const totalChips = state.mood.length + state.audience.length + state.matters.length
  const matchPct = computeMatchPct(activeRails, totalChips)

  // Step-advancing chip toggle helpers.
  // First tap in a group advances step; subsequent taps in the same group stay put.
  function handleMoodToggle(value: string) {
    const wasEmpty = state.mood.length === 0
    toggleMood(value as Mood)
    if (wasEmpty && state.step === 0) advanceStep()
  }

  function handleAudienceToggle(value: string) {
    const wasEmpty = state.audience.length === 0
    toggleAudience(value as Audience)
    if (wasEmpty && state.step === 1) advanceStep()
  }

  function handleMattersToggle(value: string) {
    const wasEmpty = state.matters.length === 0
    toggleMatters(value)
    if (wasEmpty && state.step === 2) advanceStep()
  }

  // Skip handlers — advance without setting chips
  function skipMood() {
    if (state.step === 0) advanceStep()
  }
  function skipAudience() {
    if (state.step === 1) advanceStep()
  }
  function skipMatters() {
    if (state.step === 2) advanceStep()
  }

  // SaidPill clear — rewind to that question without clearing later answers
  function clearMood() {
    // Toggle off each selected mood chip
    for (const m of [...state.mood]) toggleMood(m as Mood)
    resetToStep(0)
  }
  function clearAudience() {
    for (const a of [...state.audience]) toggleAudience(a as Audience)
    resetToStep(1)
  }
  function clearMatters() {
    for (const k of [...state.matters]) toggleMatters(k)
    resetToStep(2)
  }

  // Available sets for faceting
  const availMoods     = new Set(activeAvailable.moods)
  const availAudiences = new Set(activeAvailable.audiences)
  const availMatters   = new Set(activeAvailable.matters)

  const introCopy = emmaQuestions.intro
  const moodCopy  = emmaQuestions.mood
  const audCopy   = emmaQuestions.audience(state.mood[0] as Mood | undefined)
  const matCopy   = emmaQuestions.matters(state.audience[0] as Audience | undefined)
  const doneCopy  = emmaQuestions.done(state.mood[0] as Mood | undefined, state.audience[0] as Audience | undefined)

  const visibleRails = activeRails.filter(r => r.items.length > 0)

  return (
    <>
      {/* Fixed floating deal pill */}
      <DailyDealPill deal={deal} />

      {/* Welcome-back banner above thread */}
      <WelcomeBackBanner welcomeBackEnabled={welcomeBackEnabled} />

      {/* Meta bar: Emma identity + progress pips */}
      <div className="max-w-2xl mx-auto px-4 pt-6 flex items-center gap-3">
        <img
          src="/emma.png"
          alt="Emma"
          width={32}
          height={32}
          className="rounded-full object-cover flex-none"
        />
        <div>
          <p
            className="text-base font-semibold text-ink italic leading-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Emma
          </p>
          <p
            className="text-[10px] uppercase tracking-widest text-muted"
            style={{ fontFamily: 'var(--font-body)', letterSpacing: '0.12em' }}
          >
            Your guide
          </p>
        </div>
        <div className="ml-auto">
          <ProgressPips step={state.step} />
        </div>
      </div>

      <EmmaThread>
        {/* ── Intro bubble ─────────────────────────────────────────────── */}
        <EmmaBubble from="emma" sub={introCopy.sub}>
          <h1
            className="text-3xl sm:text-4xl font-black leading-tight tracking-tight text-ink"
          >
            {introCopy.headline}
          </h1>
        </EmmaBubble>

        {/* ── Q1: mood ─────────────────────────────────────────────────── */}
        <EmmaBubble from="emma" sub={moodCopy.sub} muted={state.step >= 1 && state.mood.length > 0}>
          <p className="text-xl font-bold text-ink">{moodCopy.headline}</p>
        </EmmaBubble>

        <div className="flex flex-wrap gap-2 ml-10">
          {moods.map(value => {
            const isSelected = state.mood.includes(value)
            const isUnavail  = !isSelected && !availMoods.has(value) && availMoods.size > 0
            return (
              <Chip
                key={value}
                label={displayLabel(value)}
                on={isSelected}
                unavailable={isUnavail}
                onToggle={() => handleMoodToggle(value)}
                size="md"
              />
            )
          })}
          {state.step === 0 && (
            <button
              type="button"
              onClick={skipMood}
              className="text-xs text-muted underline underline-offset-2 hover:text-ink self-center px-1"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              skip for now
            </button>
          )}
        </div>

        {/* ── Step >= 1: mood said pills + Q2 ─────────────────────────── */}
        {state.step >= 1 && (
          <>
            {state.mood.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-end">
                {state.mood.map(m => (
                  <SaidPill key={m} label={displayLabel(m)} onClear={clearMood} />
                ))}
              </div>
            )}

            <EmmaBubble from="emma" sub={audCopy.sub} muted={state.step >= 2 && state.audience.length > 0}>
              <p className="text-xl font-bold text-ink">{audCopy.headline}</p>
            </EmmaBubble>

            <div className="flex flex-wrap gap-2 ml-10">
              {audiences.map(value => {
                const isSelected = state.audience.includes(value)
                const isUnavail  = !isSelected && !availAudiences.has(value) && availAudiences.size > 0
                return (
                  <Chip
                    key={value}
                    label={displayLabel(value)}
                    on={isSelected}
                    unavailable={isUnavail}
                    onToggle={() => handleAudienceToggle(value)}
                    size="md"
                  />
                )
              })}
              {state.step === 1 && (
                <button
                  type="button"
                  onClick={skipAudience}
                  className="text-xs text-muted underline underline-offset-2 hover:text-ink self-center px-1"
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  skip for now
                </button>
              )}
            </div>
          </>
        )}

        {/* ── Step >= 2: audience said pills + Q3 ─────────────────────── */}
        {state.step >= 2 && (
          <>
            {state.audience.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-end">
                {state.audience.map(a => (
                  <SaidPill key={a} label={displayLabel(a)} onClear={clearAudience} />
                ))}
              </div>
            )}

            <EmmaBubble from="emma" sub={matCopy.sub} muted={state.step >= 3 && state.matters.length > 0}>
              <p className="text-xl font-bold text-ink">{matCopy.headline}</p>
            </EmmaBubble>

            <div className="flex flex-wrap gap-2 ml-10">
              {mattersVocab.map(value => {
                const isSelected = state.matters.includes(value)
                const isUnavail  = !isSelected && !availMatters.has(value) && availMatters.size > 0
                return (
                  <Chip
                    key={value}
                    label={displayLabel(value)}
                    on={isSelected}
                    unavailable={isUnavail}
                    onToggle={() => handleMattersToggle(value)}
                    size="md"
                  />
                )
              })}
              {state.step === 2 && (
                <button
                  type="button"
                  onClick={skipMatters}
                  className="text-xs text-muted underline underline-offset-2 hover:text-ink self-center px-1"
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  skip for now
                </button>
              )}
            </div>
          </>
        )}

        {/* ── Step 3: matters said pills + done bubble ─────────────────── */}
        {state.step >= 3 && (
          <>
            {state.matters.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-end">
                {state.matters.map(k => (
                  <SaidPill key={k} label={displayLabel(k)} onClear={clearMatters} />
                ))}
              </div>
            )}

            <EmmaBubble from="emma" sub={doneCopy.sub}>
              <p className="text-xl font-bold text-ink">{doneCopy.headline}</p>
            </EmmaBubble>
          </>
        )}
      </EmmaThread>

      {/* ── Results: only when step === 3 ────────────────────────────────── */}
      {state.step >= 3 && (
        <div className="animate-in fade-in duration-500 border-t border-line">
          <div className="max-w-7xl mx-auto px-4 py-10">
            {/* Results header */}
            <div className="flex items-baseline gap-3 mb-8">
              <h2
                className="text-2xl font-black text-ink tracking-tight"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Shaped <em className="italic">for you</em>
              </h2>
              {fetcher.data?.total != null && (
                <span
                  className="text-xs uppercase tracking-widest text-muted"
                  style={{ fontFamily: 'var(--font-body)', letterSpacing: '0.12em' }}
                >
                  {fetcher.data.total} products
                </span>
              )}
            </div>

            {/* Rails */}
            <div className="flex flex-col gap-14">
              {visibleRails.map((rail, index) => {
                const pct = matchPct.get(rail.category)
                return (
                  <div key={rail.category}>
                    {/* Rail header with match indicator */}
                    <div className="flex items-baseline justify-between mb-1">
                      {pct != null && totalChips > 0 && (
                        <span
                          className="font-mono text-xs text-muted ml-auto"
                          aria-label={`${pct}% match`}
                        >
                          {pct}% match
                        </span>
                      )}
                    </div>
                    <Rail
                      rail={rail}
                      state={state}
                      cards={index === 0 ? 4 : 3}
                    />
                  </div>
                )
              })}

              {visibleRails.length === 0 && (
                <p
                  className="text-sm text-muted italic py-8 text-center"
                  style={{ fontFamily: 'var(--font-body)' }}
                >
                  Nothing quite fits that brief yet. Try clearing one answer above and the rails will reshape.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ── Props interface ─────────────────────────────────────────────────────── */

interface HomeBProps {
  rails: RailType[]
  total: number
  deal: { title: string; handle: string } | null
  welcomeBackEnabled: boolean
  moods:     string[]
  audiences: string[]
  matters:   string[]
  available: ChipAvailabilityArrays
}

/* ── Public export — wraps with DiscoveryProvider ───────────────────────── */

export function HomeB({ rails, deal, welcomeBackEnabled, moods, audiences, matters, available }: HomeBProps) {
  return (
    <DiscoveryProvider>
      <HomeBInner
        initialRails={rails}
        initialAvailable={available}
        deal={deal}
        welcomeBackEnabled={welcomeBackEnabled}
        moods={moods}
        audiences={audiences}
        matters={matters}
      />
    </DiscoveryProvider>
  )
}
