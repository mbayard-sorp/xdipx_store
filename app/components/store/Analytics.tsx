'use client'

import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import {
  trackPageView,
  updateConsent,
  setUserProperties,
} from '~/lib/analytics.client'

const CONSENT_KEY = 'xdipx_consent'

interface AnalyticsProps {
  ga4Id: string
  isLoggedIn: boolean
  customerIdHash?: string
}

export function Analytics({ ga4Id, isLoggedIn, customerIdHash }: AnalyticsProps) {
  const location = useLocation()
  const prevPath = useRef('')

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

  // ── User properties ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!ga4Id) return
    setUserProperties({
      logged_in: isLoggedIn,
      ...(customerIdHash ? { customer_id_hash: customerIdHash } : {}),
    })
  }, [ga4Id, isLoggedIn, customerIdHash])

  return null
}
