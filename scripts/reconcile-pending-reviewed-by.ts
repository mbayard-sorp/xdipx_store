/**
 * One-off reconcile for ticket #554: null out reviewed_by/reviewed_at on
 * import_candidates rows still sitting in 'pending'.
 *
 * A 'watching' decision used to stamp reviewed_by, and the monitor's
 * watching->pending reopen kept the stamp, so run137's sweep found 77 pending
 * rows carrying a product-manager-agent stamp (mostly the 07-21 batch). Those
 * rows burned the endpoint's per-day action cap on the day they were stamped
 * and clutter every later sweep. Going forward the stamp only lands with a
 * terminal transition (imported/rejected) and the reopen clears it; this
 * script cleans up the rows already in limbo.
 *
 * Idempotent, and dry-run by default:
 *
 *   DATABASE_URL=postgres://... tsx scripts/reconcile-pending-reviewed-by.ts           # report only
 *   DATABASE_URL=postgres://... tsx scripts/reconcile-pending-reviewed-by.ts --apply   # write
 */
import { neon } from '@neondatabase/serverless'

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL']
  if (!url) {
    console.error('DATABASE_URL is required.')
    process.exit(1)
  }
  const apply = process.argv.includes('--apply')
  const sql = neon(url)

  const stamped = await sql`
    SELECT id, sku, reviewed_by, reviewed_at::text AS reviewed_at
      FROM import_candidates
     WHERE status = 'pending' AND reviewed_by IS NOT NULL
     ORDER BY reviewed_at ASC`
  console.log(`${stamped.length} pending row(s) carry a reviewed_by stamp.`)
  for (const r of stamped) {
    console.log(`  #${r['id']} ${r['sku']} reviewed_by=${r['reviewed_by']} at ${r['reviewed_at']}`)
  }

  if (stamped.length === 0) return
  if (!apply) {
    console.log('\nDry run. Re-run with --apply to null these stamps.')
    return
  }

  const cleared = await sql`
    UPDATE import_candidates
       SET reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
     WHERE status = 'pending' AND reviewed_by IS NOT NULL
     RETURNING id`
  console.log(`\nCleared reviewed_by/reviewed_at on ${cleared.length} row(s).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
