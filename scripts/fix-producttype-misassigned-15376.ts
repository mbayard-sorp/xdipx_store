/**
 * Ticket #15376, follow-up to #14756: re-sets Shopify product_type on the
 * specific live rows the enrich-time derivation bug (fixed in
 * app/lib/product-type-derive.ts, same ticket) mis-typed. These are NOT
 * re-derived from the current (post-fix) feed categories here — the fix
 * already proved itself against each one's real category set in
 * app/lib/product-type-derive.test.ts ("category/title collisions (#15376)")
 * — this script only applies the known-correct value, guarded by first
 * re-reading the live product_type and refusing to touch anything that does
 * not still read as the exact wrong value recorded below (so re-running this
 * after someone has already hand-corrected a row is a safe no-op, not a
 * clobber).
 *
 * Defaults to DRY RUN: prints current vs. intended product_type for each row,
 * writes nothing. Pass --apply to write for real.
 *
 * Usage:
 *   npx tsx scripts/fix-producttype-misassigned-15376.ts            # dry run
 *   npx tsx scripts/fix-producttype-misassigned-15376.ts --apply    # writes to Shopify
 */
import './_load-env'
import { getShopifyProductType, setShopifyProductType } from '~/lib/shopify.server'

const APPLY = process.argv.includes('--apply')

interface Row {
  nalpacSku: string
  numericProductId: string
  handle: string
  title: string
  expectedCurrent: string
  correctType: string
}

const ROWS: Row[] = [
  {
    nalpacSku: '102077',
    numericProductId: '9096252686507',
    handle: 'moist-silicone-lube-1-oz',
    title: 'Moist Silicone Personal Lubricant 1 oz.',
    expectedCurrent: 'Clitoral Vibrator',
    correctType: 'Lubricant',
  },
  {
    nalpacSku: '101685',
    numericProductId: '9096253243563',
    handle: 'sex-grease-silicone-lubricant-4-oz',
    title: 'Sex Grease Silicone-Based Personal Lubricant 4 oz',
    expectedCurrent: 'Rabbit Vibrator',
    correctType: 'Lubricant',
  },
  {
    // Found during this ticket's investigation — same mechanism (a lube-base
    // category co-occurring with a colliding vibrator/ring shape category),
    // not one of the ticket's three named examples, but produced by the exact
    // same bug the ticket asks to fix.
    nalpacSku: '102293',
    numericProductId: '9085702996139',
    handle: 'savage-sex-sauce-thick-1-69-oz',
    title: 'Sex Sauce Thick Silicone Lubricant 1.69 oz',
    expectedCurrent: 'Cock Ring',
    correctType: 'Lubricant',
  },
  {
    nalpacSku: '102053',
    numericProductId: '9096260747435',
    handle: 'peak-performa-lushe-egg-textured-interchangeable-massager-purple',
    title: 'Lushe Egg & Textured Interchangeable Vibrator Purple',
    expectedCurrent: 'Cock Ring',
    correctType: 'Vibrator',
  },
]

console.log(`[fix-producttype-15376] ${APPLY ? 'APPLY' : 'DRY RUN'} — ${ROWS.length} known row(s)\n`)

let changed = 0
let skipped = 0
for (const row of ROWS) {
  const label = `nalpac-sku ${row.nalpacSku} (${row.handle})`
  let current: string | null
  try {
    current = await getShopifyProductType(row.numericProductId)
  } catch (err) {
    console.error(`SKIP  ${label}: could not read current product_type: ${err instanceof Error ? err.message : err}`)
    skipped++
    continue
  }

  if (current !== row.expectedCurrent) {
    console.log(
      `SKIP  ${label}: current product_type is "${current}", not the recorded wrong value ` +
        `"${row.expectedCurrent}" — already corrected or changed since filing, leaving untouched.`,
    )
    skipped++
    continue
  }

  console.log(`${APPLY ? 'FIX ' : 'WOULD FIX'}  ${label}: "${current}" -> "${row.correctType}"  (${row.title})`)
  if (APPLY) {
    await setShopifyProductType(row.numericProductId, row.correctType)
  }
  changed++
}

console.log(`\n[fix-producttype-15376] ${changed} ${APPLY ? 'fixed' : 'would fix'}, ${skipped} skipped.`)
if (!APPLY && changed > 0) {
  console.log('Re-run with --apply to write these changes to Shopify.')
}
