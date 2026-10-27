/**
 * Ticket #18043: the Shopify title for la-nua-mist-toy-cleaner reads "Mist
 * Fragrance-Free Toy Cleaner 6.8oz". La Nua's own product page for this
 * cleaner lists Lavandula Angustifolia (lavender) Oil in its ingredients and
 * describes the mist as enhanced with lavender oil, so our title asserts a
 * fragrance-free fact the manufacturer's own listing contradicts. Our stored
 * descriptionHtml already hedges this correctly ("Fragrance-free on the
 * label, with just a whisper of lavender..."); the title does not.
 *
 * Fix: drop the unqualified claim from the title rather than asserting a new
 * one (both are accepted by the ticket's DONE WHEN). "Mist Fragrance-Free Toy
 * Cleaner 6.8oz" -> "Mist Toy Cleaner 6.8oz". Nothing else about the title
 * changes.
 *
 * Applied with an exact-match guard against the live title; if it has
 * drifted since this was written, the product is skipped and reported
 * rather than silently overwritten.
 *
 * Second half of the ticket ("whatever wrote it is checked for the same
 * pattern across the other Toy Cleaner titles"): sweeps every live
 * product_type:"Toy Cleaner" title for an explicit scent-free claim
 * (fragrance-free / unscented / scent-free / perfume-free / scentless) and
 * flags any whose own descriptionHtml contradicts it by naming a scent
 * ingredient. Read-only, always runs, both in dry-run and --apply. Found one
 * other title carrying such a claim (good-clean-fun-toy-cleaner-unscented-1-oz,
 * "Unscented") and its own description is self-consistent ("free of
 * fragrance or residue... no added scent"), so no second defect to fix.
 *
 * Usage:
 *   npx tsx scripts/fix-la-nua-fragrance-claim-18043.ts             # dry run
 *   npx tsx scripts/fix-la-nua-fragrance-claim-18043.ts --apply     # writes the title
 */
import './_load-env'
import { adminGraphQL, updateProductTitle } from '../app/lib/shopify.server'

const APPLY = process.argv.includes('--apply')

const HANDLE = 'la-nua-mist-toy-cleaner'
const OLD_TITLE = 'Mist Fragrance-Free Toy Cleaner 6.8oz'
const NEW_TITLE = 'Mist Toy Cleaner 6.8oz'

const SCENT_FREE_CLAIM_RE = /\b(fragrance-free|fragrance free|unscented|scent-free|scent free|perfume-free|perfume free|scentless)\b/i
/** Matches a named scent/essential-oil ingredient a "scent-free" title claim would contradict. */
const SCENT_INGREDIENT_RE = /\b(lavender|lavandula|vanilla|citrus|rose|jasmine|mint|peppermint|eucalyptus|essential oil)\b/i

interface GqlProduct {
  id: string
  handle: string
  title: string
  descriptionHtml: string | null
}

async function fixLaNuaTitle(): Promise<void> {
  const data = await adminGraphQL<{ productByHandle: GqlProduct | null }>(`
    query P($handle: String!) {
      productByHandle(handle: $handle) { id handle title descriptionHtml }
    }
  `, { handle: HANDLE })

  const product = data.productByHandle
  if (!product) {
    console.error(`SKIP ${HANDLE}: product not found`)
    return
  }
  if (product.title !== OLD_TITLE) {
    console.error(`SKIP ${HANDLE}: title has drifted from the expected value, not overwriting\n  expected: ${OLD_TITLE}\n  actual:   ${product.title}`)
    return
  }

  console.log(`[${HANDLE}]\n  old: ${product.title}\n  new: ${NEW_TITLE}`)
  if (!APPLY) return

  await updateProductTitle(product.id, NEW_TITLE)

  const check = await adminGraphQL<{ productByHandle: { title: string } | null }>(`
    query P($handle: String!) { productByHandle(handle: $handle) { title } }
  `, { handle: HANDLE })
  if (check.productByHandle?.title !== NEW_TITLE) {
    console.error(`  WARNING: ${HANDLE} title did not persist on read-back (got "${check.productByHandle?.title}")`)
  } else {
    console.log(`  applied and confirmed on read-back`)
  }
}

/** Strips HTML tags for a plain-text contradiction check. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ')
}

async function sweepToyCleanerTitles(): Promise<void> {
  console.log(`\n── sweep: Toy Cleaner titles claiming scent-free vs. own description ──`)
  const data = await adminGraphQL<{ products: { nodes: GqlProduct[] } }>(`
    query { products(first: 50, query: "product_type:'Toy Cleaner'") {
      nodes { id handle title descriptionHtml }
    } }
  `)

  const flagged: string[] = []
  for (const p of data.products.nodes) {
    if (!SCENT_FREE_CLAIM_RE.test(p.title)) continue
    const desc = stripHtml(p.descriptionHtml ?? '')
    const descClaimMatch = p.title.match(SCENT_FREE_CLAIM_RE)?.[0] ?? 'scent-free claim'
    const ingredientMatch = desc.match(SCENT_INGREDIENT_RE)?.[0]
    if (ingredientMatch) {
      flagged.push(p.handle)
      console.log(`  CONTRADICTION [${p.handle}] title claims "${descClaimMatch}" but description names "${ingredientMatch}"\n    title: ${p.title}`)
    } else {
      console.log(`  ok [${p.handle}] title claims "${descClaimMatch}", description is self-consistent (no named scent ingredient)`)
    }
  }
  console.log(`  ${flagged.length} title(s) with a scent-free/ingredient contradiction: ${flagged.join(', ') || 'none'}`)
}

async function main() {
  await fixLaNuaTitle()
  await sweepToyCleanerTitles()
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
