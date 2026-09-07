import './_load-env'
import {
  runPromoExecutionPass,
  defaultPromoExecuteDeps,
  promoExecuteEnabled,
  PROMO_EXECUTE_VALVE,
} from '../app/lib/shopify-discounts.server'

/**
 * Manual/weekly-strategy-routine entry point: mint a Shopify discount code for
 * every APPROVED, MAP-clean promo brief. Valve-gated by `promo_execute_enabled`
 * (default OFF): with the valve off this exits without touching Shopify, the
 * owner inbox, or any ticket.
 *
 * The primary caller is now the daily `/cron/promo-execute` job (ticket
 * #8022): this script's weekly invocation from routine-weekly-strategy.md
 * Step 4 2b is a redundant safety net, harmless because
 * `runPromoExecutionPass` is idempotent (a promo row that already carries an
 * execution note -- minted, refused, or failed -- is skipped).
 *
 * Fail-closed: MAP conflicts, missing windows, and promos with no resolvable
 * eligible product are refused (loud owner email plus ticket note), never
 * minted.
 */

async function main(): Promise<void> {
  const deps = defaultPromoExecuteDeps()

  if (!promoExecuteEnabled(await deps.getSetting(PROMO_EXECUTE_VALVE))) {
    console.log(`[execute-promos] ${PROMO_EXECUTE_VALVE} is off. Nothing to do.`)
    return
  }

  const result = await runPromoExecutionPass(deps)
  if (result.total === 0) {
    console.log('[execute-promos] No approved promo briefs. Clean run.')
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[execute-promos] failed:', err)
    process.exit(1)
  })
