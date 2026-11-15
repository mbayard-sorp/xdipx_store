/**
 * Server-side arrival counting for paid-lane sales pages (ticket #19434,
 * owner evidence 2026-11-01: "help me not waste money!").
 *
 * ExoClick bills a click whenever its own log shows one; GA4 only counts a
 * visit once the page's client JS has run and fires its pageview. The gap
 * between the two (177 billed clicks vs 15 GA4 sessions on
 * curious.xdipx.com/gawk-gawk-3000, same hours) could be bots, a slow page,
 * or GA4 dropping events, and nothing today tells those apart.
 *
 * Two KV counters, keyed by UTC day, utm_source and utm_content, close that:
 * `recordArrivalRequest` is called from the sales-page loader on every hit
 * that carries a utm_source, before the response (Vercel discards any work
 * started after it); `recordArrivalBeacon` is called from
 * /api/sales-arrival-beacon, which the client fires once after hydration.
 * requests minus beacons is visitors whose browser never ran that script.
 *
 * Read via POST /api/team/ad-metrics {op:'arrivals', utmSource, utmContent?, day?}.
 */
import { kvGet, kvIncr } from './kv.server'

/** UTC calendar day, matching the day boundary ExoClick and GA4 both report on. */
export function arrivalDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

function arrivalKey(kind: 'req' | 'beacon', day: string, utmSource: string, utmContent: string): string {
  return `arrivals:${kind}:${day}:${utmSource}:${utmContent || '(none)'}`
}

export async function recordArrivalRequest(day: string, utmSource: string, utmContent: string): Promise<void> {
  await kvIncr(arrivalKey('req', day, utmSource, utmContent))
}

export async function recordArrivalBeacon(day: string, utmSource: string, utmContent: string): Promise<void> {
  await kvIncr(arrivalKey('beacon', day, utmSource, utmContent))
}

export interface ArrivalCounts {
  requests: number
  beacons: number
}

export async function getArrivalCounts(day: string, utmSource: string, utmContent: string): Promise<ArrivalCounts> {
  const [requests, beacons] = await Promise.all([
    kvGet<number>(arrivalKey('req', day, utmSource, utmContent)),
    kvGet<number>(arrivalKey('beacon', day, utmSource, utmContent)),
  ])
  return { requests: requests ?? 0, beacons: beacons ?? 0 }
}
