import './_load-env'
import { eq, and } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { suggestionLinks } from '../db/schema'
import { listSuggestions } from '../app/lib/team.server'
import {
  executeApprovedPromo,
  defaultPromoExecuteDeps,
  promoExecuteEnabled,
  PROMO_EXECUTE_VALVE,
} from '../app/lib/shopify-discounts.server'

/**
 * Execution step for the weekly strategy routine: mint a Shopify discount code
 * for every APPROVED, MAP-clean promo brief. Valve-gated by
 * `promo_execute_enabled` (default OFF): with the valve off this exits without
 * touching Shopify, the owner inbox, or any ticket.
 *
 * Fail-closed: MAP conflicts, missing windows, and promos with no resolvable
 * eligible product are refused (loud owner email plus ticket note), never
 * minted. Idempotent: a promo row that already carries an execution note
 * (minted, refused, or failed) is skipped, so re-running never double-mints or
 * re-spams the owner.
 */

const HANDLED_NOTE_RE = /discount code minted|REFUSED \(|mint FAILED/i

async function alreadyHandled(id: number): Promise<boolean> {
  const links = await db
    .select({ ref: suggestionLinks.ref })
    .from(suggestionLinks)
    .where(and(eq(suggestionLinks.suggestionId, id), eq(suggestionLinks.kind, 'note')))
  return links.some(l => HANDLED_NOTE_RE.test(l.ref ?? ''))
}

async function main(): Promise<void> {
  const deps = defaultPromoExecuteDeps()

  if (!promoExecuteEnabled(await deps.getSetting(PROMO_EXECUTE_VALVE))) {
    console.log(`[execute-promos] ${PROMO_EXECUTE_VALVE} is off. Nothing to do.`)
    return
  }

  const rows = await listSuggestions({
    team: 'strategy',
    kinds: ['promo'],
    statuses: ['approved'],
    orderBy: 'age',
  })

  if (rows.length === 0) {
    console.log('[execute-promos] No approved promo briefs. Clean run.')
    return
  }

  let minted = 0
  let refused = 0
  let skipped = 0
  for (const row of rows) {
    if (await alreadyHandled(row.id)) {
      skipped++
      console.log(`[execute-promos] #${row.id} already handled. Skipping.`)
      continue
    }
    const res = await executeApprovedPromo({ id: row.id, suggestion: row.suggestion }, deps)
    if (res.minted) {
      minted++
      console.log(`[execute-promos] #${row.id} minted ${res.code} (${res.discountId}).`)
    } else if (res.refused) {
      refused++
      console.log(`[execute-promos] #${row.id} refused: ${res.reason}.`)
    } else {
      console.log(`[execute-promos] #${row.id} not minted: ${res.reason}.`)
    }
  }

  console.log(`[execute-promos] done. minted=${minted} refused=${refused} skipped=${skipped} of ${rows.length}.`)
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[execute-promos] failed:', err)
    process.exit(1)
  })
