/**
 * Review funnel silent-drop check (ticket #16267).
 *
 * `handleOrderFulfilled` (server/webhooks.ts) silently died on the Basic
 * plan's PII redaction for every one of the last 38 fulfilled orders, and
 * nothing noticed: `review_invites` stayed empty and no ticket ever got
 * filed. "Fulfilled orders fired (per `order_fulfillment_webhook_log`) with
 * zero invites created over the same window" is exactly that failure mode,
 * whatever the current cause, so this files a ticket through the same
 * detection-ticket bridge the other cron detectors use
 * (`detection-tickets.server.ts`) rather than inventing a second alerting
 * path.
 *
 * Pure core + thin DB wiring, same split as `social-zero-day.server.ts`, so
 * the decision logic is tested without touching Neon.
 */

export const REVIEW_FUNNEL_CHECK_WINDOW_DAYS = 7

export interface ReviewFunnelCheckDeps {
  fulfillmentLogCountSince(days: number): Promise<number>
  inviteCountSince(days: number): Promise<number>
  fileTicket(t: { dedupeKey: string; priority: number; suggestion: string }): Promise<{ id: number; deduped: boolean }>
}

export interface ReviewFunnelCheckReport {
  fulfilled: number
  invited: number
  breached: boolean
  ticketId: number | null
  deduped: boolean
}

export async function checkReviewFunnelSilentDrop(deps: ReviewFunnelCheckDeps): Promise<ReviewFunnelCheckReport> {
  const days = REVIEW_FUNNEL_CHECK_WINDOW_DAYS
  const [fulfilled, invited] = await Promise.all([
    deps.fulfillmentLogCountSince(days),
    deps.inviteCountSince(days),
  ])
  const breached = fulfilled > 0 && invited === 0
  if (!breached) return { fulfilled, invited, breached, ticketId: null, deduped: false }

  const { id, deduped } = await deps.fileTicket({
    dedupeKey: 'review-funnel-silent-drop',
    priority: 2,
    suggestion:
      `Review invite funnel produced zero invites over the last ${days} days despite ` +
      `${fulfilled} orders/fulfilled webhook ${fulfilled === 1 ? 'call' : 'calls'} logged in that window ` +
      `(order_fulfillment_webhook_log). Check handleOrderFulfilled (server/webhooks.ts) first; its ` +
      `no-email PII-redaction branch is the known cause as of ticket #16267. ` +
      `DONE WHEN: review_invites gets new rows again within a day of the next fulfilled order, or the ` +
      `ticket names the real blocker if it is not that branch this time.`,
  })
  return { fulfilled, invited, breached, ticketId: id, deduped }
}

/** Production wiring, called once a day from the /cron/review-reminders run. */
export async function runReviewFunnelSilentDropCheck(): Promise<ReviewFunnelCheckReport> {
  const { countFulfillmentWebhookLogSince, countInvitesCreatedSince } = await import('./reviews.server')
  const { fileDetectionTicket, makeDedupeKey } = await import('./detection-tickets.server')

  return checkReviewFunnelSilentDrop({
    fulfillmentLogCountSince: countFulfillmentWebhookLogSince,
    inviteCountSince: countInvitesCreatedSince,
    fileTicket: async t => {
      const id = await fileDetectionTicket({
        detector: 'review-funnel-check',
        dedupeKey: makeDedupeKey(t.dedupeKey),
        priority: t.priority,
        suggestion: t.suggestion,
        targetTeam: 'support',
      })
      return { id, deduped: id === 0 }
    },
  })
}
