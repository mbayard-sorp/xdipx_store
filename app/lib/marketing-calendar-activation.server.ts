/**
 * marketing-calendar-activation.server.ts
 *
 * Auto-activates general-theme (non-'IG: ') marketing_calendar rows once
 * their eventDate arrives (ticket #20969).
 *
 * `api.team.calendar.tsx`'s `setStatus` op is hard-guarded to 'IG: '-prefixed
 * rows only — that is the social routine's own team-token path for its
 * campaign reconciliation (Step 2a). Every other calendar row's status is
 * admin-session-only, which meant a homepage/content theme row filed as
 * 'planned' had no automated path to 'active' at all: rows 45/46 (Wand Week,
 * planned 2026-11-02; Solo Sunday Month Opener, planned 2026-11-09) never
 * transitioned on their eventDate, so later runs had to guess the theme from
 * eventDate proximity instead of reading the real row. (The same ticket also
 * named row 31 stuck `status:'active'` since 2026-09-21 — a separate gap,
 * active -> done/skipped with no auto-close path, that this module does not
 * address; it covers planned -> active only.)
 *
 * This lifts exactly one mechanical transition — 'planned' -> 'active', on
 * eventDate, for rows the IG guard does not already cover — out of the
 * admin-session requirement. Every other calendar mutation (skip, done,
 * editing a row, deleting one) still goes through the admin session or the
 * IG-guarded team-token path exactly as before; this module does not touch
 * either.
 */

import { db } from './db.server'
import { marketingCalendar } from '../../db/schema'
import { and, eq, lte, notLike } from 'drizzle-orm'

/** Same prefix api.team.calendar.tsx guards setStatus to; never touched here. */
const IG_PREFIX = 'IG: '

export interface ActivatedCalendarRow {
  id: number
  name: string
  eventDate: string
}

export interface CalendarActivationResult {
  activated: ActivatedCalendarRow[]
}

/**
 * Activate every non-'IG: ' row still 'planned' whose eventDate is today or
 * earlier. Idempotent: a row already 'active' (or anything else) is not
 * selected, and the update itself re-checks `status = 'planned'` so a
 * concurrent writer can never double-activate or stomp a status set between
 * the select and the update.
 */
export async function runCalendarActivationPass(now: Date = new Date()): Promise<CalendarActivationResult> {
  const today = now.toISOString().slice(0, 10)

  const due = await db
    .select({ id: marketingCalendar.id, name: marketingCalendar.name, eventDate: marketingCalendar.eventDate })
    .from(marketingCalendar)
    .where(and(
      eq(marketingCalendar.status, 'planned'),
      lte(marketingCalendar.eventDate, today),
      notLike(marketingCalendar.name, `${IG_PREFIX}%`),
    ))

  const activated: ActivatedCalendarRow[] = []
  for (const row of due) {
    const updated = await db
      .update(marketingCalendar)
      .set({ status: 'active', updatedAt: new Date() })
      .where(and(eq(marketingCalendar.id, row.id), eq(marketingCalendar.status, 'planned')))
      .returning({ id: marketingCalendar.id })
    if (updated.length > 0) activated.push(row)
  }

  return { activated }
}
