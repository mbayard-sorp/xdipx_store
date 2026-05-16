/**
 * dump-discovery-vocab.ts
 *
 * Read-only dump of every distinct mood / audience / matters tag in use
 * across active Shopify products, with product counts. Use this to plan
 * tag consolidation: spot duplicates, near-duplicates, and cross-taxonomy
 * contamination (mood tags that look like matters, etc.).
 *
 * Tags are reported in the canonical Title-Case storage form used by the
 * home page (via normalizeTag) so the output matches the chip vocabulary
 * the UI renders. Display-form (hyphen→space) is also shown for context.
 *
 * Usage:
 *   tsx scripts/dump-discovery-vocab.ts                    # human-readable
 *   tsx scripts/dump-discovery-vocab.ts --csv              # CSV, all groups
 *   tsx scripts/dump-discovery-vocab.ts --csv --group mood
 *
 * Exit codes:
 *   0  success
 *   1  Shopify env not configured or fetch failed
 */

import './_load-env'
import { buildDiscoveryIndex } from '~/lib/discovery.server'
import { displayLabel } from '~/lib/discovery-tags'

type Group = 'mood' | 'audience' | 'matters'
const GROUPS: Group[] = ['mood', 'audience', 'matters']

async function main() {
  if (!process.env['SHOPIFY_STORE_DOMAIN'] || !process.env['SHOPIFY_ADMIN_ACCESS_TOKEN']) {
    process.stderr.write(
      'ERROR: SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN is unset.\n' +
      '       Run scripts/setup-worktree.sh from the main repo to symlink env files.\n',
    )
    process.exit(1)
  }

  const args = process.argv.slice(2)
  const asCSV = args.includes('--csv')
  const groupArgIdx = args.indexOf('--group')
  const onlyGroup = groupArgIdx >= 0 ? (args[groupArgIdx + 1] as Group | undefined) : undefined
  if (onlyGroup && !GROUPS.includes(onlyGroup)) {
    process.stderr.write(`ERROR: --group must be one of ${GROUPS.join(', ')}\n`)
    process.exit(1)
  }

  const index = await buildDiscoveryIndex()
  if (index.length === 0) {
    process.stderr.write('No mappable products returned from Shopify.\n')
    process.exit(1)
  }

  const tallies: Record<Group, Map<string, number>> = {
    mood:     new Map(),
    audience: new Map(),
    matters:  new Map(),
  }
  for (const p of index) {
    for (const m of p.mood)     tallies.mood.set(m,     (tallies.mood.get(m)     ?? 0) + 1)
    for (const a of p.audience) tallies.audience.set(a, (tallies.audience.get(a) ?? 0) + 1)
    for (const k of p.matters)  tallies.matters.set(k,  (tallies.matters.get(k)  ?? 0) + 1)
  }

  if (asCSV) {
    process.stdout.write('group,storage_value,display_label,product_count\n')
    for (const g of (onlyGroup ? [onlyGroup] : GROUPS)) {
      const rows = Array.from(tallies[g].entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      for (const [v, n] of rows) {
        process.stdout.write(`${g},${JSON.stringify(v)},${JSON.stringify(displayLabel(v))},${n}\n`)
      }
    }
    return
  }

  for (const g of (onlyGroup ? [onlyGroup] : GROUPS)) {
    const rows = Array.from(tallies[g].entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    process.stdout.write(`\n${g.toUpperCase()}  (${rows.length} distinct values across ${index.length} products)\n`)
    process.stdout.write('─'.repeat(70) + '\n')
    for (const [v, n] of rows) {
      const display = displayLabel(v)
      const label = display === v ? v : `${v.padEnd(28)}  → "${display}"`
      process.stdout.write(`  ${String(n).padStart(4)}  ${label}\n`)
    }
  }
  process.stdout.write('\n')
}

main().catch(err => {
  process.stderr.write(`FAILED: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
