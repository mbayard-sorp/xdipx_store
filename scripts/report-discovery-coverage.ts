/**
 * report-discovery-coverage.ts
 *
 * Prints how many active Shopify products carry the metafields the home page
 * discovery surface needs (mood / audience / matters / product_type_dial).
 * Read-only — no writes. Hits Admin GraphQL via the regular server adapter
 * and is paginated by `buildDiscoveryIndex()`.
 *
 * Usage:
 *   tsx scripts/report-discovery-coverage.ts
 *
 * Output: human-readable summary to stdout, plus per-Category counts.
 * Exit codes:
 *   0 — success
 *   1 — env not configured or Shopify request failed
 */

import './_load-env'
import { reportTagCoverage } from '~/lib/discovery.server'

function pct(n: number, d: number): string {
  if (d === 0) return '  0.0%'
  return `${((n / d) * 100).toFixed(1).padStart(5, ' ')}%`
}

async function main() {
  if (!process.env['SHOPIFY_STORE_DOMAIN'] || !process.env['SHOPIFY_ADMIN_ACCESS_TOKEN']) {
    process.stderr.write(
      'ERROR: SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN is unset.\n' +
      '       Run scripts/setup-worktree.sh from the main repo to symlink env files.\n',
    )
    process.exit(1)
  }

  const r = await reportTagCoverage()

  const lines: string[] = []
  lines.push('Discovery tag coverage')
  lines.push('======================')
  lines.push(`Total mappable products:   ${r.total}`)
  lines.push('')
  lines.push(`withMood:                  ${r.withMood.toString().padStart(5)}  (${pct(r.withMood, r.total)})`)
  lines.push(`withAudience:              ${r.withAudience.toString().padStart(5)}  (${pct(r.withAudience, r.total)})`)
  lines.push(`withMatters:               ${r.withMatters.toString().padStart(5)}  (${pct(r.withMatters, r.total)})`)
  lines.push(`withAllThree:              ${r.withAllThree.toString().padStart(5)}  (${pct(r.withAllThree, r.total)})`)
  lines.push('')
  lines.push('Per Category')
  lines.push('------------')
  for (const [cat, n] of Object.entries(r.byCategory)) {
    lines.push(`  ${cat.padEnd(10)} ${n.toString().padStart(5)}  (${pct(n, r.total)})`)
  }
  lines.push('')

  const moodPct = r.total === 0 ? 0 : r.withMood / r.total
  const allPct  = r.total === 0 ? 0 : r.withAllThree / r.total
  if (moodPct < 0.30) {
    lines.push('WARNING: withMood < 30%. Trigger Phase 1.5 tag remediation before launch.')
  }
  if (allPct < 0.15) {
    lines.push('WARNING: withAllThree < 15%. Variant B results section will look skeletal.')
  }

  process.stdout.write(lines.join('\n') + '\n')
}

main().catch(err => {
  process.stderr.write(`FAILED: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
