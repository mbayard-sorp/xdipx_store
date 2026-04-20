'use client'

import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import {
  trackPageView,
  updateConsent,
  setUserProperties,
} from '~/lib/analytics.client'
import { useSession } from '~/lib/session-context'

const CONSENT_KEY = 'xdipx_consent'

interface AnalyticsProps {
  ga4Id: string
}

export function Analytics({ ga4Id }: AnalyticsProps) {
  const location = useLocation()
  const prevPath = useRef('')
  const { isCustomerLoggedIn, customerIdHash, isLoaded } = useSession()

  // ── Check existing consent on mount ─────────────────────────────────────
  useEffect(() => {
    if (!ga4Id) return
    try {
      const stored = localStorage.getItem(CONSENT_KEY)
      if (stored) {
        const { type } = JSON.parse(stored) as { type: string }
        updateConsent(type === 'all')
      }
    } catch { /* ignore parse errors */ }
  }, [ga4Id])

  // ── Listen for consent updates from CookieConsent ───────────────────────
  useEffect(() => {
    if (!ga4Id) return
    function onConsentUpdate() {
      try {
        const stored = localStorage.getItem(CONSENT_KEY)
        if (stored) {
          const { type } = JSON.parse(stored) as { type: string }
          updateConsent(type === 'all')
        }
      } catch { /* ignore */ }
    }
    window.addEventListener('xdipx:consent-update', onConsentUpdate)
    return () => window.removeEventListener('xdipx:consent-update', onConsentUpdate)
  }, [ga4Id])

  // ── SPA page view tracking ──────────────────────────────────────────────
  useEffect(() => {
    if (!ga4Id) return
    const path = location.pathname + location.search
    if (path !== prevPath.current) {
      prevPath.current = path
      trackPageView(path)
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
