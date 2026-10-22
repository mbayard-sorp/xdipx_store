/**
 * Validation for /api/meta-event, the server half of a browser pixel event.
 *
 * Why the browser mints these now. ViewContent used to fire from the PDP
 * loader, and the PDP is edge-cached (STOREFRONT_CACHE_HEADERS: s-maxage 60,
 * stale-while-revalidate 600). So the loader ran for cache misses, background
 * revalidations, the 15-minute /cron/warm fetch and the HTTP checkout probe,
 * not for the people who read the page, and the event id baked into a cached
 * render was handed to every visitor who got that render. Measured on
 * 2026-10-20: about 3,000 ViewContent a week, steady around the clock, fbp on
 * 2.8% of them, and zero browser events of any kind in the dataset. Only a
 * browser that executes the page's JavaScript reaches this endpoint, and each
 * view gets its own id, shared with the fbq call it pairs with.
 *
 * Pure, so the rules are testable without a Request.
 */
import type { CapiCustomData } from './meta-capi.server'

export type BrowserEventName = 'PageView' | 'ViewContent'

export interface ParsedBrowserEvent {
  eventName: BrowserEventName
  eventId: string
  eventSourceUrl: string
  customData?: CapiCustomData
}

/** Hosts a browser event may claim to come from. Anything else is dropped. */
export const META_EVENT_HOSTS: ReadonlySet<string> = new Set(['xdipx.com', 'www.xdipx.com', 'curious.xdipx.com'])

const EVENT_ID = /^[A-Za-z0-9-]{8,64}$/
const CONTENT_ID = /^[A-Za-z0-9_:/.-]{1,100}$/
const CURRENCY = /^[A-Z]{3}$/

/** Paths that never produce a pixel event (admin, API, team tools). */
export function isTrackablePath(pathname: string): boolean {
  return !/^\/(admin|api|cron|webhooks)(\/|$|\.)/.test(pathname)
}

function allowedUrl(raw: unknown, extraHosts: ReadonlySet<string>): string | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null
  let url: URL
  try { url = new URL(raw) } catch { return null }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null
  if (!META_EVENT_HOSTS.has(url.hostname) && !extraHosts.has(url.hostname)) return null
  if (!isTrackablePath(url.pathname)) return null
  return url.toString()
}

/**
 * Parse and bound a beacon body. Returns null for anything malformed, so a
 * hand-built request cannot push arbitrary event names, unbounded content id
 * lists, or a foreign event_source_url into the dataset.
 */
export function parseBrowserEvent(
  body: unknown,
  extraHosts: ReadonlySet<string> = new Set(),
): ParsedBrowserEvent | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>

  const eventName = b['event_name']
  if (eventName !== 'PageView' && eventName !== 'ViewContent') return null
  const eventId = b['event_id']
  if (typeof eventId !== 'string' || !EVENT_ID.test(eventId)) return null
  const eventSourceUrl = allowedUrl(b['event_source_url'], extraHosts)
  if (!eventSourceUrl) return null

  if (eventName === 'PageView') return { eventName, eventId, eventSourceUrl }

  const cd = b['custom_data']
  if (!cd || typeof cd !== 'object') return null
  const c = cd as Record<string, unknown>
  const ids = c['content_ids']
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20) return null
  if (!ids.every(id => typeof id === 'string' && CONTENT_ID.test(id))) return null
  const value = c['value']
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100_000) return null
  const currency = typeof c['currency'] === 'string' ? c['currency'] : 'USD'
  if (!CURRENCY.test(currency)) return null

  return {
    eventName,
    eventId,
    eventSourceUrl,
    customData: { content_ids: ids as string[], content_type: 'product', value, currency },
  }
}

/** Same-site origin check for the beacon. Previews (*.vercel.app with xdipx in the host) pass, as for /api/lead. */
export function isAllowedEventOrigin(origin: string | null, isProduction: boolean): boolean {
  if (!isProduction) return true
  if (!origin) return false
  try {
    const host = new URL(origin).hostname
    if (META_EVENT_HOSTS.has(host)) return true
    return host.endsWith('.vercel.app') && host.includes('xdipx')
  } catch {
    return false
  }
}
