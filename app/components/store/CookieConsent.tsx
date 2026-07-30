'use client'

import { useEffect, useRef, useState } from 'react'

const CONSENT_KEY     = 'xdipx_consent'
const POLICY_VERSION  = '1.0'

export function CookieConsent() {
  const [visible, setVisible] = useState(false)
  const firstButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const stored = localStorage.getItem(CONSENT_KEY)
    if (!stored) setVisible(true)
  }, [])

  // WCAG 4.1.2: this is a dialog, so focus should move into it on open
  // rather than leaving it stranded behind the mobile nav.
  useEffect(() => {
    if (visible) firstButtonRef.current?.focus()
  }, [visible])

  function accept(type: 'all' | 'essential_only') {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ type, version: POLICY_VERSION, ts: Date.now() }))
    setVisible(false)

    // Notify Analytics component of consent change
    window.dispatchEvent(new CustomEvent('xdipx:consent-update'))

    // Fire consent log to API (non-blocking)
    fetch('/api/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id:     crypto.randomUUID(),
        consent_type:   type,
        policy_version: POLICY_VERSION,
      }),
    }).catch(() => {/* non-critical */})
  }

  if (!visible) return null

  return (
    <div
      // bottom offset clears the fixed mobile tab bar (56px + safe-area,
      // see MobileExploreMenu z-[55]) with an 16px gap, instead of the old
      // bottom-4 which sat the card's own buttons half behind the nav.
      // z-[56] sits just above the tab bar so the banner (and its buttons)
      // are never occluded; see the z-index scale note in app.css.
      className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] left-4 right-4 md:bottom-4 md:left-auto md:right-6 md:max-w-sm z-[56] bg-ink text-white rounded-2xl p-5 shadow-2xl fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="Cookie consent"
    >
      <p className="text-sm leading-relaxed mb-4 text-white/80">
        We use cookies to remember your preferences and improve your experience.{' '}
        <a href="/pages/privacy-policy" className="underline text-white/60 hover:text-white">Privacy policy</a>
      </p>
      <div className="flex gap-2">
        <button
          ref={firstButtonRef}
          onClick={() => accept('all')}
          className="flex-1 bg-coral text-white text-sm font-bold py-2 rounded-full hover:opacity-90 transition-opacity"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Accept all
        </button>
        <button
          onClick={() => accept('essential_only')}
          className="flex-1 bg-white/15 text-white text-sm font-medium py-2 rounded-full hover:bg-white/25 transition-colors"
        >
          Essential only
        </button>
      </div>
    </div>
  )
}
