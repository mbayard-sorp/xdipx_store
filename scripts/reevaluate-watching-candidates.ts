/**
 * Re-evaluate import_candidates stuck in status='watching' after the MAP-floor
 * pricing fix (2026-07-21 incident: 131 tier-B candidates were parked because
 * computeTargetPrice discounted below MAP for non-restricted vendors; with
 * MAP == MSRP the preview showed ~20% off a price MAP forbids discounting).
 *
 * For every watching row this script recomputes the price preview from the
 * row's stored numbers using the fixed engine, then:
 *   - rows whose OLD proposed_price violated MAP (the incident cohort) get the
 *     corrected numbers and flip back to 'pending' so the product-manager
 *     queue re-presents them for an approve/reject decision
 *   - rows watching for other reasons keep their status; only their preview
 *     numbers and watch_price baseline are refreshed
 *
 * It never approves, rejects, or imports anything.
 *
 * Usage:
 *   npx tsx scripts/reevaluate-watching-candidates.ts          # dry run (default)
 *   npx tsx scripts/reevaluate-watching-candidates.ts --apply  # write changes
 *
 * DATABASE_URL is loaded from .env / .env.local.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 0) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = val
  }
}
loadEnvFile(join(process.cwd(), '.env'))
loadEnvFile(join(process.cwd(), '.env.local'))

import { neon } from '@neondatabase/serverless'
import { computeTargetPrice, type PricingSnapshot } from '../app/lib/pricing-engine.server'

interface WatchingRow {
  id: number
  sku: string
  brand: string | null
  tier: string
  msrp: string | null
  wholesale_cost: string | null
  map_price: string | null
  proposed_price: string | null
  in_sale_feed: boolean
  total_qty: number | null
  deal_score: string | null
}

async function main(): Promise<void> {
  if (!process.env['DATABASE_URL']) {
    console.error('DATABASE_URL is not set. Run from the repo root with .env present.')
    process.exit(1)
  }
  const apply = process.argv.includes('--apply')
  const sql = neon(process.env['DATABASE_URL']!)

  const rows = (await sql`
    SELECT id, sku, brand, tier, msrp, wholesale_cost, map_price, proposed_price,
           in_sale_feed, total_qty, deal_score
    FROM import_candidates
    WHERE status = 'watching'
    ORDER BY tier, deal_score DESC NULLS LAST
  `) as WatchingRow[]

  console.log(`${rows.length} watching candidate(s). Mode: ${apply ? 'APPLY' : 'dry run'}`)

  let reopened = 0
  let refreshed = 0
  let unchanged = 0
  let skipped = 0

  for (const row of rows) {
    const msrp = parseFloat(row.msrp ?? '0')
    const wholesale = parseFloat(row.wholesale_cost ?? '0')
    const map = parseFloat(row.map_price ?? '0')
    const oldProposed = parseFloat(row.proposed_price ?? '0')

    if (msrp <= 0 || wholesale <= 0) {
      console.warn(`  skip id=${row.id} sku=${row.sku}: missing msrp/wholesale`)
      skipped++
      continue
    }

    // Mirror the import-monitor preview snapshot exactly.
    const snapshot: PricingSnapshot = {
      sku: row.sku,
      vendor: row.brand,
      msrp,
      wholesale,
      mapPrice: map > 0 ? map : null,
      currentPrice: msrp,
      currentCompareAt: null,
      inSaleFeed: row.in_sale_feed,
      nalpacDiscountPct: null,
    }
    const result = computeTargetPrice(snapshot)
    const newProposed = result.newPrice
    const newMarginPct = result.marginPct * 100
    const newProfit = newProposed - wholesale

    const wasMapViolation = map > 0 && oldProposed < map
    const priceChanged = Math.abs(newProposed - oldProposed) >= 0.01

    if (!wasMapViolation && !priceChanged) {
      unchanged++
      continue
    }

    const nextStatus = wasMapViolation ? 'pending' : null
    console.log(
      `  id=${row.id} tier=${row.tier} sku=${row.sku} ${row.brand ?? ''}: ` +
      `$${oldProposed.toFixed(2)} -> $${newProposed.toFixed(2)} ` +
      `(msrp $${msrp.toFixed(2)}, map ${map > 0 ? '$' + map.toFixed(2) : 'none'}) ` +
      `${nextStatus ? 'watching -> pending' : 'numbers refreshed'}`,
    )

    if (apply) {
      if (nextStatus) {
        await sql`
          UPDATE import_candidates
          SET proposed_price = ${newProposed.toFixed(2)},
              margin_pct     = ${newMarginPct.toFixed(2)},
              profit_per_unit = ${newProfit.toFixed(2)},
              status         = 'pending',
              last_seen_at   = now(),
              updated_at     = now()
          WHERE id = ${row.id} AND status = 'watching'
        `
      } else {
        await sql`
          UPDATE import_candidates
          SET proposed_price = ${newProposed.toFixed(2)},
              margin_pct     = ${newMarginPct.toFixed(2)},
              profit_per_unit = ${newProfit.toFixed(2)},
              watch_price    = ${newProposed.toFixed(2)},
              last_seen_at   = now(),
              updated_at     = now()
          WHERE id = ${row.id} AND status = 'watching'
        `
      }
    }
    if (nextStatus) reopened++
    else refreshed++
  }

  console.log(
    `\nDone. reopened=${reopened} refreshed=${refreshed} unchanged=${unchanged} skipped=${skipped}` +
    (apply ? '' : ' (dry run, nothing written; rerun with --apply)'),
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
