/**
 * Emma sidekick — adaptive one-liner + Ask Emma CTA.
 *
 * Desktop (>= md): sticky right sidebar, 280px wide.
 * Mobile (< md): sticky bottom pill that expands on tap.
 *
 * "Ask Emma" opens the globally-mounted AskEmmaWidget seeded with a
 * first-person prompt built from the current selections.
 */

import { useEffect, useRef, useState } from 'react'
import { useRouteLoaderData } from 'react-router'
import { getEmmaLine } from '~/lib/discovery-emma'
import { trackEmmaLineSurface } from '~/lib/analytics.client'
import { useDiscovery } from '~/stores/discovery'
import { SIDEKICK_CTAS as CTA_LABELS, getAskEmmaSeedPrompt } from '~/lib/discovery-emma'
import type { DiscoveryState } from '~/types/discovery'
import type { EmmaPersona } from '~/types/cms'

// Derive analytics state label from DiscoveryState
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

export function EmmaSidekick() {
  const { state } = useDiscovery()
  const layoutData = useRouteLoaderData('routes/_layout') as { emmaPersona?: EmmaPersona | null } | undefined
  const emmaPersona = layoutData?.emmaPersona ?? null
  const avatarSrc = emmaPersona?.avatarUrl ?? '/emma.webp'
  const avatarAlt = emmaPersona?.avatarAlt || emmaPersona?.displayName || 'Emma'
  const displayName = emmaPersona?.displayName || 'Emma'
  const [mobileOpen, setMobileOpen] = useState(false)
  const line = getEmmaLine(state)
  const prevStateRef = useRef<typeof state>(state)

  // Track when Emma's category context changes
  useEffect(() => {
    const prev = prevStateRef.current
    const prevHasAny = prev.mood.length > 0 || prev.audience.length > 0 || prev.matters.length > 0
    const nextHasAny = state.mood.length > 0 || state.audience.length > 0 || state.matters.length > 0
    if (prevHasAny !== nextHasAny || analyticsState(prev) !== analyticsState(state)) {
      trackEmmaLineSurface({ state: analyticsState(state) })
    }
    prevStateRef.current = state
  }, [state.mood.length, state.audience.length, state.matters.length])

  // Open the globally-mounted AskEmmaWidget (in _layout.tsx) seeded with a
  // first-person prompt built from the current selections. The widget listens
  // for this event and auto-sends the prompt once it's open and idle. Close the
  // mobile pill first so it doesn't sit on top of the chat panel.
  function handleAskEmma() {
    if (typeof window === 'undefined') return
    setMobileOpen(false)
    window.dispatchEvent(
      new CustomEvent('xdipx:emma:openWith', { detail: { prompt: getAskEmmaSeedPrompt(state) } }),
    )
  }

  const inner = (
    <>
      {/* Avatar + name row — Style Guide §07 emma-card head:
          52px avatar with green status dot, italic serif name, mono micro role. */}
      <div className="flex items-center gap-3.5 mb-4">
        <div className="relative flex-none">
          <img
            src={avatarSrc}
            alt={avatarAlt}
            width={104}
            height={104}
            className="rounded-full object-cover block"
            style={{ width: 52, height: 52, boxShadow: '0 4px 12px rgba(26,20,24,.12)' }}
          />
          <span
            aria-hidden="true"
            className="absolute right-0 bottom-0 rounded-full"
            style={{
              width: 11,
              height: 11,
              background: '#4caf50',
              border: '2px solid var(--color-paper)',
            }}
          />
        </div>
        <div>
          <p
            className="text-ink leading-none"
            style={{
              fontFamily: 'var(--font-display)',
              fontStyle: 'italic',
              fontSize: '22px',
              letterSpacing: '-0.01em',
            }}
          >
            {displayName}
          </p>
          <p
            className="text-ink-3 mt-1"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
            }}
          >
            Your guide · online
          </p>
        </div>
      </div>

      {/* Adaptive one-liner — Style Guide §07: 19px italic serif, min-height
          ~96px so the card doesn't jump as her line grows. */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="text-ink-2 mb-4"
        style={{
          fontFamily: 'var(--font-display)',
          fontStyle: 'italic',
          fontSize: '19px',
          lineHeight: 1.4,
          minHeight: 96,
        }}
      >
        {line}
      </div>

      {/* CTA — Style Guide §06 button: ink-fill pill, the card's sole action. */}
      <div className="flex pt-3 border-t border-line">
        <button
          onClick={handleAskEmma}
          className="flex-1 px-4 py-2.5 rounded-full bg-ink text-paper text-[13px] font-medium hover:bg-plum-2 transition-colors"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          {CTA_LABELS.primary}
        </button>
      </div>
    </>
  )

  return (
    <>
      {/* Desktop sidebar — Style Guide §10: 340px column, 24px sticky top. */}
      <aside
        className="hidden md:block"
        style={{ position: 'sticky', top: 24, width: 340, flexShrink: 0 }}
      >
        <div className="bg-paper border border-line-2 rounded-[var(--radius-lg)] p-6">
          {inner}
        </div>
      </aside>

      {/* Mobile bottom pill */}
      <div
        className="md:hidden fixed bottom-4 inset-x-4 z-40"
        style={{ maxWidth: 480, margin: '0 auto' }}
      >
        {mobileOpen ? (
          <div className="bg-paper border border-line rounded-[var(--radius-lg)] p-5 shadow-lg">
            <button
              onClick={() => setMobileOpen(false)}
              className="float-right text-ink-3 text-xl leading-none mb-2"
              aria-label="Collapse Emma"
            >
              ×
            </button>
            {inner}
          </div>
        ) : (
          <button
            onClick={() => setMobileOpen(true)}
            className="w-full flex items-center gap-3 bg-paper border border-line rounded-full px-4 py-3 shadow-md"
          >
            <img
              src={avatarSrc}
              alt={avatarAlt}
              width={32}
              height={32}
              className="rounded-full object-cover"
              style={{ width: 32, height: 32 }}
            />
            <p
              className="text-sm text-ink/80 truncate text-left flex-1"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              {line}
            </p>
            <span className="text-ink-4 text-xs">tap ♥</span>
          </button>
        )}
      </div>
    </>
  )
}
