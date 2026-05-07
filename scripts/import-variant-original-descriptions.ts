/**
 * Per-variant Nalpac description import.
 *
 * Reads `descriptions_per_variant_<DATE>.csv` (one row per variant SKU) and
 * writes the `custom.original_description` metafield on the matching Shopify
 * variant. This is the per-variant alternative to the product-level JSON
 * approach in import-descriptions-metafield.ts (per docs spec §6).
 *
 * Prerequisite: Step 1 (scripts/bulk-import-raw.ts) has run. Variants exist
 * in Shopify with the SKUs from the import payload. Run
 * `ensure-variant-original-description-definition.ts --apply` first.
 *
 *   npx tsx scripts/import-variant-original-descriptions.ts <csv-path>          # dry-run
 *   npx tsx scripts/import-variant-original-descriptions.ts <csv-path> --apply
 *   npx tsx scripts/import-variant-original-descriptions.ts <csv-path> --apply --limit 5
 *   npx tsx scripts/import-variant-original-descriptions.ts <csv-path> --apply --start 200
 *
 * Idempotent — re-running overwrites the metafield value (metafieldsSet),
 * never appends. Skips rows where the variant SKU isn't found in Shopify and
 * rows where Original Description is empty.
 */

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'csv-parse/sync'
import { findVariantBySKU, setMetafield } from '~/lib/shopify.server'

const NAMESPACE = 'custom'
const KEY       = 'original_description'
const TYPE      = 'multi_line_text_field'

interface Row {
  SKU:                       string
  'Master SKU':              string
  'Variant Title (Nalpac)':  string
  Color:                     string
  Size:                      string
  'Fluid Oz':                string
  'Original Description':    string
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
    console.error('Usage: npx tsx scripts/import-variant-original-descriptions.ts <csv-path> [--apply] [--limit N] [--start N]')
    process.exit(1)
  }
  return { csvPath: resolve(csvPath), apply, ...(limit !== undefined ? { limit } : {}), start }
}

function fmtPct(n: number, total: number): string {
  return total > 0 ? `${Math.round((n / total) * 100)}%` : '—'
}

async function withRetries<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const maxAttempts = 3
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      const isTransient = /fetch failed|ECONNRESET|ENETUNREACH|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|network/i.test(msg)
      if (!isTransient || attempt === maxAttempts) throw err
      const backoffMs = 1000 * 2 ** (attempt - 1)
      console.warn(`  ↻ ${label} attempt ${attempt}/${maxAttempts} failed (${msg}); retrying in ${backoffMs}ms`)
      await new Promise(r => setTimeout(r, backoffMs))
    }
  }
  throw lastErr
}

async function main(): Promise<void> {
  const args = parseArgs()
  const csvText = readFileSync(args.csvPath, 'utf8')
  const rows = parse(csvText, { columns: true, skip_empty_lines: true, trim: true }) as Row[]

  // Pre-flight summary
  const empty = rows.filter(r => !r['Original Description']?.trim()).length
  const populated = rows.length - empty

  console.log('─── Import variant original descriptions ───')
  console.log(`File:           ${args.csvPath}`)
  console.log(`Mode:           ${args.apply ? 'APPLY (writes metafields to Shopify)' : 'DRY-RUN (no writes)'}`)
  console.log(`Rows:           ${rows.length}`)
  console.log(`  with copy:    ${populated}`)
  console.log(`  empty:        ${empty} (will be skipped)`)

  const slice = rows.slice(args.start, args.limit !== undefined ? args.start + args.limit : undefined)
  console.log(`Will process:   ${slice.length} rows (start=${args.start}${args.limit !== undefined ? `, limit=${args.limit}` : ''})`)
  console.log('────────────────────────────────────────────')

  if (!args.apply) {
    console.log('Dry-run complete. Re-run with --apply to write metafields.')
    return
  }

  let success         = 0
  let variantNotFound = 0
  let emptySkipped    = 0
  let failed          = 0
  const failures: { sku: string; error: string }[] = []
  const startTs = Date.now()

  for (let i = 0; i < slice.length; i++) {
    const r = slice[i]
    if (!r) continue
    const sku = r.SKU
    const idx = args.start + i + 1
    const desc = r['Original Description']?.trim() ?? ''

    if (!desc) {
      emptySkipped++
      process.stdout.write(`[${idx}/${args.start + slice.length}] · ${sku} skipped (empty description)\n`)
      continue
    }

    try {
      const gid = await withRetries(() => findVariantBySKU(sku), `findVariantBySKU ${sku}`)
      if (!gid) {
        variantNotFound++
        process.stdout.write(`[${idx}/${args.start + slice.length}] – ${sku} skipped (variant not found in Shopify)\n`)
        continue
      }
      await withRetries(
        () => setMetafield(gid, NAMESPACE, KEY, TYPE, desc),
        `setMetafield ${sku}`,
      )
      success++
      process.stdout.write(`[${idx}/${args.start + slice.length}] ✓ ${sku}\n`)
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      failures.push({ sku, error: msg })
      process.stdout.write(`[${idx}/${args.start + slice.length}] ✗ ${sku}: ${msg}\n`)
    }

    if (i < slice.length - 1) await new Promise(r => setTimeout(r, 250))
  }

  const elapsedSec = Math.round((Date.now() - startTs) / 1000)
  console.log('────────────────────────────────────────────')
  console.log(`Done in ${elapsedSec}s`)
  console.log(`  success:           ${success} (${fmtPct(success, slice.length)})`)
  console.log(`  variant not found: ${variantNotFound}`)
  console.log(`  empty (skipped):   ${emptySkipped}`)
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
