// Server-computed weekday -> Notebook category slot, mirroring the weekly
// rhythm in docs/store-team/content-plan.md §2. The content routine reads this
// from the gate response instead of computing the weekday itself (run 20
// mis-identified Sunday as Saturday and drafted the wrong category slot).
// Weekday is computed in Pacific time because the routine fires at 8am PT.

export interface ContentSlot {
  weekday: string
  expectedCategory: string
  /** Thursday falls back to care when no podcastReviewBrief is pending;
   *  Sunday alternates to wellness-basics when the comparisons queue is thin.
   *  The routine still owns those checks; this is the allowed alternate. */
  fallbackCategory: string | null
}

const SLOT_BY_WEEKDAY: Record<string, [string, string | null]> = {
  Monday: ['guides', null],
  Tuesday: ['real-talk', null],
  Wednesday: ['guides', null],
  Thursday: ['podcast-notes', 'care'],
  Friday: ['real-talk', null],
  Saturday: ['care', null],
  Sunday: ['comparisons', 'wellness-basics'],
}

export function contentSlotForDate(d: Date): ContentSlot {
  const weekday = d.toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long',
  })
  const slot = SLOT_BY_WEEKDAY[weekday] ?? ['guides', null]
  return { weekday, expectedCategory: slot[0], fallbackCategory: slot[1] }
}
