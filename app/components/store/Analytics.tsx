'use client'

import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import {
  trackPageView,
  updateConsent,
  setUserProperties,
} from '~/lib/analytics.client'
import { buildPageLocation } from '~/lib/ga4-page-location'
import { useSession } from '~/lib/session-context'

const CONSENT_KEY = 'xdipx_consent'

interface AnalyticsProps {
  ga4Id: string
}

export function Analytics({ ga4Id }: AnalyticsProps) {
  const location = useLocation()
  const prevPath = useRef('')
  const consentGranted = useRef(false)
  const { isCustomerLoggedIn, customerIdHash, isLoaded } = useSession()

  // ── Check existing consent on mount ─────────────────────────────────────
  useEffect(() => {
    if (!ga4Id) return
    try {
      const stored = localStorage.getItem(CONSENT_KEY)
      if (stored) {
        const { type } = JSON.parse(stored) as { type: string }
        const granted = type === 'all'
        updateConsent(granted)
        consentGranted.current = granted
      }
    } catch { /* ignore parse errors */ }
  }, [ga4Id])

  // ── Listen for consent updates from CookieConsent ───────────────────────
  useEffect(() => {
    if (!ga4Id) return
    function onConsentUpdate() {
      try {
        const stored = localStorage.getItem(CONSENT_KEY)
        if (!stored) return
        const { type } = JSON.parse(stored) as { type: string }
        const granted = type === 'all'
        const wasDenied = !consentGranted.current
        updateConsent(granted)
        consentGranted.current = granted
        // Consent flipped denied → granted: re-fire page_view for current path,
        // since the initial page_view was dropped while consent was denied.
        if (granted && wasDenied) {
          trackPageView(buildPageLocation(window.location.origin, location.pathname, location.search))
        }
      } catch { /* ignore */ }
    }
    window.addEventListener('xdipx:consent-update', onConsentUpdate)
    return () => window.removeEventListener('xdipx:consent-update', onConsentUpdate)
  }, [ga4Id, location.pathname, location.search])

  // ── SPA page view tracking ──────────────────────────────────────────────
  useEffect(() => {
    if (!ga4Id) return
    const path = location.pathname + location.search
    if (path !== prevPath.current) {
      prevPath.current = path
      trackPageView(buildPageLocation(window.location.origin, location.pathname, location.search))
    }
  }, [ga4Id, location.pathname, location.search])

  // ── User properties — wait for session to resolve so we don't log
  //    "logged_in: false" on the first pageview for a logged-in user.
  useEffect(() => {
    if (!ga4Id || !isLoaded) return
    setUserProperties({
      logged_in: isCustomerLoggedIn,
      ...(customerIdHash ? { customer_id_hash: customerIdHash } : {}),
    })
  }, [ga4Id, isLoaded, isCustomerLoggedIn, customerIdHash])

  return null
}
