/**
 * Reconcile Sanity productPage docs against Shopify product status.
 *
 * Sets `archived: true` on every live productPage whose Shopify counterpart is
 * archived or gone, so on-site + IVR search stop matching docs that can no
 * longer hydrate a PDP. See app/lib/sanity-shopify-reconcile.server.ts.
 *
 * Dry-run (default):  npx tsx scripts/reconcile-sanity-shopify-archived.ts
 * Apply:              npx tsx scripts/reconcile-sanity-shopify-archived.ts --apply
 * Apply over cap:     npx tsx scripts/reconcile-sanity-shopify-archived.ts --apply --force
 *
 * The same reconcile runs on a cron step alongside /cron/discontinued-sweep.
 */
import 'dotenv/config'
import { reconcileArchivedProductPages } from '../app/lib/sanity-shopify-reconcile.server'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')

async function main() {
  console.log(`[reconcile] ${APPLY ? (FORCE ? 'APPLY (forced)' : 'APPLY') : 'DRY-RUN'} — scanning Sanity vs Shopify...`)
  const r = await reconcileArchivedProductPages({ apply: APPLY, force: FORCE })

  console.log('\n[reconcile] result:')
  console.log(`  Sanity live docs:        ${r.sanityLive}`)
  console.log(`  Shopify sellable:        ${r.shopifySellable}`)
  console.log(`  Shopify archived:        ${r.shopifyArchived}`)
  console.log(`  Flagged (archived/gone): ${r.flagged}  (${r.archivedInShopify} archived-in-shopify, ${r.goneFromShopify} gone)`)
  console.log(`  Patched:                 ${r.patched}`)

  if (r.sample.length > 0) {
    console.log('\n[reconcile] sample flagged handles:')
    for (const s of r.sample) console.log(`  - ${s.handle}  (${s.reason})`)
    if (r.flagged > r.sample.length) console.log(`  ... and ${r.flagged - r.sample.length} more`)
  }

  if (r.skippedForSafety) {
    console.warn(`\n[reconcile] APPLY SKIPPED FOR SAFETY: ${r.skippedForSafety.reason}`)
    process.exit(2)
  }

  if (r.errors.length > 0) {
    console.error(`\n[reconcile] ${r.errors.length} per-doc patch error(s):`)
    for (const e of r.errors) console.error(`  - ${e.handle}: ${e.message}`)
    process.exit(1)
  }

  if (!APPLY && r.flagged > 0) {
    console.log('\n[reconcile] dry-run only — re-run with --apply to patch.')
  }
}

main().catch(err => {
  console.error('[reconcile] fatal:', err)
  process.exit(1)
})
