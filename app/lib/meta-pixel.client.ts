// Client-only Meta Pixel utilities.
// Uses .client.ts suffix so React Router tree-shakes this from server bundles.
// Never import from a .server.ts file.

declare global {
  interface Window {
    fbq: (
      command: string,
      eventOrAction: string,
      params?: Record<string, unknown>,
      opts?: { eventID?: string },
    ) => void
  }
}

interface FbContentParams {
  content_ids: string[]
  value: number
  currency: string
}

/**
 * Fire a ViewContent browser pixel event.
 * The eventId must match the one generated server-side so Meta deduplicates
 * the browser + CAPI pair into a single conversion.
 */
export function trackFbViewContent(params: FbContentParams, eventId: string): void {
  if (typeof window === 'undefined') return
  if (typeof window.fbq !== 'function') return
  window.fbq(
    'track',
    'ViewContent',
    {
      content_ids:  params.content_ids,
      content_type: 'product',
      value:        params.value,
      currency:     params.currency,
    },
    { eventID: eventId },
  )
}

/**
 * Fire a plain PageView. The storefront shell never fires one itself (the
 * pixel bootstrap in root.tsx only inits and queues), so the paid-lane bridge
 * page, whose whole job is to feed the pixel a landing view, calls this once
 * on mount. The bootstrap boots consent-revoked, so the queued event sends only
 * after the visitor grants consent, same as every other pixel event.
 */
export function trackFbPageView(): void {
  if (typeof window === 'undefined') return
  if (typeof window.fbq !== 'function') return
  window.fbq('track', 'PageView')
}

/**
 * Fire an AddToCart browser pixel event.
 * The eventId must match the one generated server-side so Meta deduplicates
 * the browser + CAPI pair into a single conversion.
 */
export function trackFbAddToCart(params: FbContentParams, eventId: string): void {
  if (typeof window === 'undefined') return
  if (typeof window.fbq !== 'function') return
  window.fbq(
    'track',
    'AddToCart',
    {
      content_ids:  params.content_ids,
      content_type: 'product',
      value:        params.value,
      currency:     params.currency,
    },
    { eventID: eventId },
  )
}
