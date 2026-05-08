/**
 * Bulk import without enrichment.
 *
 * Reads a Co-work-formatted product CSV (per docs/product-import-spec.md) and
 * lands each product in Shopify as a draft + dealHistory queue row + Sanity
 * stub doc. Skips the Sonnet orchestrator entirely — tagline, descriptionHtml,
 * dial, mood/audience/matters tags, IVR, and FAQs are deferred to a batched
 * enrichment pass (Anthropic Message Batches, 50% off generation cost).
 *
 *   npx tsx scripts/bulk-import-raw.ts <csv-path>                # dry-run summary, no writes
 *   npx tsx scripts/bulk-import-raw.ts <csv-path> --apply        # actually import
 *   npx tsx scripts/bulk-import-raw.ts <csv-path> --apply --limit 10
 *   npx tsx scripts/bulk-import-raw.ts <csv-path> --apply --start 250
 *
 * After this completes, find unenriched products with the empty-tagline check
 * (or `dealStatus: pending_approval` + missing descriptionHtml) and run them
 * through the batched enrichment pass.
 */

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseBulkImportCSV, importProductGroupRaw } from '~/lib/bulk-import.server'

interface Args {
  csvPath: string
  apply: boolean
  limit?: number
  start: number
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
    console.error('Usage: npx tsx scripts/bulk-import-raw.ts <csv-path> [--apply] [--limit N] [--start N]')
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
  const { groups, parseErrors } = parseBulkImportCSV(csvText)

  // Header sanity — surface columns that the parser expects but may be missing.
  const headerLine = csvText.split(/\r?\n/, 1)[0] ?? ''
  const expected = ['Total qty available', 'Sub-Category', 'Product Title', 'Brand', 'MSRP', 'Wholesale', 'MAP', 'Image 1']
  const missingHeaders = expected.filter(h => !headerLine.includes(h))

  console.log('─── Bulk import (raw, no enrichment) ───')
  console.log(`File:           ${args.csvPath}`)
  console.log(`Mode:           ${args.apply ? 'APPLY (writes to Shopify + Neon + Sanity)' : 'DRY-RUN (no writes)'}`)
  console.log(`Groups:         ${groups.length}`)
  console.log(`  standalone:   ${groups.filter(g => g.isSingleVariant).length}`)
  console.log(`  with variants:${groups.filter(g => !g.isSingleVariant).length}`)
  console.log(`  variant rows: ${groups.reduce((n, g) => n + g.variants.length, 0)}`)
  console.log(`Parse errors:   ${parseErrors.length}`)
  if (parseErrors.length > 0) {
    for (const e of parseErrors.slice(0, 10)) console.log(`  ${e.sku}: ${e.message}`)
    if (parseErrors.length > 10) console.log(`  ...and ${parseErrors.length - 10} more`)
  }
  if (missingHeaders.length > 0) {
    console.log(`Missing headers: ${missingHeaders.join(', ')}`)
    console.log(`  → those columns will be empty and parsed as 0/blank. The daily Nalpac feed processor cron`)
    console.log(`    fills "Total qty available" on schedule, so qty=0 at import time is recoverable.`)
  }

  const slice = groups.slice(args.start, args.limit !== undefined ? args.start + args.limit : undefined)
  console.log(`Will process:   ${slice.length} groups (start=${args.start}${args.limit !== undefined ? `, limit=${args.limit}` : ''})`)
  console.log('────────────────────────────────────────')

  if (!args.apply) {
    console.log('Dry-run complete. Re-run with --apply to actually import.')
    return
  }

  if (parseErrors.length > 0) {
    console.warn(`⚠ Continuing with --apply despite ${parseErrors.length} parse errors — those groups are excluded from the import.`)
  }

  let success = 0
  let skipped = 0
  let failed = 0
  const failures: { sku: string; error: string }[] = []
  const startTs = Date.now()

  for (let i = 0; i < slice.length; i++) {
    const g = slice[i]
    if (!g) continue
    const sku = g.masterRow.SKU
    const idx = args.start + i + 1

    try {
      const result = await importProductGroupRaw(g)
      if (result.success) {
        success++
        process.stdout.write(`[${idx}/${args.start + slice.length}] ✓ ${sku} → ${result.shopifyProductId}${result.warnings ? ` (${result.warnings.length} warnings)` : ''}\n`)
      } else if (result.skipped) {
        skipped++
        process.stdout.write(`[${idx}/${args.start + slice.length}] – ${sku} skipped${result.error ? ` (${result.error})` : ''}\n`)
      } else {
        failed++
        failures.push({ sku, error: result.error ?? 'unknown' })
        process.stdout.write(`[${idx}/${args.start + slice.length}] ✗ ${sku}: ${result.error}\n`)
      }
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      failures.push({ sku, error: msg })
      process.stdout.write(`[${idx}/${args.start + slice.length}] ✗ ${sku} (threw): ${msg}\n`)
    }

    // Polite delay between products to keep Shopify Admin API happy.
    if (i < slice.length - 1) await new Promise(r => setTimeout(r, 250))
  }

  const elapsedSec = Math.round((Date.now() - startTs) / 1000)
  console.log('────────────────────────────────────────')
  console.log(`Done in ${elapsedSec}s (${Math.round(elapsedSec / Math.max(slice.length, 1))}s avg/product)`)
  console.log(`  success: ${success} (${fmtPct(success, slice.length)})`)
  console.log(`  skipped: ${skipped} (${fmtPct(skipped, slice.length)})`)
  console.log(`  failed:  ${failed} (${fmtPct(failed, slice.length)})`)
  if (failures.length > 0) {
    console.log('Failures:')
    for (const f of failures) console.log(`  ${f.sku}: ${f.error}`)
  }
  console.log('Next: run the batched enrichment pass over products with empty tagline metafield.')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
