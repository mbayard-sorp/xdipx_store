/**
 * POST /api/sales-arrival-beacon: the client half of the sales-page arrival
 * counter (ticket #19434, app/lib/ad-arrivals.server.ts). The loader already
 * counted this request server-side (bridge.$slug.tsx's salesLoaderData);
 * this beacon, fired once after hydration by
 * app/lib/sales-arrival-beacon.client.ts, counts the same visit again from a
 * browser that actually ran JavaScript. Requests minus beacons is visitors
 * who never did.
 *
 * Always answers 204 so a beacon never retries and never shows an error in
 * the console. The write is awaited before responding because Vercel
 * discards work started after the response.
 */
import type { ActionFunctionArgs } from 'react-router'
import { recordArrivalBeacon, arrivalDay } from '~/lib/ad-arrivals.server'
import { isAllowedEventOrigin } from '~/lib/meta-browser-event.server'
import { checkRateLimit } from '~/lib/rate-limit.server'

const NO_CONTENT = { status: 204, headers: { 'Cache-Control': 'no-store' } }

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') return new Response(null, { status: 405 })
  const isProduction = process.env['NODE_ENV'] === 'production'
  if (!isAllowedEventOrigin(request.headers.get('origin'), isProduction)) return new Response(null, NO_CONTENT)

  // A real visitor fires this once per page load; anything far past that is a
  // script replaying the endpoint.
  const rl = await checkRateLimit(request, 'sales-arrival-beacon', 60, 60)
  if (!rl.ok) return new Response(null, NO_CONTENT)

  let body: unknown
  try {
    body = JSON.parse(await request.text())
  } catch {
    return new Response(null, NO_CONTENT)
  }
  const b = (body ?? {}) as Record<string, unknown>
  const utmSource = typeof b['utmSource'] === 'string' ? b['utmSource'].slice(0, 100) : ''
  if (!utmSource) return new Response(null, NO_CONTENT)
  const utmContent = typeof b['utmContent'] === 'string' ? b['utmContent'].slice(0, 100) : ''

  await recordArrivalBeacon(arrivalDay(), utmSource, utmContent)
  return new Response(null, NO_CONTENT)
}
