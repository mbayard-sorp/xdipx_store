/**
 * Emma sidekick — adaptive one-liner + CTAs.
 *
 * Desktop (>= md): sticky right sidebar, 280px wide.
 * Mobile (< md): sticky bottom pill that expands on tap.
 *
 * "Ask Emma" links to /emma-chat if the route exists; otherwise disabled
 * with title="Coming soon".
 * "Save my picks" writes state to localStorage and shows an ephemeral toast.
 */

import { useEffect, useRef, useState } from 'react'
import { getEmmaLine } from '~/lib/discovery-emma'
import { trackEmmaLineSurface } from '~/lib/analytics.client'
import { saveDiscoveryPicks, useDiscovery } from '~/stores/discovery'
import { SIDEKICK_CTAS as CTA_LABELS } from '~/lib/discovery-emma'
import type { DiscoveryState } from '~/types/discovery'

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
  const [mobileOpen, setMobileOpen] = useState(false)
  const [toastVisible, setToastVisible] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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

  function handleSavePicks() {
    saveDiscoveryPicks(state)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToastVisible(true)
    toastTimer.current = setTimeout(() => setToastVisible(false), 2500)
  }

  const inner = (
    <>
      {/* Avatar + name row */}
      <div className="flex items-center gap-3 mb-4">
        <img
          src="/emma.png"
          alt="Emma"
          width={88}
          height={88}
          className="rounded-full object-cover flex-none"
          style={{ width: 56, height: 56 }}
        />
        <div>
          <p className="font-bold text-ink text-base leading-tight" style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic' }}>
            Emma
          </p>
          <p className="text-xs text-muted" style={{ fontFamily: 'var(--font-body)' }}>
            Your editorial guide ♥
          </p>
        </div>
      </div>

      {/* Adaptive one-liner */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="text-sm text-ink/80 leading-relaxed mb-5"
        style={{ fontFamily: 'var(--font-body)' }}
      >
        {line}
      </div>

      {/* CTAs */}
      <div className="flex flex-col gap-2">
        <button
          disabled
          title="Coming soon"
          className="w-full px-4 py-2.5 rounded-full bg-cream-2 text-ink/40 text-sm font-semibold border border-line cursor-not-allowed"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {CTA_LABELS.primary}
        </button>
        <button
          onClick={handleSavePicks}
          className="w-full px-4 py-2.5 rounded-full bg-coral text-paper text-sm font-semibold hover:bg-coral-2 transition-colors"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {CTA_LABELS.secondary}
        </button>
      </div>

      {/* Save toast */}
      {toastVisible && (
        <p
          role="status"
          aria-live="polite"
          className="mt-3 text-xs text-sage text-center"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          Picks saved. ♥
        </p>
      )}
    </>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className="hidden md:block"
        style={{ position: 'sticky', top: 24, width: 280, flexShrink: 0 }}
      >
        <div className="bg-paper border border-line rounded-[var(--radius-lg)] p-6 shadow-sm">
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
              className="float-right text-muted text-xl leading-none mb-2"
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
              src="/emma.png"
              alt="Emma"
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
            <span className="text-muted text-xs">tap ♥</span>
          </button>
        )}
      </div>
    </>
  )
}
