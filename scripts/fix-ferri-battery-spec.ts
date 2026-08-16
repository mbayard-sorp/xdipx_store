/**
 * Ticket #1511: the live PDP for ferri-bluetooth-remote-controlled-panty-
 * vibrator understates its own battery life. Stored copy says "Battery
 * Life: Up to 2 hours continuous" and a feature bullet says "2-hour battery
 * life outlasts most Netflix episodes", but Lovense's own Ferri user manual
 * lists up to 195 minutes (about 3 hours) on a 60-minute charge, and
 * independent retail listings converge on 3 to 3.5 hours (source: ticket
 * #1511 body, filed by the content team's accuracy gate against the real
 * manufacturer manual). This script could not independently re-verify that
 * figure from inside this sandbox (no working web fetch), so it treats the
 * ticket's own cited manufacturer figure as the real source per the
 * DONE WHEN instruction, rather than inventing a number.
 *
 * Three fields carry the same wrong figure: xdipx.specifications,
 * xdipx.feature_bullets, and xdipx.full_story. All three are corrected to
 * "up to 3 hours" (a safe, slightly conservative rounding of 195 minutes).
 *
 * A broader sweep of every other Lovense SKU's battery-life claim
 * (scripts/_lovense-battery-sweep output, see PR body) found ~20 more
 * products, several with suspiciously round numbers ("2 hours", "4 hours",
 * "5 hours", "8 hours") that could carry the same error, and several with
 * precise, oddly-specific figures ("175 minutes", "97-170 minutes", "1 hour
 * 38 minutes") that look properly sourced. This script does NOT touch any
 * of those: no real source was available in this session to establish
 * their true figures, and the ticket's own DONE WHEN instructs correcting
 * against a real source, not guessing from a formatting pattern.
 *
 * Usage:
 *   npx tsx scripts/fix-ferri-battery-spec.ts             # dry run
 *   npx tsx scripts/fix-ferri-battery-spec.ts --apply     # writes to Shopify (+ Sanity mirror)
 */
import './_load-env'
import { adminGraphQL, updateProductMetafield } from '~/lib/shopify.server'

const APPLY = process.argv.includes('--apply')
const HANDLE = 'ferri-bluetooth-remote-controlled-panty-vibrator'

interface Repl { field: 'specifications' | 'feature_bullets' | 'full_story'; old: string; new: string }

const REPLACEMENTS: Repl[] = [
  { field: 'specifications',
    old: 'Battery Life: Up to 2 hours continuous',
    new: 'Battery Life: Up to 3 hours continuous (per manufacturer manual: 195 minutes on a 60-minute charge)' },
  { field: 'feature_bullets',
    old: '2-hour battery life provides plenty of power for extended adventures — how long can you last?',
    new: '3-hour battery life provides plenty of power for extended adventures, how long can you last?' },
  { field: 'full_story',
    old: '<li>2-hour battery life outlasts most Netflix episodes</li>',
    new: '<li>3-hour battery life outlasts most movies</li>' },
]

const METAFIELD_TYPES: Record<Repl['field'], string> = {
  specifications: 'multi_line_text_field',
  feature_bullets: 'json',
  full_story: 'multi_line_text_field',
}

const data: { products: { nodes: { legacyResourceId: string; title: string; handle: string; metafields: { nodes: { key: string; value: string; type: string }[] } }[] } } = await adminGraphQL(`
  query { products(first: 1, query: "handle:${HANDLE}") {
    nodes { legacyResourceId title handle metafields(namespace: "xdipx", first: 30) { nodes { key value type } } }
  } }`)
const p = data.products.nodes[0]
if (!p) { console.error(`Product ${HANDLE} not found`); process.exit(1) }

let matched = 0
let drifted = 0
for (const r of REPLACEMENTS) {
  const mf = p.metafields.nodes.find(m => m.key === r.field)
  if (!mf) { console.error(`SKIP ${r.field}: metafield not present`); continue }
  if (mf.type !== METAFIELD_TYPES[r.field]) {
    console.error(`WARNING ${r.field}: expected type ${METAFIELD_TYPES[r.field]}, live type is ${mf.type} — using live type`)
  }
  if (!mf.value.includes(r.old)) {
    console.error(`NOT FOUND ${r.field}: old text has drifted, skipping\n  expected: ${r.old}`)
    drifted++
    continue
  }
  const newValue = mf.value.replace(r.old, r.new)
  if (r.field === 'feature_bullets') {
    try { JSON.parse(newValue) } catch {
      console.error(`ABORT ${r.field}: replacement produced invalid JSON`)
      continue
    }
  }
  matched++
  console.log(`\n${r.field}:`)
  console.log(`  BEFORE: ${mf.value}`)
  console.log(`  AFTER:  ${newValue}`)

  if (!APPLY) continue
  try {
    await updateProductMetafield(`gid://shopify/Product/${p.legacyResourceId}`, r.field, newValue, mf.type || METAFIELD_TYPES[r.field])
    console.log(`  written.`)
  } catch (err) {
    console.error(`  WRITE FAILED: ${err instanceof Error ? err.message : err}`)
  }
}

console.log(`\n${APPLY ? 'applied' : '[dry-run] would apply'}: ${matched} matched, ${drifted} drifted/not found`)
process.exit(0)
