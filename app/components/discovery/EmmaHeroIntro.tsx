/**
 * Emma's hero presence — avatar + combined greeting/lede + Ask Emma CTA.
 *
 * Sits in the hero left column under the H1 (replaces the old sticky
 * right-sidebar EmmaSidekick, which crowded the layout). Her message merges
 * the intro greeting with the page lede; once the visitor starts selecting
 * chips it switches to Emma's adaptive contextual line.
 *
 * "Ask Emma" opens the globally-mounted AskEmmaWidget seeded with a
 * first-person prompt built from the current selections.
 */

import { useEffect, useRef } from 'react'
import { useRouteLoaderData } from 'react-router'
import { EMMA_LINES, getEmmaLine, getAskEmmaSeedPrompt, SIDEKICK_CTAS } from '~/lib/discovery-emma'
import { trackEmmaLineSurface } from '~/lib/analytics.client'
import { useDiscovery } from '~/stores/discovery'
import type { DiscoveryState } from '~/types/discovery'
import type { EmmaPersona } from '~/types/cms'

// Derive analytics state label from DiscoveryState.
function analyticsState(s: DiscoveryState): Parameters<typeof trackEmmaLineSurface>[0]['state'] {
  const hasM = s.mood.length > 0
  const hasA = s.audience.length > 0
  const hasK = s.matters.length > 0
  if (hasM && hasA && hasK) return 'full'
  if (hasM && hasA)         return 'mood-audience'
  if (hasM && hasK)         return 'mood-matters'
  if (hasA && hasK)         return 'audience-matters'
  if (hasM)                 return 'mood-only'
  if (hasA)                 return 'audience-only'
  if (hasK)                 return 'matters-only'
  return 'intro'
}

export function EmmaHeroIntro() {
  const { state } = useDiscovery()
  const layoutData = useRouteLoaderData('routes/_layout') as { emmaPersona?: EmmaPersona | null } | undefined
  const emmaPersona = layoutData?.emmaPersona ?? null
  const avatarSrc = emmaPersona?.avatarUrl ?? '/emma.png'
  const avatarAlt = emmaPersona?.avatarAlt || emmaPersona?.displayName || 'Emma'
  const displayName = emmaPersona?.displayName || 'Emma'

  const hasSelections =
    state.mood.length > 0 || state.audience.length > 0 || state.matters.length > 0
  // Empty state: the combined greeting + lede. Once a brief is forming, swap
  // to Emma's adaptive contextual line so she still reacts to selections.
  const message = hasSelections ? getEmmaLine(state) : EMMA_LINES.heroIntro

  // Track when Emma's surfaced context changes (mirrors the old sidekick).
  const prevStateRef = useRef<typeof state>(state)
  useEffect(() => {
    const prev = prevStateRef.current
    const prevHasAny = prev.mood.length > 0 || prev.audience.length > 0 || prev.matters.length > 0
    const nextHasAny = state.mood.length > 0 || state.audience.length > 0 || state.matters.length > 0
    if (prevHasAny !== nextHasAny || analyticsState(prev) !== analyticsState(state)) {
      trackEmmaLineSurface({ state: analyticsState(state) })
    }
    prevStateRef.current = state
  }, [state.mood.length, state.audience.length, state.matters.length])

  function handleAskEmma() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent('xdipx:emma:openWith', { detail: { prompt: getAskEmmaSeedPrompt(state) } }),
    )
  }

  return (
    <div className="max-w-[600px]">
      <div className="flex items-start gap-4">
        <div className="relative flex-none">
          <img
            src={avatarSrc}
            alt={avatarAlt}
            width={112}
            height={112}
            className="rounded-full object-cover block"
            style={{ width: 56, height: 56, boxShadow: '0 4px 12px rgba(26,20,24,.12)' }}
          />
          <span
            aria-hidden="true"
            className="absolute right-0 bottom-0 rounded-full"
            style={{ width: 12, height: 12, background: '#4caf50', border: '2px solid var(--color-paper)' }}
          />
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 mb-1.5">
            <span
              className="text-ink leading-none"
              style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 19, letterSpacing: '-0.01em' }}
            >
              {displayName}
            </span>
            <span
              className="text-ink-3"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' }}
            >
              Your guide
            </span>
          </div>
          <p
            aria-live="polite"
            aria-atomic="true"
            className="text-base text-ink-2 leading-relaxed"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            {message}
          </p>
        </div>
      </div>
      <button
        onClick={handleAskEmma}
        className="mt-4 inline-flex px-5 py-2.5 rounded-full bg-ink text-paper text-[13px] font-medium hover:bg-plum-2 transition-colors"
        style={{ fontFamily: 'var(--font-body)' }}
      >
        {SIDEKICK_CTAS.primary}
      </button>
    </div>
  )
}
