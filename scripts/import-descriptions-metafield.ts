/**
 * Step 2 of the import pipeline (per docs/descriptions-metafield-spec.md):
 * populate the `custom.original_descriptions` JSON metafield on each master
 * product with the per-variant Nalpac descriptions blob.
 *
 * Prerequisite: Step 1 (scripts/bulk-import-raw.ts) has run. Master products
 * exist in Shopify.
 *
 *   npx tsx scripts/import-descriptions-metafield.ts <csv-path>           # dry-run
 *   npx tsx scripts/import-descriptions-metafield.ts <csv-path> --apply
 *   npx tsx scripts/import-descriptions-metafield.ts <csv-path> --apply --limit 5
 *   npx tsx scripts/import-descriptions-metafield.ts <csv-path> --apply --start 100
 *
 * Idempotent — re-running overwrites the metafield value (metafieldsSet),
 * never appends. Skips rows whose Master SKU isn't found in Shopify.
 */

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'csv-parse/sync'
import { findProductBySKU, setProductMetafield } from '~/lib/shopify.server'

const NAMESPACE = 'custom'
const KEY       = 'original_descriptions'
const TYPE      = 'json'

interface Row {
  'Master SKU':              string
  Brand:                     string
  'Product Title':           string
  'Variant Count':           string
  'Variant Descriptions JSON': string
}

interface Args {
  csvPath: string
  apply:   boolean
  limit?:  number
  start:   number
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let csvPath: string | undefined
  let apply = false
  let limit: number | undefined
  let start = 0
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') apply = true
    else if (a === '--limit') limit = parseInt(argv[++i] ?? '', 10)
    else if (a === '--start') start = parseInt(argv[++i] ?? '', 10) || 0
    else if (a?.startsWith('--limit=')) limit = parseInt(a.slice(8), 10)
    else if (a?.startsWith('--start=')) start = parseInt(a.slice(8), 10) || 0
    else if (a && !a.startsWith('--')) csvPath = a
  }
  if (!csvPath) {
    console.error('Usage: npx tsx scripts/import-descriptions-metafield.ts <csv-path> [--apply] [--limit N] [--start N]')
    process.exit(1)
  }
  return { csvPath: resolve(csvPath), apply, ...(limit !== undefined ? { limit } : {}), start }
}

function fmtPct(n: number, total: number): string {
  return total > 0 ? `${Math.round((n / total) * 100)}%` : '—'
}

async function main(): Promise<void> {
  const args = parseArgs()
  const csvText = readFileSync(args.csvPath, 'utf8')
  const rows = parse(csvText, { columns: true, skip_empty_lines: true, trim: true }) as Row[]

  // Pre-validate: every row's JSON must parse; the Variant Count must agree.
  const validationErrors: { sku: string; message: string }[] = []
  for (const r of rows) {
    if (!r['Master SKU']) {
      validationErrors.push({ sku: '(blank)', message: 'row has empty Master SKU' })
      continue
    }
    if (!r['Variant Descriptions JSON']) {
      validationErrors.push({ sku: r['Master SKU'], message: 'Variant Descriptions JSON is empty' })
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(r['Variant Descriptions JSON'])
    } catch (err) {
      validationErrors.push({ sku: r['Master SKU'], message: `JSON parse failed: ${err instanceof Error ? err.message : err}` })
      continue
    }
    if (!Array.isArray(parsed)) {
      validationErrors.push({ sku: r['Master SKU'], message: 'JSON value is not an array' })
      continue
    }
    const expected = parseInt(r['Variant Count'] ?? '', 10)
    if (!Number.isNaN(expected) && expected !== parsed.length) {
      validationErrors.push({ sku: r['Master SKU'], message: `Variant Count says ${expected} but JSON has ${parsed.length} entries` })
    }
  }

  console.log('─── Import descriptions metafield ───')
  console.log(`File:           ${args.csvPath}`)
  console.log(`Mode:           ${args.apply ? 'APPLY (writes metafields to Shopify)' : 'DRY-RUN (no writes)'}`)
  console.log(`Rows:           ${rows.length}`)
  console.log(`Validation:     ${validationErrors.length === 0 ? 'all rows valid' : `${validationErrors.length} issues`}`)
  if (validationErrors.length > 0) {
    for (const e of validationErrors.slice(0, 10)) console.log(`  ${e.sku}: ${e.message}`)
    if (validationErrors.length > 10) console.log(`  ...and ${validationErrors.length - 10} more`)
  }

  const slice = rows.slice(args.start, args.limit !== undefined ? args.start + args.limit : undefined)
  console.log(`Will process:   ${slice.length} rows (start=${args.start}${args.limit !== undefined ? `, limit=${args.limit}` : ''})`)
  console.log('─────────────────────────────────────')

  if (!args.apply) {
    console.log('Dry-run complete. Re-run with --apply to write metafields.')
    return
  }

  let success         = 0
  let productNotFound = 0
  let invalid         = 0
  let failed          = 0
  const failures: { sku: string; error: string }[] = []
  const startTs = Date.now()

  for (let i = 0; i < slice.length; i++) {
    const r = slice[i]
    if (!r) continue
    const sku = r['Master SKU']
    const idx = args.start + i + 1

    // Skip rows that didn't pass validation
    if (validationErrors.some(e => e.sku === sku)) {
      invalid++
      process.stdout.write(`[${idx}/${args.start + slice.length}] · ${sku} skipped (validation)\n`)
      continue
    }

    try {
      const gid = await findProductBySKU(sku)
      if (!gid) {
        productNotFound++
        process.stdout.write(`[${idx}/${args.start + slice.length}] – ${sku} skipped (product not found in Shopify)\n`)
        continue
      }
      await setProductMetafield(gid, NAMESPACE, KEY, TYPE, r['Variant Descriptions JSON'])
      success++
      process.stdout.write(`[${idx}/${args.start + slice.length}] ✓ ${sku} (${r['Variant Count']} variants)\n`)
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      failures.push({ sku, error: msg })
      process.stdout.write(`[${idx}/${args.start + slice.length}] ✗ ${sku}: ${msg}\n`)
    }

    if (i < slice.length - 1) await new Promise(r => setTimeout(r, 250))
  }

  const elapsedSec = Math.round((Date.now() - startTs) / 1000)
  console.log('─────────────────────────────────────')
  console.log(`Done in ${elapsedSec}s`)
  console.log(`  success:           ${success} (${fmtPct(success, slice.length)})`)
  console.log(`  product not found: ${productNotFound}`)
  console.log(`  invalid (skipped): ${invalid}`)
  console.log(`  failed:            ${failed}`)
  if (failures.length > 0) {
    console.log('Failures:')
    for (const f of failures) console.log(`  ${f.sku}: ${f.error}`)
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
