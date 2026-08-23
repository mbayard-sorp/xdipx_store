/**
 * Minimal, client-safe Los Angeles wall-clock helpers for the Social Studio
 * Composer (Phase 3, ticket #4938).
 *
 * Phase 4 owns the canonical `social-schedule.ts` (laWallClockToUtc,
 * formatLaSlot, utcToLaParts, effectiveScheduledAt). These are deliberately
 * named differently and kept tiny so the orchestrator can reconcile the two
 * without a rename collision. No library: Intl is DST-correct on its own.
 */

const LA = 'America/Los_Angeles'

function laOffsetMinutes(at: Date): number {
  // Offset of America/Los_Angeles from UTC at the given instant, in minutes.
  // Built from the formatted parts so it is right on both sides of a DST switch.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: LA,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0')
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return Math.round((asUtc - at.getTime()) / 60_000)
}

/**
 * Convert a Los Angeles wall-clock `YYYY-MM-DD` + `HH:MM` to a UTC ISO string.
 * Returns null for malformed input. On the spring-forward gap the nonexistent
 * hour resolves forward (02:30 becomes 03:30 PDT); on the fall-back overlap
 * the first (PDT) reading wins.
 */
export function laWallClockToUtcIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number]
  const [h, mi] = time.split(':').map(Number) as [number, number]
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null
  // First guess: treat the wall clock as UTC, then correct by the zone offset
  // at that instant. Iterate once more so the offset used is the one in force
  // at the corrected instant, which is what makes DST edges come out right.
  const naive = Date.UTC(y, mo - 1, d, h, mi)
  let guess = naive - laOffsetMinutes(new Date(naive)) * 60_000
  guess = naive - laOffsetMinutes(new Date(guess)) * 60_000
  return new Date(guess).toISOString()
}

/** Split a UTC instant into Los Angeles `{ date, time }` wall-clock strings. */
export function utcIsoToLaWallClock(iso: string | Date): { date: string; time: string } | null {
  const at = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: LA, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00'
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`,
  }
}

/** "PDT" or "PST" for the zone in force at the given instant (defaults to now). */
export function laZoneAbbrev(at: Date = new Date()): 'PDT' | 'PST' {
  return laOffsetMinutes(at) === -420 ? 'PDT' : 'PST'
}

/** Short human slot for lists: "Tue Aug 25, 9:30 AM PDT". */
export function formatLaWallClock(iso: string | Date | null | undefined): string | null {
  if (!iso) return null
  const at = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: LA, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(at)
  return `${s} ${laZoneAbbrev(at)}`
}
