// Client-only Meta Pixel utilities.
// Uses .client.ts suffix so React Router tree-shakes this from server bundles.
// Never import from a .server.ts file. Call these from effects only: on the
// server every export here is stubbed out.

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
 * The store's own automation, which must never reach the dataset. Playwright,
 * Puppeteer and Selenium all set navigator.webdriver; the browser checkout
 * probe also carries the xdipx_synthetic cookie (capi-eligibility.server.ts
 * SYNTHETIC_COOKIE), which the server checks on its side.
 */
export function isSyntheticBrowser(): boolean {
  if (typeof window === 'undefined') return true
  try {
    if (navigator.webdriver === true) return true
    return /(?:^|;\s*)xdipx_synthetic=1(?:;|$)/.test(document.cookie)
  } catch {
    return false
  }
}

function newEventId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function beacon(payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload)
  try {
    if (typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon('/api/meta-event', new Blob([body], { type: 'application/json' }))) return
    }
  } catch { /* fall back to fetch */ }
  fetch('/api/meta-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
    credentials: 'same-origin',
  }).catch(() => { /* analytics never breaks the page */ })
}

/**
 * Fire a browser pixel event AND its server (CAPI) copy under one event id,
 * so Meta keeps one of the pair.
 *
 * The fbq call is queued by the stub in root.tsx and only reaches Meta once
 * the visitor accepts marketing cookies (the pixel boots consent-revoked). The
 * beacon goes to /api/meta-event immediately, which is what makes a visitor
 * who never touches the banner count at all. Before this, the dataset held
 * zero browser events of any kind (measured 2026-10-20).
 */
export function trackMetaEvent(
  name: 'PageView' | 'ViewContent',
  params?: { content_ids: string[]; content_type: 'product'; value: number; currency: string },
): string | null {
  if (typeof window === 'undefined') return null
  if (isSyntheticBrowser()) return null
  const eventId = newEventId()
  if (typeof window.fbq === 'function') {
    window.fbq('track', name, params ?? {}, { eventID: eventId })
  }
  beacon({
    event_name: name,
    event_id: eventId,
    event_source_url: window.location.href,
    ...(params ? { custom_data: params } : {}),
  })
  return eventId
}

/**
 * `gid://shopify/Product/123` -> `123`. The catalog feed and the CAPI
 * Purchase both use the numeric id, so ViewContent and AddToCart must too or
 * Meta cannot join a view to the product it bought.
 */
export function numericProductId(id: string): string {
  return id.split('/').pop() || id
}

/** ViewContent for a product page: browser pixel plus server copy, one id. */
export function trackFbViewContent(params: FbContentParams): string | null {
  return trackMetaEvent('ViewContent', {
    content_ids:  params.content_ids.map(numericProductId),
    content_type: 'product',
    value:        params.value,
    currency:     params.currency,
  })
}

/** PageView: browser pixel plus server copy, one id. */
export function trackFbPageView(): string | null {
  return trackMetaEvent('PageView')
}

/**
 * Fire a Lead browser pixel event for a captured signup. The eventId comes
 * from the server's CAPI Lead so Meta counts the pair once.
 */
export function trackFbLead(contentName: string, eventId: string): void {
  if (typeof window === 'undefined') return
  if (isSyntheticBrowser()) return
  if (typeof window.fbq !== 'function') return
  window.fbq('track', 'Lead', { content_name: contentName }, { eventID: eventId })
}

/**
 * Fire an AddToCart browser pixel event.
 * The eventId must match the one generated server-side so Meta deduplicates
 * the browser + CAPI pair into a single conversion.
 */
export function trackFbAddToCart(params: FbContentParams, eventId: string): void {
  if (typeof window === 'undefined') return
  if (isSyntheticBrowser()) return
  if (typeof window.fbq !== 'function') return
  window.fbq(
    'track',
    'AddToCart',
    {
      content_ids:  params.content_ids.map(numericProductId),
      content_type: 'product',
      value:        params.value,
      currency:     params.currency,
    },
    { eventID: eventId },
  )
}
