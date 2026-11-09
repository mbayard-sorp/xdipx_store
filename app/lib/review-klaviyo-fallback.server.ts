/**
 * The Klaviyo email-resolution fallback for review invites (ticket #19525).
 * `handleOrderFulfilled` (server/webhooks.ts) records `no_email_pii_redacted`
 * and gives up when a fulfilled order's webhook payload carries no email
 * (this store's Basic Shopify plan redacts it). `/cron/review-reminders`
 * calls `resolveMissingEmailInvites` daily to retry those orders through
 * Klaviyo's own mirrored "Fulfilled Order" event, which still carries the
 * buyer's email and line items.
 *
 * All side effects are an injected `ResolveDeps`, so the create-invite /
 * idempotency / retry-counting logic is unit-tested with a fake Klaviyo
 * response and no database.
 */
import { resolveFulfilledOrderEmail, type FulfilledOrderMatch } from './klaviyo-order-email.server'
import {
  countKlaviyoMissAttempts,
  createInvite,
  getInvitedProductIdsForOrder,
  getPiiRedactedOrdersNeedingKlaviyoRetry,
  recordOrderFulfillmentOutcome,
  KLAVIYO_MISS_MAX_ATTEMPTS,
  KLAVIYO_MISS_REASON_PREFIX,
  type PendingKlaviyoRetryOrder,
} from './reviews.server'
import type { CreateInviteInput } from '~/types/reviews'

/**
 * Lower bound matches the original fixed window (#19525); upper bound caps
 * how far back a single lookup can ask Klaviyo to scan, regardless of how
 * stale a pending order is. `sinceDaysForPendingOrder` below is the part
 * that actually varies per order (#20822).
 */
const MIN_SINCE_DAYS = 14
const MAX_SINCE_DAYS = 45

/**
 * A fixed 14-day Klaviyo lookback window missed orders that were already
 * older than 14 days by the time the daily retry ran (#20822: two of seven
 * stuck orders were 17 and 20 days past their redaction date). Size the
 * window to the order's own age instead, with a few days of slack for
 * clock skew between the webhook and this run, capped so one very old
 * stuck order can't force an unbounded Klaviyo query range.
 */
export function sinceDaysForPendingOrder(pendingSinceDays: number): number {
  return Math.min(MAX_SINCE_DAYS, Math.max(MIN_SINCE_DAYS, pendingSinceDays + 3))
}

export interface ResolveDeps {
  listPendingOrders: () => Promise<PendingKlaviyoRetryOrder[]>
  resolveEmail: (shopifyOrderId: string, sinceDays: number) => Promise<FulfilledOrderMatch | null>
  getInvitedProductIds: (shopifyOrderId: string) => Promise<Set<string>>
  createInvite: (input: CreateInviteInput) => Promise<unknown>
  recordOutcome: (shopifyOrderId: string, outcome: 'invited' | 'no_invite_created', reason: string) => Promise<void>
  countMissAttempts: (shopifyOrderId: string) => Promise<number>
  /** Days from now a freshly resolved invite is scheduled to send. */
  inviteDelayDays: number
}

export function defaultResolveDeps(inviteDelayDays: number): ResolveDeps {
  return {
    listPendingOrders: getPiiRedactedOrdersNeedingKlaviyoRetry,
    resolveEmail: (id, sinceDays) => resolveFulfilledOrderEmail(id, { sinceDays }),
    getInvitedProductIds: (id) => getInvitedProductIdsForOrder(id).catch(() => new Set<string>()),
    createInvite,
    recordOutcome: recordOrderFulfillmentOutcome,
    countMissAttempts: countKlaviyoMissAttempts,
    inviteDelayDays,
  }
}

export interface ResolveMissingEmailInvitesResult {
  /** Orders where at least one invite was created. */
  invited: number
  /** Orders where Klaviyo had no matching event yet (a miss, retried later). */
  missed: number
  /** Orders Klaviyo matched, but with no usable line items. */
  matchedNoLineItems: number
}

/**
 * Resolve every order still waiting on a Klaviyo-sourced email, create one
 * invite per distinct product not already invited for that order, and
 * record the outcome. Idempotent: an order with an existing review_invites
 * row never reaches this function (`deps.listPendingOrders` excludes it),
 * and a replay within the same run never double-invites a product because
 * `deps.getInvitedProductIds` plus an in-run `seen` set both guard it.
 */
export async function resolveMissingEmailInvites(deps: ResolveDeps): Promise<ResolveMissingEmailInvitesResult> {
  const result: ResolveMissingEmailInvitesResult = { invited: 0, missed: 0, matchedNoLineItems: 0 }
  const pendingOrders = await deps.listPendingOrders()

  for (const { shopifyOrderId, pendingSinceDays } of pendingOrders) {
    try {
      const match = await deps.resolveEmail(shopifyOrderId, sinceDaysForPendingOrder(pendingSinceDays))

      if (!match?.email) {
        const attempt = (await deps.countMissAttempts(shopifyOrderId)) + 1
        await deps.recordOutcome(shopifyOrderId, 'no_invite_created', `${KLAVIYO_MISS_REASON_PREFIX}${attempt}_of_${KLAVIYO_MISS_MAX_ATTEMPTS}`)
        result.missed++
        continue
      }

      if (match.lineItems.length === 0) {
        await deps.recordOutcome(shopifyOrderId, 'no_invite_created', 'Klaviyo event matched but had no usable line items')
        result.matchedNoLineItems++
        continue
      }

      const alreadyInvited = await deps.getInvitedProductIds(shopifyOrderId)
      const sendAfter = new Date(Date.now() + deps.inviteDelayDays * 24 * 60 * 60 * 1000)
      const seen = new Set<string>()
      let invitedAny = false

      for (const li of match.lineItems) {
        if (!li.productId) continue
        const shopifyProductId = `gid://shopify/Product/${li.productId}`
        if (alreadyInvited.has(shopifyProductId) || seen.has(shopifyProductId)) continue
        seen.add(shopifyProductId)
        await deps
          .createInvite({
            shopifyOrderId,
            shopifyProductId,
            reviewerEmail: match.email,
            reviewerName: match.reviewerName ?? 'Customer',
            sendAfter,
          })
          .then(() => { invitedAny = true })
          .catch((err) => console.error('[review-klaviyo-fallback] createInvite failed', shopifyOrderId, err))
      }

      await deps.recordOutcome(
        shopifyOrderId,
        invitedAny ? 'invited' : 'no_invite_created',
        invitedAny ? 'resolved via Klaviyo Fulfilled Order event' : 'invite creation failed for every matched product',
      )
      if (invitedAny) result.invited++
    } catch (err) {
      console.error('[review-klaviyo-fallback] resolution failed for order', shopifyOrderId, err)
    }
  }

  return result
}
