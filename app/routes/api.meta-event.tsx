/**
 * POST /api/meta-event: the server copy of a browser Meta pixel event.
 *
 * The browser fires fbq('track', name, params, { eventID }) and beacons the
 * same name and id here (app/lib/meta-pixel.client.ts trackMetaEvent). This
 * sends it over CAPI so Meta keeps one of the pair. The fbq side only reaches
 * Meta after the visitor accepts marketing cookies; this side is why a visitor
 * who never touches the banner still counts.
 *
 * Accepts PageView and ViewContent only (parseBrowserEvent). Crawlers,
 * prefetches and the store's own probes are dropped (isCapiEligible). Always
 * answers 204 so a beacon never retries and never shows an error in the
 * console. The send is awaited before responding because Vercel discards work
 * started after the response.
 */
import type { ActionFunctionArgs } from 'react-router'
import { isCapiEligible } from '~/lib/capi-eligibility.server'
import { isAllowedEventOrigin, parseBrowserEvent } from '~/lib/meta-browser-event.server'
import { sendBrowserEventCapi } from '~/lib/meta-capi.server'
import { checkRateLimit } from '~/lib/rate-limit.server'

const NO_CONTENT = { status: 204, headers: { 'Cache-Control': 'no-store' } }

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') return new Response(null, { status: 405 })
  const isProduction = process.env['NODE_ENV'] === 'production'
  if (!isAllowedEventOrigin(request.headers.get('origin'), isProduction)) return new Response(null, NO_CONTENT)
  if (!isCapiEligible(request)) return new Response(null, NO_CONTENT)

  // A real visitor produces a handful of these a minute; anything far past
  // that is a script replaying the endpoint.
  const rl = await checkRateLimit(request, 'meta-event', 60, 60)
  if (!rl.ok) return new Response(null, NO_CONTENT)

  let body: unknown
  try {
    body = JSON.parse(await request.text())
  } catch {
    return new Response(null, NO_CONTENT)
  }
  const ev = parseBrowserEvent(body, isProduction ? new Set() : new Set([new URL(request.url).hostname]))
  if (!ev) return new Response(null, NO_CONTENT)

  const result = await sendBrowserEventCapi(request, ev)
  if (!result.ok && !result.skipped) console.error(`[meta-event] ${ev.eventName} not delivered:`, result.error)
  return new Response(null, NO_CONTENT)
}
