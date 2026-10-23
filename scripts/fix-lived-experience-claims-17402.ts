/**
 * scripts/fix-lived-experience-claims-17402.ts
 *
 * Ticket #17402. Four PDPs give Emma lived experience, which the voice
 * charter bans outright (docs/emma-voice.md line ~133: "Emma is an AI and
 * never claims lived experience. She has never used, tried, tested, owned,
 * or held a product, and she has no partner, desk, drawer, or shelf.
 * Banned: 'been living on my desk', 'I reach for this', ... She speaks from
 * catalog knowledge ... In the desire-forward register she speaks to what
 * the reader will feel, never to what she has felt."). The paid-ads reviewer
 * skipped all four on run 1611 for exactly this reason. Same defect class
 * as #17134, different SKUs.
 *
 * The ticket named one violating line per product, but DONE WHEN asks that
 * the whole rendered .md page (products.$slug[.md].tsx, which pulls
 * descriptionHtml/tagline/full_story/feature_bullets from Shopify and FAQs
 * from Sanity) carry no first-person lived claim, not just the one quoted
 * line. Re-reading each product's full live copy (routine-dev-daily.md
 * Step 3f: re-check the cited source, not just the literal quoted text)
 * found a second, unticketed violation on solace-thrusting-masturbator's
 * descriptionHtml ("I love how it takes the guesswork out...") sitting next
 * to the one the ticket named. Both land in this same pass so the page does
 * not still fail the same check for a sibling line.
 *
 * Every replacement below is a hand-verified, minimal, literal edit: only
 * the lived-experience claim changes, nothing else about voice, structure,
 * specs, or other facts. Each is applied with an exact-match check against
 * the current live value (Shopify metafield/descriptionHtml, or Sanity FAQ
 * answer); a drifted value is skipped and reported rather than silently
 * mismatched. Follows the same pattern as scripts/fix-ipx-shower-claims.ts.
 *
 * Usage:
 *   npx tsx scripts/fix-lived-experience-claims-17402.ts            # dry run
 *   npx tsx scripts/fix-lived-experience-claims-17402.ts --apply    # writes
 */
import './_load-env'
import { adminGraphQL, updateProductDescriptionHtml, updateProductMetafield } from '../app/lib/shopify.server'
import { getProductFaqs, patchProductFaqAnswer } from '../app/lib/sanity.server'

const APPLY = process.argv.includes('--apply')

type Field = 'descriptionHtml' | 'tagline'

interface Repl {
  handle: string
  field: Field
  old: string
  new: string
}

const REPLACEMENTS: Repl[] = [
  // 1. le-wand-rechargeable-massager — Emma take (descriptionHtml).
  { handle: 'le-wand-rechargeable-massager', field: 'descriptionHtml',
    old: 'This is the wand that changed everything for me, Le Wand perfected the balance between power and finesse.',
    new: 'This is the wand that changes everything, Le Wand perfected the balance between power and finesse.' },

  // 2. solace-thrusting-masturbator — tagline (the ticketed line).
  { handle: 'solace-thrusting-masturbator', field: 'tagline',
    old: "The app-controlled intensity I didn't know I needed.",
    new: "The app-controlled intensity you didn't know you needed." },
  // 2b. solace-thrusting-masturbator — descriptionHtml (unticketed sibling
  // violation found while re-reading the full page; see file doc comment).
  { handle: 'solace-thrusting-masturbator', field: 'descriptionHtml',
    old: 'I love how it takes the guesswork out of finding your rhythm.',
    new: 'It takes the guesswork out of finding your rhythm.' },

  // 3. tantus-duchess-o2-dual-density-vibrating-dildo-quartz — Emma take (descriptionHtml).
  { handle: 'tantus-duchess-o2-dual-density-vibrating-dildo-quartz', field: 'descriptionHtml',
    old: 'This has been living on my desk for weeks because I keep reaching for it to show people what dual density <em>should</em> feel like.',
    new: 'This is what dual density <em>should</em> feel like.' },
]

// bloomgasm-10x-wild-silicone-suction-clit-stimulator's violation is a
// Sanity productPage.productFaqs answer, a different surface from the
// Shopify metafields above (same split scripts/fix-ipx-shower-claims.ts
// already draws for its own FAQ corrections).
const FAQ_CORRECTIONS: Array<{ handle: string; oldAnswer: string; newAnswer: string }> = [
  { handle: 'bloomgasm-10x-wild-silicone-suction-clit-stimulator',
    oldAnswer: "Absolutely. The rose design is so convincing that most people won't give it a second glance. I've had mine sitting on shelves and desks without anyone batting an eye.",
    newAnswer: "Absolutely. The rose design is so convincing that most people won't give it a second glance. It blends into a shelf or desk without anyone batting an eye." },
]

console.log(`${REPLACEMENTS.length} Shopify replacement(s) across ${new Set(REPLACEMENTS.map(r => r.handle)).size} product(s)`)

const METAFIELD_TYPES: Record<Exclude<Field, 'descriptionHtml'>, string> = {
  tagline: 'single_line_text_field',
}

interface GqlProduct {
  legacyResourceId: string
  title: string
  handle: string
  descriptionHtml: string | null
  metafields: { nodes: { key: string; value: string }[] }
}

const byHandle = new Map<string, Repl[]>()
for (const r of REPLACEMENTS) {
  if (!byHandle.has(r.handle)) byHandle.set(r.handle, [])
  byHandle.get(r.handle)!.push(r)
}

let lastRestCallAt = 0
async function restGate(): Promise<void> {
  const minGapMs = 560
  const wait = lastRestCallAt + minGapMs - Date.now()
  if (wait > 0) await new Promise(res => setTimeout(res, wait))
  lastRestCallAt = Date.now()
}

let totalFieldChanges = 0
let notFoundCount = 0
let appliedProducts = 0

for (const [handle, repls] of byHandle) {
  const data: { products: { nodes: GqlProduct[] } } = await adminGraphQL(`
    query { products(first: 1, query: "handle:${handle}") {
      nodes { legacyResourceId title handle descriptionHtml metafields(namespace: "xdipx", first: 30) { nodes { key value } } }
    } }`)
  const p = data.products.nodes[0]
  if (!p) {
    console.error(`SKIP ${handle}: product not found (handle may have changed)`)
    continue
  }

  const currentByField = new Map<Field, string>()
  currentByField.set('descriptionHtml', p.descriptionHtml ?? '')
  for (const m of p.metafields.nodes) {
    if (m.key === 'tagline') currentByField.set('tagline', m.value)
  }

  const fieldGroups = new Map<Field, Repl[]>()
  for (const r of repls) {
    if (!fieldGroups.has(r.field)) fieldGroups.set(r.field, [])
    fieldGroups.get(r.field)!.push(r)
  }

  const writes: { field: Field; text: string }[] = []
  for (const [field, group] of fieldGroups) {
    let current = currentByField.get(field)
    if (current === undefined) {
      console.error(`SKIP ${handle} ${field}: field not present on product`)
      notFoundCount += group.length
      continue
    }
    let changedHere = false
    for (const r of group) {
      if (!current.includes(r.old)) {
        console.error(`NOT FOUND ${handle} ${field}: old text has drifted, skipping this replacement\n  expected: ${r.old}`)
        notFoundCount++
        continue
      }
      current = current.replace(r.old, r.new)
      changedHere = true
      totalFieldChanges++
    }
    if (changedHere) writes.push({ field, text: current })
  }

  if (!writes.length) continue

  console.log(`\n[${handle}] ${p.title}`)
  for (const w of writes) console.log(`  ${w.field}:\n    ${w.text}`)

  if (!APPLY) continue

  async function writeField(w: { field: Field; text: string }, attempts = 5): Promise<boolean> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await restGate()
        if (w.field === 'descriptionHtml') {
          await updateProductDescriptionHtml(`gid://shopify/Product/${p!.legacyResourceId}`, w.text)
        } else {
          await updateProductMetafield(`gid://shopify/Product/${p!.legacyResourceId}`, w.field, w.text, METAFIELD_TYPES[w.field])
        }
        return true
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`  write attempt ${attempt} failed ${handle} ${w.field}: ${msg}`)
        await new Promise(res => setTimeout(res, msg.includes('429') ? 2500 : attempt * 1000))
      }
    }
    console.error(`  WRITE FAILED (all retries exhausted) ${handle} ${w.field}`)
    return false
  }

  for (const w of writes) {
    await writeField(w)
  }

  appliedProducts++
}

console.log(`\n${APPLY ? 'applied' : '[dry-run] would apply'} to ${appliedProducts} product(s), ${totalFieldChanges} field replacement(s) matched, ${notFoundCount} not found (drift)`)

// ── Sanity productPage.productFaqs correction ───────────────────────────────
console.log(`\n── FAQ answer correction (Sanity productPage.productFaqs) ──`)
let faqPatched = 0
let faqAlready = 0
let faqDrift = 0
for (const c of FAQ_CORRECTIONS) {
  if (!APPLY) {
    const faqs = await getProductFaqs(c.handle)
    const hasOld = faqs.some(f => f.answer === c.oldAnswer)
    const hasNew = faqs.some(f => f.answer === c.newAnswer)
    console.log(`  [${c.handle}] ${hasNew ? 'already corrected' : hasOld ? 'would correct' : 'OLD ANSWER NOT FOUND (drift)'}`)
    if (!hasNew && !hasOld) faqDrift++
    if (!hasNew && hasOld) console.log(`    -> ${c.newAnswer}`)
    continue
  }
  const result = await patchProductFaqAnswer(c.handle, c.oldAnswer, c.newAnswer)
  console.log(`  [${c.handle}] ${result}`)
  if (result === 'patched') faqPatched++
  else if (result === 'already') faqAlready++
  else faqDrift++
}
console.log(`  ${APPLY ? `patched ${faqPatched}, already ${faqAlready}` : '[dry-run]'}, ${faqDrift} drift`)
