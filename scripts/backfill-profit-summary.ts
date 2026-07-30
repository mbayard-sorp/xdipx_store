/**
 * Rebuild daily_profit_summary from Shopify's own paid orders, and remove the
 * dev seed rows that were standing in for real revenue.
 *
 *   DATABASE_URL=<prod> npx tsx scripts/backfill-profit-summary.ts
 *   DATABASE_URL=<prod> npx tsx scripts/backfill-profit-summary.ts --from 2026-07-23
 *   DATABASE_URL=<prod> npx tsx scripts/backfill-profit-summary.ts --keep-seed --dry-run
 *
 * Two jobs, in this order:
 *
 *  1. Delete the six `SEED-00x` rows (2026-03-26..31, 311 orders, $13,236.89).
 *     They came from db/seed.ts and were, until now, the entirety of the
 *     lifetime totals on the admin dashboard. Three weekly strategy briefs and
 *     several campaign proposals were built on the belief that they represented
 *     a real March launch. They did not, and leaving them in means every future
 *     retro compares real weeks against fiction.
 *  2. Recompute every day from --from through yesterday with the rewritten
 *     writeProfitSummary(), so the days that already have real orders (the
 *     first was 2026-07-23) finally show them.
 *
 * Needs SHOPIFY_ADMIN_ACCESS_TOKEN as well as DATABASE_URL.
 */

import { nextUtcDate, yesterdayUtc } from '../app/lib/profit.server'

/** First day with a real order in this store's history. */
const DEFAULT_FROM = '2026-07-23'

interface Args {
  from: string
  to: string
  keepSeed: boolean
  dryRun: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  return {
    from: value('--from') ?? DEFAULT_FROM,
    to: value('--to') ?? yesterdayUtc(),
    keepSeed: argv.includes('--keep-seed'),
    dryRun: argv.includes('--dry-run'),
  }
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = []
  let cursor = from
  // Inclusive of `to`, and guarded so a reversed range yields nothing rather
  // than looping forever.
  for (let i = 0; i < 400 && cursor <= to; i++) {
    out.push(cursor)
    cursor = nextUtcDate(cursor)
  }
  return out
}

async function main(): Promise<void> {
  const args = parseArgs()
  if (!process.env['DATABASE_URL']) throw new Error('DATABASE_URL is required')
  if (!process.env['SHOPIFY_ADMIN_ACCESS_TOKEN']) {
    throw new Error('SHOPIFY_ADMIN_ACCESS_TOKEN is required (orders come from the Admin API)')
  }

  const { deleteSeedProfitRows, writeProfitSummary, getProfitRows } = await import(
    '../app/lib/profit.server'
  )

  console.log(`[backfill] range ${args.from} .. ${args.to}${args.dryRun ? ' (dry run)' : ''}`)

  if (!args.keepSeed) {
    if (args.dryRun) {
      console.log('[backfill] would delete daily_profit_summary rows with featured_sku LIKE \'SEED-%\'')
    } else {
      const removed = await deleteSeedProfitRows()
      console.log(`[backfill] deleted ${removed} seed row(s)`)
    }
  }

  const dates = datesBetween(args.from, args.to)
  if (dates.length === 0) {
    console.warn('[backfill] empty date range, nothing to recompute')
    return
  }

  for (const date of dates) {
    if (args.dryRun) {
      console.log(`[backfill] would recompute ${date}`)
      continue
    }
    try {
      const t = await writeProfitSummary(date)
      const flag = t.cogsMissingUnits > 0 ? `  (cost unknown on ${t.cogsMissingUnits} unit(s))` : ''
      console.log(
        `[backfill] ${date}  orders=${t.totalOrders}  revenue=$${t.totalRevenue.toFixed(2)}  ` +
        `cogs=$${t.totalCogs.toFixed(2)}  profit=$${t.totalProfit.toFixed(2)}${flag}`,
      )
    } catch (err) {
      console.error(`[backfill] ${date} FAILED:`, err)
    }
  }

  if (!args.dryRun) {
    const rows = await getProfitRows(args.from, args.to)
    const orders = rows.reduce((n, r) => n + (r.totalOrders ?? 0), 0)
    const revenue = rows.reduce((n, r) => n + Number(r.totalRevenue ?? 0), 0)
    console.log(
      `[backfill] done: ${rows.length} row(s), ${orders} order(s), $${revenue.toFixed(2)} revenue`,
    )
  }
}

main().catch((err) => {
  console.error('[backfill] fatal:', err)
  process.exit(1)
})
