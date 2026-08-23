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
