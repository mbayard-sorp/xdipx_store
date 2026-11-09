/**
 * One-off: clear exhausted Klaviyo-resolution-miss log rows for named
 * orders so `getPiiRedactedOrdersNeedingKlaviyoRetry` (app/lib/reviews.server.ts)
 * picks them up again on the next `/cron/review-reminders` run (ticket #20822).
 *
 * This writes to the production order_fulfillment_webhook_log table. The
 * cloud dev sandbox this ticket was authored in cannot run it (production
 * writes are outside what that session is permitted to do); run it from an
 * environment with real DATABASE_URL write access, after the matching-logic
 * and lookback-window fix in this same PR has deployed, otherwise these 7
 * orders just re-exhaust their 3 attempts again tomorrow.
 *
 *   npx tsx --env-file=.env scripts/reset-klaviyo-miss-attempts.ts
 *   npx tsx --env-file=.env scripts/reset-klaviyo-miss-attempts.ts 1234567890 2345678901
 */
import { resetKlaviyoMissAttempts } from '../app/lib/reviews.server'

// The 7 orders ticket #20822 found stuck at KLAVIYO_MISS_MAX_ATTEMPTS (3 of 3)
// as of 2026-11-09. Override with explicit order ids on the command line.
const DEFAULT_ORDER_IDS = [
  '7147336040619',
  '7157313503403',
  '7159826219179',
  '7169195901099',
  '7172992893099',
  '7179883380907',
  '7185483169963',
]

async function main() {
  const orderIds = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_ORDER_IDS
  console.log(`Resetting Klaviyo miss attempts for ${orderIds.length} order(s):`, orderIds)
  const cleared = await resetKlaviyoMissAttempts(orderIds)
  console.log(`Cleared ${cleared} miss-attempt log row(s). These orders are eligible for the next review-reminders run.`)
}

main().catch((err) => {
  console.error('reset-klaviyo-miss-attempts failed:', err)
  process.exit(1)
})
