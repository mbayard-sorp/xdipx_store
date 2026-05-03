/**
 * audit-catalog-coverage.ts
 *
 * Reports per-product tag coverage for the Emma discovery engine.
 * Queries all non-archived Sanity productPage docs and evaluates how well
 * each is populated for filtered search (productTypeDial, audienceTags,
 * mattersTags, moodTags, ivrUseCase, ivrFeatures, ivrExperience, pairingWhy,
 * tagline, seoDescription, sensationDialV2).
 *
 * Usage:
 *   tsx scripts/audit-catalog-coverage.ts > coverage.csv
 *   tsx scripts/audit-catalog-coverage.ts --check-shopify > coverage.csv
 *
 * CSV goes to stdout. Summary block goes to stderr so it's visible even when
 * stdout is piped to a file.
 *
 * Exit codes:
 *   0 — success
 *   1 — Sanity connection failure or SANITY_PROJECT_ID missing
 */

import './_load-env'
import { createClient } from '@sanity/client'

// ─── CLI flags ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const CHECK_SHOPIFY = args.includes('--check-shopify')

// ─── Sanity client ────────────────────────────────────────────────────────────

const projectId = process.env['SANITY_PROJECT_ID']
if (!projectId) {
  process.stderr.write('ERROR: SANITY_PROJECT_ID is not set. Run scripts/setup-worktree.sh first.\n')
  process.exit(1)
}

const sanity = createClient({
  projectId,
  dataset: process.env['SANITY_DATASET'] ?? 'production',
  apiVersion: '2024-10-01',
  useCdn: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  token: process.env['SANITY_API_TOKEN'],
} as any)

// ─── Types ────────────────────────────────────────────────────────────────────

interface SanityProductPage {
  handle: string | null
  title: string | null
  productTypeDial: string | null
  productSubtypeDial: string | null
  audienceTags: string[] | null
  mattersTags: string[] | null
  moodTags: string[] | null
  ivrUseCase: string[] | null
  ivrFeatures: string[] | null
  ivrExperience: string[] | null
  pairingWhy: Record<string, unknown> | null
  tagline: string | null
  seoDescription: string | null
  sensationDialV2: { items?: unknown[] } | null
}

interface CoverageRow {
  handle: string
  title: string
  productTypeDial: string
  productSubtypeDial: string
  audience_tags_count: number
  matters_tags_count: number
  mood_tags_count: number
  ivr_usecase_count: number
  ivr_features_count: number
  ivr_experience_count: number
  has_pairing_why: 'yes' | 'no'
  has_tagline: 'yes' | 'no'
  has_seo_description: 'yes' | 'no'
  has_sensation_dial: 'yes' | 'no'
  coverage_score: number
  gaps: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Escape a CSV field: wrap in quotes if the value contains commas, quotes, or newlines. */
function csvField(value: string | number): string {
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function csvRow(fields: (string | number)[]): string {
  return fields.map(csvField).join(',')
}

/** The set of scored fields and their weights for coverage_score. */
interface FieldSpec {
  name: string
  /** Weight out of 100 total (must all sum to 100). */
  weight: number
  populated: (p: SanityProductPage) => boolean
}

const FIELDS: FieldSpec[] = [
  { name: 'productTypeDial',     weight: 15, populated: p => !!p.productTypeDial },
  { name: 'productSubtypeDial',  weight: 10, populated: p => !!p.productSubtypeDial },
  { name: 'audienceTags',        weight: 12, populated: p => Array.isArray(p.audienceTags) && p.audienceTags.length > 0 },
  { name: 'mattersTags',         weight: 10, populated: p => Array.isArray(p.mattersTags) && p.mattersTags.length > 0 },
  { name: 'moodTags',            weight: 10, populated: p => Array.isArray(p.moodTags) && p.moodTags.length > 0 },
  { name: 'ivrUseCase',          weight:  8, populated: p => Array.isArray(p.ivrUseCase) && p.ivrUseCase.length > 0 },
  { name: 'ivrFeatures',         weight:  8, populated: p => Array.isArray(p.ivrFeatures) && p.ivrFeatures.length > 0 },
  { name: 'ivrExperience',       weight:  8, populated: p => Array.isArray(p.ivrExperience) && p.ivrExperience.length > 0 },
  { name: 'pairingWhy',          weight:  5, populated: p => !!p.pairingWhy && typeof p.pairingWhy === 'object' && Object.keys(p.pairingWhy).length > 0 },
  { name: 'tagline',             weight:  7, populated: p => typeof p.tagline === 'string' && p.tagline.trim().length > 0 },
  { name: 'seoDescription',      weight:  4, populated: p => typeof p.seoDescription === 'string' && p.seoDescription.trim().length > 0 },
  { name: 'sensationDialV2',     weight:  3, populated: p => !!p.sensationDialV2 && Array.isArray(p.sensationDialV2.items) && p.sensationDialV2.items.length > 0 },
]

// Verify weights sum to 100 at module parse time (only matters during dev).
const weightSum = FIELDS.reduce((acc, f) => acc + f.weight, 0)
if (weightSum !== 100) {
  process.stderr.write(`[audit] BUG: FIELDS weights sum to ${weightSum}, expected 100\n`)
}

function buildCoverageRow(p: SanityProductPage): CoverageRow {
  const handle = p.handle ?? '(no-handle)'
  const title = p.title ?? '(no-title)'

  const audienceCount = Array.isArray(p.audienceTags) ? p.audienceTags.length : 0
  const mattersCount = Array.isArray(p.mattersTags) ? p.mattersTags.length : 0
  const moodCount = Array.isArray(p.moodTags) ? p.moodTags.length : 0
  const useCaseCount = Array.isArray(p.ivrUseCase) ? p.ivrUseCase.length : 0
  const featuresCount = Array.isArray(p.ivrFeatures) ? p.ivrFeatures.length : 0
  const experienceCount = Array.isArray(p.ivrExperience) ? p.ivrExperience.length : 0

  const hasPairingWhy = !!p.pairingWhy && typeof p.pairingWhy === 'object' && Object.keys(p.pairingWhy).length > 0
  const hasTagline = typeof p.tagline === 'string' && p.tagline.trim().length > 0
  const hasSeoDescription = typeof p.seoDescription === 'string' && p.seoDescription.trim().length > 0
  const hasSensationDial = !!p.sensationDialV2 && Array.isArray(p.sensationDialV2.items) && p.sensationDialV2.items.length > 0

  // Coverage score: sum of weights for each populated field.
  let score = 0
  const missingFields: string[] = []
  for (const field of FIELDS) {
    if (field.populated(p)) {
      score += field.weight
    } else {
      missingFields.push(field.name)
    }
  }

  return {
    handle,
    title,
    productTypeDial: p.productTypeDial ?? '(missing)',
    productSubtypeDial: p.productSubtypeDial ?? '(missing)',
    audience_tags_count: audienceCount,
    matters_tags_count: mattersCount,
    mood_tags_count: moodCount,
    ivr_usecase_count: useCaseCount,
    ivr_features_count: featuresCount,
    ivr_experience_count: experienceCount,
    has_pairing_why: hasPairingWhy ? 'yes' : 'no',
    has_tagline: hasTagline ? 'yes' : 'no',
    has_seo_description: hasSeoDescription ? 'yes' : 'no',
    has_sensation_dial: hasSensationDial ? 'yes' : 'no',
    coverage_score: score,
    gaps: missingFields.join(';'),
  }
}

// ─── CSV output ───────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  'handle',
  'title',
  'productTypeDial',
  'productSubtypeDial',
  'audience_tags_count',
  'matters_tags_count',
  'mood_tags_count',
  'ivr_usecase_count',
  'ivr_features_count',
  'ivr_experience_count',
  'has_pairing_why',
  'has_tagline',
  'has_seo_description',
  'has_sensation_dial',
  'coverage_score',
  'gaps',
]

function emitCsvRow(row: CoverageRow): void {
  process.stdout.write(
    csvRow([
      row.handle,
      row.title,
      row.productTypeDial,
      row.productSubtypeDial,
      row.audience_tags_count,
      row.matters_tags_count,
      row.mood_tags_count,
      row.ivr_usecase_count,
      row.ivr_features_count,
      row.ivr_experience_count,
      row.has_pairing_why,
      row.has_tagline,
      row.has_seo_description,
      row.has_sensation_dial,
      row.coverage_score,
      row.gaps,
    ]) + '\n',
  )
}

// ─── Summary block (stderr) ───────────────────────────────────────────────────

function printSummary(rows: CoverageRow[]): void {
  const total = rows.length
  if (total === 0) {
    process.stderr.write('\n[audit] No products found.\n')
    return
  }

  const err = (s: string) => process.stderr.write(s + '\n')

  err('')
  err('════════════════════════════════════════════════════════')
  err('  xdipx catalog coverage audit')
  err(`  ${new Date().toISOString().slice(0, 10)}  —  ${total} non-archived products`)
  err('════════════════════════════════════════════════════════')
  err('')

  // Per-field coverage percentages.
  err('── Field coverage ──────────────────────────────────────')
  for (const field of FIELDS) {
    const count = rows.filter(r => {
      // Re-evaluate by checking the gap list (gaps uses field.name exactly).
      return !r.gaps.split(';').includes(field.name)
    }).length
    const pct = Math.round((count / total) * 100)
    const bar = '█'.repeat(Math.round(pct / 5)).padEnd(20, '░')
    err(`  ${field.name.padEnd(20)}  ${bar}  ${String(pct).padStart(3)}%  (${count}/${total})`)
  }
  err('')

  // Per-productTypeDial breakdown.
  err('── Per productTypeDial ─────────────────────────────────')
  const byType = new Map<string, CoverageRow[]>()
  for (const row of rows) {
    const key = row.productTypeDial
    if (!byType.has(key)) byType.set(key, [])
    byType.get(key)!.push(row)
  }
  const sortedTypes = [...byType.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [type, typeRows] of sortedTypes) {
    const withSubtype = typeRows.filter(r => r.productSubtypeDial !== '(missing)').length
    const withAudience = typeRows.filter(r => r.audience_tags_count > 0).length
    const withMatters = typeRows.filter(r => r.matters_tags_count > 0).length
    const withMood = typeRows.filter(r => r.mood_tags_count > 0).length
    const avgScore = Math.round(typeRows.reduce((a, r) => a + r.coverage_score, 0) / typeRows.length)
    err(
      `  ${type.padEnd(22)}  ${String(typeRows.length).padStart(3)} products` +
      `  subtype=${withSubtype}  audience=${withAudience}  matters=${withMatters}` +
      `  mood=${withMood}  avg_score=${avgScore}`,
    )
  }
  err('')

  // 5 worst-covered products (lowest coverage_score, alphabetical tiebreak).
  err('── 5 worst-covered products ────────────────────────────')
  const worst = rows
    .slice()
    .sort((a, b) => a.coverage_score - b.coverage_score || a.handle.localeCompare(b.handle))
    .slice(0, 5)
  for (const r of worst) {
    err(`  [${String(r.coverage_score).padStart(3)}]  ${r.handle}`)
    err(`         gaps: ${r.gaps || '(none)'}`)
  }
  err('')
  err('════════════════════════════════════════════════════════')
  err('')
}

// ─── Shopify cross-check (TODO — optional second pass) ───────────────────────

/**
 * TODO: --check-shopify cross-reference
 *
 * When --check-shopify is passed, a second pass queries the Shopify Admin API
 * for the xdipx-namespace metafields on each product and compares the values
 * against what Sanity has. Drift (e.g. Shopify has productTypeDial but Sanity
 * does not) would be flagged with an extra column `shopify_drift` in the CSV.
 *
 * The Shopify Admin REST endpoint is:
 *   GET /admin/api/2024-10/products/{numericId}/metafields.json?namespace=xdipx
 *
 * This would require mapping Sanity handles back to Shopify numeric IDs, which
 * means a Shopify GraphQL query first (search by handle). With a catalog of
 * hundreds of products that's ~1 req/product at the Admin rate limit (2 req/s
 * for shared). For a 200-product catalog that's ~100 seconds of wall time.
 *
 * Deferred from this PR:
 * - Implement shopifyAdmin() calls against handles in batches (50 handles/query
 *   via the productsByHandles GraphQL query already in shopify.server.ts).
 * - Map returned metafields to the same field names and compare.
 * - Add `shopify_drift` column to CSV output.
 * - Add `--check-shopify` branch in main().
 */
if (CHECK_SHOPIFY) {
  process.stderr.write(
    '[audit] --check-shopify is not yet implemented. ' +
    'See the TODO comment in audit-catalog-coverage.ts for the plan. ' +
    'Running Sanity-only audit.\n\n',
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  process.stderr.write('[audit] Connecting to Sanity...\n')

  let products: SanityProductPage[]
  try {
    products = await sanity.fetch<SanityProductPage[]>(
      `*[_type == "productPage" && archived != true] | order(title asc) {
        "handle": shopifyHandle,
        title,
        productTypeDial,
        productSubtypeDial,
        audienceTags,
        mattersTags,
        moodTags,
        ivrUseCase,
        ivrFeatures,
        ivrExperience,
        pairingWhy,
        tagline,
        seoDescription,
        sensationDialV2
      }`,
    )
  } catch (err) {
    process.stderr.write(
      `[audit] ERROR: Sanity fetch failed — ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  }

  process.stderr.write(`[audit] Fetched ${products.length} products. Writing CSV...\n`)

  // Emit CSV header.
  process.stdout.write(csvRow(CSV_HEADERS) + '\n')

  // Build rows and emit one at a time (stream-friendly, no OOM on large catalogs).
  const allRows: CoverageRow[] = []
  for (const product of products) {
    const row = buildCoverageRow(product)
    allRows.push(row)
    emitCsvRow(row)
  }

  // Summary goes to stderr so it doesn't pollute the CSV when stdout is piped.
  printSummary(allRows)

  process.exit(0)
}

main().catch((err) => {
  process.stderr.write(`[audit] Unhandled error: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
