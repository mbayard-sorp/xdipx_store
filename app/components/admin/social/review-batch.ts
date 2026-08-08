import type { SocialPostRow } from './types'

/**
 * Pure helpers for the Social Studio batch-review affordances (ticket #2016).
 * Kept framework-free so the queue grouping and the batch id contract are
 * unit-testable without rendering the route.
 */

/**
 * Parse the comma-joined `postIds` field a batch-review submit sends into a
 * clean, deduped, order-preserving list of positive integer ids. Anything
 * non-numeric or non-positive is dropped rather than trusted.
 */
export function parseBatchPostIds(raw: string | null | undefined): number[] {
  if (!raw) return []
  const seen = new Set<number>()
  const out: number[] = []
  for (const part of raw.split(',')) {
    const n = parseInt(part.trim(), 10)
    if (Number.isFinite(n) && n > 0 && !seen.has(n)) {
      seen.add(n)
      out.push(n)
    }
  }
  return out
}

export interface DayGroup {
  /** ISO `YYYY-MM-DD` the drafts are proposed for, or null when unscheduled. */
  day: string | null
  posts: SocialPostRow[]
}

/**
 * Group review-queue drafts by their proposed calendar day, ordered oldest day
 * first (ISO strings sort chronologically). Unscheduled drafts (no
 * scheduled_for) are collected into a trailing null-day group so they are
 * always visible below the dated ones.
 */
export function groupByScheduledDay(posts: SocialPostRow[]): DayGroup[] {
  const byDay = new Map<string, SocialPostRow[]>()
  const unscheduled: SocialPostRow[] = []
  for (const p of posts) {
    if (!p.scheduledFor) {
      unscheduled.push(p)
      continue
    }
    const list = byDay.get(p.scheduledFor) ?? []
    list.push(p)
    byDay.set(p.scheduledFor, list)
  }
  const groups: DayGroup[] = [...byDay.keys()]
    .sort()
    .map(day => ({ day, posts: byDay.get(day)! }))
  if (unscheduled.length) groups.push({ day: null, posts: unscheduled })
  return groups
}
