/**
 * Which ideas the render pipeline may turn into creatives.
 *
 * Owner direction 2026-10-06: creatives come every day, whether or not the
 * owner has rated yet. A hearted idea always renders. An auto pick is the ads
 * team choosing a few unrated ideas from today's slate so the Creatives tab
 * has something new each day; the owner rates them like any other creative.
 * Rejected and archived ideas never render, auto pick or not.
 */

/** Most unrated ideas one auto-pick enqueue may carry. The daily budget still caps spend. */
export const AUTO_PICK_MAX = 5

const OWNER_PICKED = new Set(['hearted', 'rendered'])
const AUTO_PICKABLE = new Set(['proposed', 'hearted', 'rendered'])

/** null when the idea may be enqueued, otherwise the skip reason (`idea_<status>`). */
export function enqueueSkipReason(status: string, opts: { autoPick?: boolean } = {}): string | null {
  const allowed = opts.autoPick ? AUTO_PICKABLE : OWNER_PICKED
  return allowed.has(status) ? null : `idea_${status}`
}
