/**
 * One-off: clear exhausted Klaviyo-resolution-miss log rows for named
 * orders so `getPiiRedactedOrdersNeedingKlaviyoRetry` (app/lib/reviews.server.ts)
 * picks them up again on the next `/cron/review-reminders` run (ticket #20822).
 *
 * As of ticket #21488, `/cron/review-reminders` already does this
 * automatically and unconditionally for every row older than
 * `KLAVIYO_LOOKUP_FIX_EPOCH` (`rearmKlaviyoMissAttemptsBefore`,
 * app/lib/reviews.server.ts) — the manual `--apply` run this script asked
 * for after ticket #20828 shipped never happened, which is exactly how the
 * 7 orders stayed stuck for three more days. This script remains for an
 * out-of-band override (clearing specific orders ahead of the next cron
 * tick, or orders a future fix's epoch does not cover).
 *
 * This writes to the production order_fulfillment_webhook_log table, so it
 * is dry-run by default (ticket #20828): it only reports how many rows
 * WOULD clear until `--apply` is passed. The cloud dev sandbox these
 * tickets were authored in cannot write production data either way
 * (outside what that kind of session is permitted to do) — run `--apply`
 * from an environment with real DATABASE_URL write access. Idempotent
 * either way: a second run (dry or applied) against already-cleared orders
 * reports/clears 0 rows, never an error.
 *
 *   npx tsx --env-file=.env scripts/reset-klaviyo-miss-attempts.ts              # dry run, default orders
 *   npx tsx --env-file=.env scripts/reset-klaviyo-miss-attempts.ts --apply      # actually clear, default orders
 *   npx tsx --env-file=.env scripts/reset-klaviyo-miss-attempts.ts --apply 1234567890 2345678901
 */
import { countResettableKlaviyoMissAttempts, resetKlaviyoMissAttempts } from '../app/lib/reviews.server'

// The 7 orders ticket #20822 found stuck at KLAVIYO_MISS_MAX_ATTEMPTS (3 of 3)
// as of 2026-11-09, confirmed still stuck as of #20828 (2026-11-09). Override
// with explicit order ids on the command line.
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
  const rawArgs = process.argv.slice(2)
  const apply = rawArgs.includes('--apply')
  const orderIds = rawArgs.filter((a) => a !== '--apply')
  const targets = orderIds.length > 0 ? orderIds : DEFAULT_ORDER_IDS

  if (!apply) {
    const wouldClear = await countResettableKlaviyoMissAttempts(targets)
    console.log(`DRY RUN: would clear ${wouldClear} miss-attempt log row(s) for ${targets.length} order(s):`, targets)
    console.log('Pass --apply to actually clear them.')
    return
  }

  console.log(`Resetting Klaviyo miss attempts for ${targets.length} order(s):`, targets)
  const cleared = await resetKlaviyoMissAttempts(targets)
  console.log(`Cleared ${cleared} miss-attempt log row(s). These orders are eligible for the next review-reminders run.`)
}

main().catch((err) => {
  console.error('reset-klaviyo-miss-attempts failed:', err)
  process.exit(1)
})
