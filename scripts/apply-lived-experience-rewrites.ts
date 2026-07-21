/**
 * Apply voice-gated lived-experience rewrites to Shopify (+ Sanity mirror).
 *
 * Input: the rewrites JSON from scripts/rewrite-lived-experience.ts, plus an
 * optional verdicts JSON from the emma-empathy-reviewer gate:
 *   [{ "productId": 123, "field": "body_html", "verdict": "PASS" | "REVISE" | "BLOCK", "rewrite"?: "…" }]
 * With a verdicts file, only PASS entries (and REVISE entries whose suggested
 * rewrite passed the regex re-check upstream, supplied via "rewrite") are
 * applied; BLOCK entries are skipped and listed. Without one, nothing applies
 * unless --no-gate is passed explicitly.
 *
 * Usage:
 *   npx tsx scripts/apply-lived-experience-rewrites.ts --rewrites r.json --verdicts v.json [--dry-run]
 */
import { readFileSync } from 'node:fs'
import {
  updateProductMetafield,
  updateProductDescriptionHtml,
} from '~/lib/shopify.server'
import { upsertProductPage } from '~/lib/sanity.server'

interface Rewrite { productId: number; handle: string; title: string; field: string; old: string; new: string }
interface Verdict { productId: number; field: string; verdict: 'PASS' | 'REVISE' | 'BLOCK'; rewrite?: string }

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? process.argv[i + 1] : undefined
}
const rewritesPath = arg('--rewrites')
const verdictsPath = arg('--verdicts')
const dryRun = process.argv.includes('--dry-run')
const noGate = process.argv.includes('--no-gate')
if (!rewritesPath || (!verdictsPath && !noGate)) {
  console.error('usage: npx tsx scripts/apply-lived-experience-rewrites.ts --rewrites r.json --verdicts v.json [--dry-run]')
  process.exit(1)
}

const rewrites: Rewrite[] = JSON.parse(readFileSync(rewritesPath, 'utf8'))
const verdicts: Verdict[] = verdictsPath ? JSON.parse(readFileSync(verdictsPath, 'utf8')) : []
const vKey = (p: number, f: string) => `${p}::${f}`
const verdictMap = new Map(verdicts.map(v => [vKey(v.productId, v.field), v]))

const METAFIELD_TYPES: Record<string, string> = {
  tagline:              'single_line_text_field',
  full_story:           'multi_line_text_field',
  seo_meta_description: 'multi_line_text_field',
  emma_hero:            'json',
  pairing_why:          'json',
  feature_bullets:      'json',
}

let applied = 0, blocked = 0, missing = 0, failed = 0
const blockedList: Rewrite[] = []

for (const r of rewrites) {
  let text = r.new
  if (!noGate) {
    const v = verdictMap.get(vKey(r.productId, r.field))
    if (!v) { missing++; continue }
    if (v.verdict === 'BLOCK') { blocked++; blockedList.push(r); continue }
    if (v.verdict === 'REVISE') {
      if (!v.rewrite) { blocked++; blockedList.push(r); continue }
      text = v.rewrite
    }
  }
  if (dryRun) { applied++; continue }
  const gid = `gid://shopify/Product/${r.productId}`
  try {
    if (r.field === 'body_html') {
      await updateProductDescriptionHtml(gid, text)
    } else {
      const type = METAFIELD_TYPES[r.field]
      if (!type) throw new Error(`no metafield type mapping for field ${r.field}`)
      await updateProductMetafield(gid, r.field, text, type)
    }
    // Sanity productPage mirror for the search/voice surfaces.
    const mirror: Record<string, string> = {}
    if (r.field === 'tagline')              mirror['tagline'] = text
    if (r.field === 'body_html')            mirror['description'] = text
    if (r.field === 'seo_meta_description') mirror['seoDescription'] = text
    if (Object.keys(mirror).length) {
      try {
        await upsertProductPage({ handle: r.handle, shopifyProductId: gid, title: r.title, ...mirror })
      } catch (err) {
        console.warn(`sanity mirror failed for ${r.productId} ${r.field}: ${err instanceof Error ? err.message : err}`)
      }
    }
    applied++
    if (applied % 25 === 0) console.log(`…applied ${applied}`)
    await new Promise(res => setTimeout(res, 350))
  } catch (err) {
    failed++
    console.error(`apply failed ${r.productId} ${r.field}: ${err instanceof Error ? err.message : err}`)
  }
}

console.log(`\n${dryRun ? '[dry-run] would apply' : 'applied'} ${applied}, blocked ${blocked}, no-verdict ${missing}, failed ${failed}`)
if (blockedList.length) {
  console.log('blocked fields:')
  for (const b of blockedList) console.log(`  - ${b.productId} ${b.field} (${b.title})`)
}
process.exit(failed ? 1 : 0)
