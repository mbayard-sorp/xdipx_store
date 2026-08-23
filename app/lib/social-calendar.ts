/**
 * Calendar arithmetic for the Social Studio week grid (Phase 4, #4939).
 *
 * Client-safe and pure: the grid, the Reschedule sheet and the loader all
 * share these so a chip lands in the same cell whichever side computed it.
 * Every "date" here is an LA calendar date string (YYYY-MM-DD) and every
 * instant is a UTC Date; the two meet only through `social-schedule.ts`, which
 * owns the DST rules.
 */
import { laWallClockToUtc, utcToLaParts, effectiveScheduledAt } from './social-schedule'

/** The visible hour bands, LA wall clock, inclusive start and exclusive end. */
export const HOUR_START = 6
export const HOUR_END = 22

export type Band = 'early' | 'main' | 'late'

export interface CalendarCell {
  /** LA calendar date. */
  date: string
  /** LA hour 0-23. */
  hour: number
  /** Which row of the grid this hour renders in. */
  band: Band
}

export interface CalendarWeek {
  monday: string
  /** Seven LA dates, Monday first. */
  days: string[]
}

export interface CalendarPostLike {
  id: number
  platform: string
  status: string
  reviewStatus?: string | null | undefined
  scheduledAt?: string | Date | null | undefined
  scheduledFor?: string | null | undefined
  postedAt?: string | Date | null | undefined
}

const DAY_MS = 86_400_000

function parseDate(date: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) throw new Error(`Bad LA date: ${date}`)
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

const two = (n: number) => String(n).padStart(2, '0')

/** Calendar-date arithmetic without a timezone: LA dates are just labels here. */
export function addDays(date: string, n: number): string {
  const { y, m, d } = parseDate(date)
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS)
  return `${t.getUTCFullYear()}-${two(t.getUTCMonth() + 1)}-${two(t.getUTCDate())}`
}

/** 0 = Monday ... 6 = Sunday, for an LA calendar date. */
export function weekdayIndex(date: string): number {
  const { y, m, d } = parseDate(date)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

/** The Monday-first week containing `laDate`. */
export function weekOf(laDate: string): CalendarWeek {
  const monday = addDays(laDate, -weekdayIndex(laDate))
  return { monday, days: Array.from({ length: 7 }, (_, i) => addDays(monday, i)) }
}

/** The grid row an LA hour renders in. */
export function bandOf(hour: number): Band {
  if (hour < HOUR_START) return 'early'
  if (hour >= HOUR_END) return 'late'
  return 'main'
}

/** The cell a UTC instant lands in, on the LA wall clock. */
export function cellFor(slotUtc: Date): CalendarCell {
  const { date, time } = utcToLaParts(slotUtc)
  const hour = Number(time.slice(0, 2))
  return { date, hour, band: bandOf(hour) }
}

/**
 * The instant a chip sits at: posted rows by when they went live, everything
 * else by the effective slot. Null when the row has no slot at all.
 */
export function slotOf(post: CalendarPostLike): Date | null {
  if (post.status === 'posted' && post.postedAt) {
    const d = post.postedAt instanceof Date ? post.postedAt : new Date(post.postedAt)
    if (!Number.isNaN(d.getTime())) return d
  }
  return effectiveScheduledAt({ scheduledAt: post.scheduledAt ?? null, scheduledFor: post.scheduledFor ?? null })
}

/** Rows that count against a day's cap: anything still alive or already live. */
export function countsAgainstCap(post: CalendarPostLike): boolean {
  if (post.status === 'deleted' || post.status === 'failed') return false
  if (post.reviewStatus === 'rejected') return false
  return true
}

/** `{ [laDate]: { [platform]: count } }` of rows that occupy a cap slot. */
export function capsByDay(posts: CalendarPostLike[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const p of posts) {
    if (!countsAgainstCap(p)) continue
    const at = slotOf(p)
    if (!at) continue
    const { date } = cellFor(at)
    const day = (out[date] ??= {})
    day[p.platform] = (day[p.platform] ?? 0) + 1
  }
  return out
}

export interface NextOpenSlotInput {
  posts: CalendarPostLike[]
  /** Per-platform daily cap. A platform missing here is uncapped. */
  caps: Record<string, number>
  /** Search starts at the first whole hour after this instant. */
  from: Date
  platform: string
  /** Rows to ignore (the post being moved). */
  excludeId?: number | undefined
  /** How many days ahead to look before giving up. */
  horizonDays?: number | undefined
}

/**
 * The first main-band hour cell at or after `from` where the platform is
 * under its daily cap and no other row of the same platform already sits in
 * that hour. Returns the LA date and time of the cell, or null when the
 * horizon is full.
 */
export function nextOpenSlot(input: NextOpenSlotInput): { date: string; time: string; at: Date } | null {
  const { posts, caps, from, platform, excludeId, horizonDays = 28 } = input
  const considered = posts.filter(p => p.id !== excludeId && p.platform === platform)
  const byDay = capsByDay(considered)
  const takenHours = new Set<string>()
  for (const p of considered) {
    if (!countsAgainstCap(p)) continue
    const at = slotOf(p)
    if (at) {
      const c = cellFor(at)
      takenHours.add(`${c.date}T${c.hour}`)
    }
  }
  const cap = caps[platform]

  // Start at the next whole hour on the LA clock.
  const start = new Date(Math.ceil((from.getTime() + 1) / 3_600_000) * 3_600_000)
  let { date, hour } = cellFor(start)
  for (let day = 0; day <= horizonDays; day++) {
    if (day > 0) { date = addDays(date, 1); hour = HOUR_START }
    const used = byDay[date]?.[platform] ?? 0
    if (cap != null && used >= cap) continue
    for (let h = Math.max(hour, HOUR_START); h < HOUR_END; h++) {
      if (takenHours.has(`${date}T${h}`)) continue
      const time = `${two(h)}:00`
      return { date, time, at: laWallClockToUtc(date, time) }
    }
  }
  return null
}

/** "Tue Aug 25" for a column header, from an LA date. */
export function shortDayLabel(date: string): { weekday: string; label: string } {
  const { y, m, d } = parseDate(date)
  const t = new Date(Date.UTC(y, m - 1, d, 12))
  const weekday = t.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  const label = t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return { weekday, label }
}

/** "9:00 AM" from an LA hour. */
export function hourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}:00 ${hour < 12 ? 'AM' : 'PM'}`
}
