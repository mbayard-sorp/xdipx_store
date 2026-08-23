/**
 * Social scheduling helpers (Social Studio v2 Phase 4, ADR-013 decision 9).
 *
 * Client-safe on purpose: the Composer's slot picker and the calendar both need
 * these, and the server needs the same arithmetic to be sure a slot the owner
 * typed in Los Angeles lands on the UTC instant he meant. One implementation,
 * no timezone library: `Intl.DateTimeFormat` knows the LA rules, and the
 * offset probe below is the standard way to invert a wall clock through it.
 *
 * The rule this file implements: owner input is an LA wall-clock time, stored
 * UTC, displayed with the PDT or PST label that actually applied.
 */

export const LA_TZ = 'America/Los_Angeles'

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: LA_TZ,
  hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
})

const SLOT = new Intl.DateTimeFormat('en-US', {
  timeZone: LA_TZ,
  weekday: 'short', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true,
  timeZoneName: 'short',
})

function partMap(fmt: Intl.DateTimeFormat, d: Date): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value
  return out
}

/** LA wall-clock fields of an instant. */
function laFields(d: Date) {
  const p = partMap(PARTS, d)
  return {
    year: Number(p['year']), month: Number(p['month']), day: Number(p['day']),
    // h23 still yields "24" for midnight on some engines; normalise.
    hour: Number(p['hour']) % 24, minute: Number(p['minute']), second: Number(p['second']),
  }
}

/** LA's UTC offset at `d`, in milliseconds (negative west of Greenwich). */
function laOffsetMs(d: Date): number {
  const f = laFields(d)
  const asUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second)
  // Drop sub-second noise so the subtraction is exact.
  return asUtc - Math.floor(d.getTime() / 1000) * 1000
}

const two = (n: number) => String(n).padStart(2, '0')

/**
 * Convert an LA wall-clock `date` + `time` to the UTC instant it names.
 *
 * Two probes handle the DST edges: the first guess assumes the offset that
 * applies when the wall clock is read as UTC, the second re-reads the offset at
 * the instant that guess produced. A time inside the spring-forward gap
 * (02:00-02:59 on the March switch) does not exist and resolves to the hour
 * after; a time inside the autumn overlap resolves to its first (daylight)
 * occurrence. Both are the conventional choices.
 */
export function laWallClockToUtc(date: string, time: string): Date {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const tm = /^(\d{2}):(\d{2})$/.exec(time)
  if (!dm || !tm) throw new Error(`Bad LA wall clock: ${date} ${time}`)
  const wall = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]))
  const first = new Date(wall - laOffsetMs(new Date(wall)))
  const second = new Date(wall - laOffsetMs(first))
  return second
}

/** `{ date: 'YYYY-MM-DD', time: 'HH:mm' }` of an instant, on the LA wall clock. */
export function utcToLaParts(d: Date): { date: string; time: string } {
  const f = laFields(d)
  return {
    date: `${f.year}-${two(f.month)}-${two(f.day)}`,
    time: `${two(f.hour)}:${two(f.minute)}`,
  }
}

/** e.g. `Sat Aug 23, 9:00 AM PDT`. The zone label is whichever actually applied. */
export function formatLaSlot(d: Date): string {
  const p = partMap(SLOT, d)
  return `${p['weekday']} ${p['month']} ${p['day']}, ${p['hour']}:${p['minute']} ${p['dayPeriod']} ${p['timeZoneName']}`
}

/**
 * The JS twin of the SQL rule `COALESCE(scheduled_at, scheduled_for::timestamptz)`.
 *
 * A legacy date-only row casts to midnight UTC of that day, which is the
 * evening before in Los Angeles. That is accepted: it is never later than the
 * old `<= current_date` behaviour, and Phase 4 exists to stop creating such
 * rows rather than to reinterpret the old ones.
 */
export function effectiveScheduledAt(row: {
  scheduledAt: Date | string | null | undefined
  scheduledFor: string | null | undefined
}): Date | null {
  if (row.scheduledAt != null) {
    const d = row.scheduledAt instanceof Date ? row.scheduledAt : new Date(row.scheduledAt)
    if (!Number.isNaN(d.getTime())) return d
  }
  if (row.scheduledFor && /^\d{4}-\d{2}-\d{2}$/.test(row.scheduledFor)) {
    return new Date(`${row.scheduledFor}T00:00:00Z`)
  }
  return null
}
