/**
 * GA4, readable by every routine — and honest about when it is worth reading.
 *
 * ## The wiring was never the problem
 *
 * The 2026-09-01 audit asked the owner to grant a service account access and
 * set `GA4_PROPERTY_ID`. Both were already done. Authenticating with the live
 * production service account against property 532477050 returns real data. The
 * actual gap was narrower and stranger: `ga4.server.ts` had **zero code
 * importers** while four documents and an agent definition claimed it was
 * wired, so seven consecutive strategy briefs printed "GA4 UNREADABLE" about a
 * module that worked.
 *
 * One endpoint fixes that, and it needs no connector attached to any cloud
 * routine — which matters, because attaching connectors to triggers is exactly
 * the surface this program is trying to shrink.
 *
 * ## The action floor matters more than the wiring
 *
 * Measured on the same live property: **141 sessions, 29 users, 1 add-to-cart,
 * 1 checkout, 1 purchase, $28.11 over 28 days.**
 *
 * At that volume a GA4 "delta" is statistically indistinguishable from noise. A
 * routine that reads a 30% swing in add-to-carts is reading the difference
 * between one and zero. Turning seven briefs that said "unreadable" into seven
 * briefs that confidently optimise on n=1 is not an improvement; it is the same
 * blindness with a number attached, and numbers are more persuasive than
 * silence.
 *
 * So the summary carries its own verdict. `actionable` is false below
 * `ACTION_FLOOR_SESSIONS`, and every consumer is expected to branch on it
 * rather than on the metrics. The floor is deliberately part of the payload,
 * not a rule in a playbook: a playbook rule is exactly the kind of thing this
 * program keeps finding has quietly stopped being true.
 */

import { getHomepageSignals, type HomepageSignals } from '~/lib/ga4.server'

/**
 * Sessions per 28 days below which no routine may act on a GA4 delta.
 *
 * Roughly the point at which a 10% change in a conversion step is more likely
 * to be real than to be one visitor behaving differently. It is a judgement,
 * not a derivation, and it is written here so it can be argued with — a floor
 * nobody can find is a floor nobody honours.
 */
export const ACTION_FLOOR_SESSIONS = 1000

/** The window every caller gets unless it asks otherwise. Matches the briefs. */
export const DEFAULT_WINDOW_DAYS = 28

export interface Ga4Summary {
  /** False when GA4_PROPERTY_ID or the service account is genuinely absent. */
  configured: boolean
  windowDays: number
  sessions: number
  activeUsers: number
  pageViews: number
  engagementRate: number
  addToCarts: number
  checkouts: number
  purchases: number
  revenue: number
  topPages: Array<{ path: string; views: number }>
  topProductPages: Array<{ path: string; views: number }>
  /**
   * Whether a consumer may act on a delta in these numbers.
   *
   * Branch on THIS, never on the metrics. False means the traffic is too thin
   * for a change to mean anything, and the correct response is to say so and
   * decide on other grounds — not to optimise anyway with a caveat attached.
   */
  actionable: boolean
  actionFloorSessions: number
  /** One sentence a routine can quote verbatim into a brief. */
  verdict: string
  /** Sub-report failures, sparse data, auth problems. Never fatal. */
  dataGaps: string[]
}

export function summarize(signals: HomepageSignals): Ga4Summary {
  const actionable = signals.isConfigured && signals.sessions >= ACTION_FLOOR_SESSIONS

  const verdict = !signals.isConfigured
    ? 'GA4 is not configured for this environment, so there are no numbers to read. '
      + 'This is a real gap, distinct from thin traffic: check GA4_PROPERTY_ID and the service account.'
    : actionable
      ? `${signals.sessions} sessions over ${signals.windowDays} days is above the `
        + `${ACTION_FLOOR_SESSIONS}-session floor, so a change in these numbers is worth acting on.`
      : `${signals.sessions} sessions over ${signals.windowDays} days is below the `
        + `${ACTION_FLOOR_SESSIONS}-session action floor. The numbers are real and worth reporting, `
        + `but a delta at this volume is indistinguishable from one visitor behaving differently. `
        + `Report them; do not optimise on them.`

  return {
    configured: signals.isConfigured,
    windowDays: signals.windowDays,
    sessions: signals.sessions,
    activeUsers: signals.activeUsers,
    pageViews: signals.screenPageViews,
    engagementRate: signals.engagementRate,
    addToCarts: signals.addToCarts,
    checkouts: signals.checkouts,
    purchases: signals.purchases,
    revenue: signals.revenue,
    topPages: signals.topPages,
    topProductPages: signals.topProductPages,
    actionable,
    actionFloorSessions: ACTION_FLOOR_SESSIONS,
    verdict,
    dataGaps: signals.dataGaps,
  }
}

/**
 * Read GA4 and wrap it with its own verdict.
 *
 * Never throws: `getHomepageSignals` already returns zeroed signals with a
 * `dataGaps` entry rather than failing, which is the right contract for a
 * routine that must still finish its run when analytics is down. The one thing
 * this must never do is let "the API call failed" render as "traffic is zero" —
 * `configured` and `dataGaps` keep those distinguishable.
 */
export async function getGa4Summary(windowDays = DEFAULT_WINDOW_DAYS): Promise<Ga4Summary> {
  return summarize(await getHomepageSignals({ windowDays }))
}
