/**
 * One-off bulk import of Nalpac new-items candidates.
 *
 * Selects import_candidates rows with in_new_feed = true and status = 'pending'
 * that were seen in today's feed run (last_seen_at today), then approves each
 * through approveAndImport() — the same path the product-manager agent uses,
 * minus the team API's per-day action cap. Each approval lands a Shopify DRAFT
 * + dealHistory queue row + Sanity stub; enrichment and publish happen in the
 * separate batched enrichment pass.
 *
 *   npx tsx scripts/import-new-items.ts                 # dry-run: list candidates, no writes
 *   npx tsx scripts/import-new-items.ts --apply         # approve + import
 *   npx tsx scripts/import-new-items.ts --apply --limit 10
 *   npx tsx scripts/import-new-items.ts --all-pending   # include stale rows not in today's feed
 */

import 'dotenv/config'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { importCandidates } from '../db/schema'
import { approveAndImport } from '~/lib/import-monitor.server'
import { fetchAllNalpacFeeds } from '~/lib/nalpac-feeds.server'
import { collapseMasters } from '~/lib/master-collapse.server'

interface Args {
  apply: boolean
  limit?: number
  allPending: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let apply = false
  let limit: number | undefined
  let allPending = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') apply = true
    else if (a === '--all-pending') allPending = true
    else if (a === '--limit') limit = parseInt(argv[++i] ?? '', 10)
    else if (a?.startsWith('--limit=')) limit = parseInt(a.slice(8), 10)
  }
  return { apply, allPending, ...(limit !== undefined ? { limit } : {}) }
}

async function main(): Promise<void> {
  const args = parseArgs()

  const conditions = [
    eq(importCandidates.inNewFeed, true),
    eq(importCandidates.status, 'pending'),
  ]
  if (!args.allPending) {
    conditions.push(sql`${importCandidates.lastSeenAt}::date = current_date`)
  }

  let rows = await db
    .select()
    .from(importCandidates)
    .where(and(...conditions))
    .orderBy(importCandidates.id)
  if (args.limit !== undefined) rows = rows.slice(0, args.limit)

  console.log(
    `${rows.length} pending new-feed candidate(s)` +
      (args.allPending ? ' (including stale)' : ' seen in today’s feed')
  )
  console.log('')
  for (const c of rows) {
    const margin = c.marginPct != null ? `${c.marginPct}%` : '—'
    console.log(
      `#${c.id}\t${c.sku}\ttier ${c.tier}\tqty ${c.qtyAvailable ?? '?'}\tmargin ${margin}\t${c.variantCount ?? 1} variant(s)\t${(c.baseTitle ?? c.productTitle ?? '').slice(0, 70)}`
    )
  }

  if (!args.apply) {
    console.log('\nDry run. Re-run with --apply to approve + import.')
    process.exit(0)
  }

  console.log('\nImporting...\n')
  // Fetch + collapse the feed ONCE for the whole run. The main-feed payload is
  // too large for the KV cache, so letting approveAndImport fetch per candidate
  // costs ~2 min each.
  const feedResult = await fetchAllNalpacFeeds()
  const preloadedMasters = collapseMasters(feedResult.snapshots)
  console.log(`feed loaded: ${preloadedMasters.length} masters\n`)
  let imported = 0
  let skipped = 0
  const failed: Array<{ id: number; sku: string; error: string }> = []

  for (const c of rows) {
    try {
      const result = await approveAndImport(c.id, 'new-items-bulk', { preloadedMasters })
      if (result.ok && result.skipped) {
        skipped++
        console.log(`#${c.id} ${c.sku} — already imported, skipped`)
      } else if (result.ok) {
        imported++
        console.log(`#${c.id} ${c.sku} — imported (shopify ${result.shopifyProductId}, dealHistory ${result.dealHistoryId})`)
      } else {
        failed.push({ id: c.id, sku: c.sku, error: result.error ?? 'unknown' })
        console.log(`#${c.id} ${c.sku} — FAILED: ${result.error}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failed.push({ id: c.id, sku: c.sku, error: msg })
      console.log(`#${c.id} ${c.sku} — THREW: ${msg}`)
    }
  }

  console.log('\n=== Summary ===')
  console.log(`imported: ${imported}`)
  console.log(`skipped (already imported): ${skipped}`)
  console.log(`failed: ${failed.length}`)
  for (const f of failed) console.log(`  #${f.id} ${f.sku}: ${f.error}`)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
