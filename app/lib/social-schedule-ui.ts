/**
 * Null-tolerant, string-in/string-out wrappers over `social-schedule.ts` for
 * the Composer and the queue. One DST implementation lives in
 * `social-schedule.ts` (Phase 4); these wrappers only adapt the shape the UI
 * wants (ISO strings, null on malformed input) so a form field never throws.
 * Client-safe: no `.server` suffix, no server imports.
 */
import { laWallClockToUtc, utcToLaParts, formatLaSlot } from './social-schedule'

/** LA wall clock -> UTC ISO string, or null on malformed input. */
export function laWallClockToUtcIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const [, mo, d] = date.split('-').map(Number) as [number, number, number]
  const [h, mi] = time.split(':').map(Number) as [number, number]
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null
  try {
    return laWallClockToUtc(date, time).toISOString()
  } catch {
    return null
  }
}

/** UTC instant -> LA `{ date, time }`, or null when unparseable. */
export function utcIsoToLaWallClock(iso: string | Date): { date: string; time: string } | null {
  const at = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  return utcToLaParts(at)
}

/** "PDT" or "PST" for the zone in force at the given instant (defaults to now). */
export function laZoneAbbrev(at: Date = new Date()): 'PDT' | 'PST' {
  return formatLaSlot(at).endsWith('PDT') ? 'PDT' : 'PST'
}

/** Short human slot for lists: "Tue Aug 25, 9:30 AM PDT". Null when there is no slot. */
export function formatLaWallClock(iso: string | Date | null | undefined): string | null {
  if (!iso) return null
  const at = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  return formatLaSlot(at)
}

/**
 * The two daily UTC times the drafting routine's rework pass runs (ticket
 * #5415: "I respond with revisions, but I don't know when the revisions are
 * happening"). A `needs_changes` row is picked up at whichever of these comes
 * next, not on some indeterminate schedule.
 */
export const REWORK_PASS_UTC_HOURS = [14, 22] as const

/** The next 14:00 or 22:00 UTC at or after `now`. */
export function nextReworkPassUtc(now: Date = new Date()): Date {
  for (const h of REWORK_PASS_UTC_HOURS) {
    const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, 0, 0, 0))
    if (candidate.getTime() > now.getTime()) return candidate
  }
  // Both passes today have already run; the first pass tomorrow.
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  return new Date(Date.UTC(
    tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(),
    REWORK_PASS_UTC_HOURS[0], 0, 0, 0,
  ))
}

/** "next pass in 3h" style label for a rework-pass instant, relative to `now`. */
export function formatNextReworkPass(now: Date = new Date()): string {
  const next = nextReworkPassUtc(now)
  const hours = (next.getTime() - now.getTime()) / 3_600_000
  const label = hours < 1 ? 'under an hour' : `${Math.round(hours)}h`
  return `next pass in ${label}`
}

/** "3h", "2d" waiting age for a timestamp, coarse on purpose. Null when unparseable. */
export function formatWaitingAge(from: string | Date | null | undefined, now: Date = new Date()): string | null {
  if (!from) return null
  const at = from instanceof Date ? from : new Date(from)
  if (Number.isNaN(at.getTime())) return null
  const ms = now.getTime() - at.getTime()
  if (ms < 0) return null
  const hours = ms / 3_600_000
  if (hours < 1) return '<1h'
  if (hours < 24) return `${Math.round(hours)}h`
  return `${Math.round(hours / 24)}d`
}
