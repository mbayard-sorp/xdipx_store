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
      // Ticket #15385: design-critic found this banner covering real hero
      // content on first paint at both ends of the viewport range, with no
      // stored consent choice (i.e. almost every first session) — at 375px
      // the homepage hero's "Where do you want to start?" chip row, at
      // 1440px the hero's sensation-dial readout (HeroSensationDial,
      // StorefrontHome.tsx) plus AskEmmaWidget's floating launcher.
      //
      // Mobile bottom offset is now a small fixed margin, not a tab-bar
      // clearance: the `:has()` rule in app.css hides the mobile tab bar
      // (and AskEmmaWidget's launcher) while this dialog is in the DOM, so
      // there is nothing left down there to clear. That rule is also *why*
      // this banner had to shrink: measured live, the chip row's own bottom
      // sits only ~72px above where the tab bar used to start, which is
      // less room than a two-button banner needs at any reasonable size, so
      // the fix reclaims that space rather than resizing the hero around
      // it. z-[57] still sits above the tab bar (55) and MobileExploreMenu's
      // own category flyout dialog (56) as a fallback for the instant
      // between this component mounting and the CSS rule applying; see the
      // z-index scale note in app.css.
      //
      // Desktop bottom offset clears the dial, which sits at the bottom of
      // the tall right-column product image: measured live, the dial's own
      // top sits ~65px above a plain `md:bottom-4`. The dial's x-range never
      // overlaps the text column (CTAs, chip row) the mobile fix targets, so
      // this offset only has to clear the one thing on its own side.
      //
      // No entrance animation: this is a client-only overlay that can only
      // appear after hydration, and a fade-in makes its pixels keep CHANGING
      // for the animation's duration, which Speed Index integrates as churn.
      // Rendering it in its final state in a single frame turns that into
      // one settled change instead of an animated one. It is fixed-position,
      // so it never shifts layout (CLS stays 0).
      className="fixed bottom-[calc(16px+env(safe-area-inset-bottom))] left-4 right-4 md:bottom-24 md:left-auto md:right-6 md:max-w-sm z-[57] bg-ink text-white rounded-2xl p-2 shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="Cookie consent"
    >
      <p className="text-xs leading-tight mb-1 text-white/80">
        We use cookies to improve your experience.{' '}
        <a href="/pages/privacy-policy" className="underline text-white/60 hover:text-white">Privacy policy</a>
      </p>
      <div className="flex gap-2">
        {/* Ink/white, not coral: the coral budget reserves it for one primary
            action per viewport, and this banner can be on screen alongside
            the hero CTA (ticket #8418, design-critic run 778). Solid white
            still reads as the primary of the two buttons against bg-ink. */}
        <button
          ref={firstButtonRef}
          onClick={() => accept('all')}
          /* Doctrine §2 assigns CTA text to DM Sans (`font-body`); Newsreader
             is headlines, pull-quotes and italic emphasis. This button set its
             label in the display serif while its own sibling two lines down,
             and every other button on the page, uses body — so it inherits the
             body family now and the override is gone (design-critic gate, run
             1571, ticket #16878). The same finding was already fixed once on
             the rail See-all in run 1162; this was the remaining CTA on the
             storefront in the serif.

             NOT changed here, and deliberately: the gate also found this
             button's pure-white-on-ink fill is the highest-contrast element in
             the first viewport, out-weighting the coral hero CTA. That one is
             not a type-family slip with one right answer — "Accept all" solid
             against "Essential only" translucent is the prominence asymmetry
             regulators read as a consent dark pattern, so evening them out is a
             legal/brand judgment reserved to the owner, not a design cycle's to
             ship unilaterally. Raised for a ruling instead (run 1703). */
          className="flex-1 bg-white text-ink text-sm font-bold py-0.5 rounded-full hover:opacity-90 transition-opacity"
        >
          Accept all
        </button>
        <button
          onClick={() => accept('essential_only')}
          className="flex-1 bg-white/15 text-white text-sm font-medium py-0.5 rounded-full hover:bg-white/25 transition-colors"
        >
          Essential only
        </button>
      </div>
    </div>
  )
}
