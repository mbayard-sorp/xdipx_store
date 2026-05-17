/**
 * apply-matters-to-shopify.ts
 *
 * Phase 5.5 backfill final step. Reads rule-pass results from
 * matters-proposal-briefs.json and subagent proposals from
 * matters-proposal-proposals.chunk-NN.json files, merges them into a
 * per-product map, and writes shadow metafields to Shopify:
 *
 *   - xdipx.matters_tags_v2      (list.single_line_text_field) — proposed v2 tags
 *   - custom.matters_rationale   (multi_line_text_field)        — rule hits or Claude note
 *
 * Does NOT touch the live xdipx.matters_tags metafield. The shadow pair
 * stays in place for the 48-hour diff review period before going live.
 *
 * Dry-run by default. Pass --apply to write.
 *
 * Usage:
 *   npx tsx scripts/apply-matters-to-shopify.ts                      # dry-run
 *   npx tsx scripts/apply-matters-to-shopify.ts --apply              # write
 *   npx tsx scripts/apply-matters-to-shopify.ts --limit=5            # smoke test
 *   npx tsx scripts/apply-matters-to-shopify.ts --only-handle=foo,bar
 *   npx tsx scripts/apply-matters-to-shopify.ts --input-dir=./out
 *   npx tsx scripts/apply-matters-to-shopify.ts --briefs=./custom-briefs.json
 *   npx tsx scripts/apply-matters-to-shopify.ts --proposals-glob=matters-proposal-proposals.chunk-*.json
 */

import './_load-env'
import fs from 'node:fs'
import path from 'node:path'
import { MATTERS_V2 } from '../app/types/discovery'
import type { MattersProductBrief } from './build-matters-briefs'

const STORE   = process.env['SHOPIFY_STORE_DOMAIN']
const TOKEN   = process.env['SHOPIFY_ADMIN_ACCESS_TOKEN'] ?? process.env['SHOPIFY_ADMIN_TOKEN']
const VERSION = process.env['SHOPIFY_ADMIN_API_VERSION'] ?? '2024-10'

if (!STORE || !TOKEN) {
  console.error('ERROR: SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN must be set in .env')
  process.exit(1)
}

// ── Arg parsing ──────────────────────────────────────────────────────────────

const argOf = (flag: string): string | undefined => {
  const found = process.argv.find(a => a.startsWith(`${flag}=`))
  return found ? found.split('=').slice(1).join('=') : undefined
}

const APPLY     = process.argv.includes('--apply')
const DRY_RUN   = !APPLY
const INPUT_DIR = path.resolve(process.cwd(), argOf('--input-dir') ?? '.')
const LIMIT     = (() => {
  const f = argOf('--limit')
  if (!f) return Infinity
  const n = Number(f)
  return Number.isFinite(n) && n > 0 ? n : Infinity
})()
const ONLY_HANDLES: Set<string> = (() => {
  const v = argOf('--only-handle')
  if (!v) return new Set<string>()
  return new Set(v.split(',').map(h => h.trim()).filter(Boolean))
})()

const BRIEFS_PATH = (() => {
  const b = argOf('--briefs')
  return b ? path.resolve(process.cwd(), b) : path.join(INPUT_DIR, 'matters-proposal-briefs.json')
})()

const PROPOSALS_GLOB = argOf('--proposals-glob') ?? 'matters-proposal-proposals.chunk-*.json'

// ── Constants ─────────────────────────────────────────────────────────────────

const MATTERS_V2_SET = new Set<string>(MATTERS_V2)
const MAX_TAGS = 4
const ENDPOINT = `https://${STORE}/admin/api/${VERSION}/graphql.json`
const CHUNK_SIZE = 25

// ── Shopify GraphQL client ────────────────────────────────────────────────────

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN! },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`)
  const body = await res.json() as { data: T; errors?: Array<{ message: string }> }
  if (body.errors?.length) throw new Error(`GraphQL: ${body.errors.map(e => e.message).join('; ')}`)
  return body.data
}

// ── Metafield definition check ────────────────────────────────────────────────

const CHECK_DEFS_QUERY = /* GraphQL */ `
  query CheckMetafieldDefs {
    v2: metafieldDefinition(namespace: "xdipx", key: "matters_tags_v2", ownerType: PRODUCT) {
      id key namespace type { name }
    }
    rationale: metafieldDefinition(namespace: "custom", key: "matters_rationale", ownerType: PRODUCT) {
      id key namespace type { name }
    }
  }
`

interface MetafieldDefNode {
  id:        string
  key:       string
  namespace: string
  type:      { name: string }
}

async function assertMetafieldDefsExist(): Promise<void> {
  const data = await gql<{ v2: MetafieldDefNode | null; rationale: MetafieldDefNode | null }>(
    CHECK_DEFS_QUERY,
    {},
  )

  const missing: string[] = []
  if (!data.v2)        missing.push('xdipx.matters_tags_v2 (list.single_line_text_field)')
  if (!data.rationale) missing.push('custom.matters_rationale (multi_line_text_field)')

  if (missing.length > 0) {
    process.stderr.write('\nERROR: Required shadow metafield definitions are missing from Shopify Admin.\n')
    process.stderr.write('These must be created before running this script (they were part of step 0a):\n')
    for (const m of missing) {
      process.stderr.write(`  - ${m}\n`)
    }
    process.stderr.write('\nRun scripts/shopify-metafield-defs.ts to create them, then retry.\n\n')
    process.exit(1)
  }
}

// ── GraphQL mutation ──────────────────────────────────────────────────────────

const SET_MUTATION = /* GraphQL */ `
  mutation ApplyMatters($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id key namespace }
      userErrors  { field message }
    }
  }
`

// ── Types ─────────────────────────────────────────────────────────────────────

interface SubagentProposal {
  shopifyProductId: string
  mattersTags:      string[]
  rationale:        string
}

interface MergedProduct {
  shopifyProductId: string
  handle:           string
  mattersTags:      string[]
  rationale:        string
  source:           'rule' | 'claude'
}

interface PendingMetafield {
  ownerId:   string
  namespace: string
  key:       string
  type:      string
  value:     string
  handle:    string
}

// ── File loading helpers ──────────────────────────────────────────────────────

function loadBriefs(): MattersProductBrief[] {
  if (!fs.existsSync(BRIEFS_PATH)) {
    process.stderr.write(`ERROR: ${BRIEFS_PATH} not found. Run build-matters-briefs.ts first.\n`)
    process.exit(1)
  }
  const raw = JSON.parse(fs.readFileSync(BRIEFS_PATH, 'utf8')) as { briefs: MattersProductBrief[] }
  return raw.briefs
}

/**
 * Glob expansion for the proposals pattern. Uses simple prefix/suffix matching
 * rather than a glob library so there are no extra dependencies.
 */
function resolveProposalFiles(): string[] {
  // Split glob on '*' to get prefix + suffix
  const globParts = PROPOSALS_GLOB.split('*')
  if (globParts.length !== 2) {
    process.stderr.write(`ERROR: proposals glob must contain exactly one '*': ${PROPOSALS_GLOB}\n`)
    process.exit(1)
  }
  const [prefix, suffix] = globParts as [string, string]

  let dir: string
  let filePrefix: string
  if (prefix.includes('/') || prefix.includes(path.sep)) {
    const lastSep = Math.max(prefix.lastIndexOf('/'), prefix.lastIndexOf(path.sep))
    dir        = path.resolve(INPUT_DIR, prefix.slice(0, lastSep))
    filePrefix = prefix.slice(lastSep + 1)
  } else {
    dir        = INPUT_DIR
    filePrefix = prefix
  }

  if (!fs.existsSync(dir)) return []

  return fs
    .readdirSync(dir)
    .filter(f => f.startsWith(filePrefix) && f.endsWith(suffix))
    .map(f => path.join(dir, f))
    .sort()
}

function loadProposals(): Map<string, SubagentProposal> {
  const files  = resolveProposalFiles()
  const result = new Map<string, SubagentProposal>()

  if (files.length === 0) {
    process.stderr.write(`No proposal chunk files found matching "${PROPOSALS_GLOB}" in ${INPUT_DIR}\n`)
    process.stderr.write('Applying deterministic-only.\n\n')
    return result
  }

  let total = 0
  for (const f of files) {
    const entries = JSON.parse(fs.readFileSync(f, 'utf8')) as SubagentProposal[]
    if (!Array.isArray(entries)) {
      process.stderr.write(`WARNING: ${path.basename(f)} is not an array — skipped.\n`)
      continue
    }
    for (const e of entries) {
      result.set(e.shopifyProductId, e)
      total += 1
    }
    process.stderr.write(`  Loaded ${entries.length} proposals from ${path.basename(f)}\n`)
  }
  process.stderr.write(`  Total subagent proposals: ${total}\n\n`)
  return result
}

// ── Validation helpers ────────────────────────────────────────────────────────

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)]
}

/**
 * Validates and normalises a proposed tag list.
 * Returns { valid: string[], rejected: string[] }.
 */
function validateTags(tags: string[]): { valid: string[]; rejected: string[] } {
  const deduped   = dedupe(tags)
  const valid:    string[] = []
  const rejected: string[] = []

  for (const t of deduped) {
    if (MATTERS_V2_SET.has(t)) {
      valid.push(t)
    } else {
      rejected.push(t)
    }
  }

  // Cap at MAX_TAGS
  return { valid: valid.slice(0, MAX_TAGS), rejected }
}

// ── Rationale formatters ──────────────────────────────────────────────────────

function ruleRationale(hits: Array<{ id: string; note: string }>): string {
  if (hits.length === 0) return ''
  return 'Rule pass: ' + hits.map(h => `${h.id} (${h.note})`).join(', ')
}

function claudeRationale(subagentText: string): string {
  return `Claude pass: ${subagentText}`
}

// ── Merge logic ───────────────────────────────────────────────────────────────

function mergeProducts(
  briefs:        MattersProductBrief[],
  proposalMap:   Map<string, SubagentProposal>,
): {
  merged:             MergedProduct[]
  rulePassCount:      number
  claudeCount:        number
  outOfVocabErrors:   Array<{ shopifyProductId: string; handle: string; rejected: string[] }>
} {
  const merged:           MergedProduct[]                                               = []
  const outOfVocabErrors: Array<{ shopifyProductId: string; handle: string; rejected: string[] }> = []

  let rulePassCount = 0
  let claudeCount   = 0

  for (const b of briefs) {
    // Handle filter
    if (ONLY_HANDLES.size > 0 && !ONLY_HANDLES.has(b.handle)) continue

    const subagent = proposalMap.get(b.shopifyProductId)

    // Subagent takes precedence when present (richer context)
    if (subagent) {
      const { valid, rejected } = validateTags(subagent.mattersTags)

      if (rejected.length > 0) {
        outOfVocabErrors.push({
          shopifyProductId: b.shopifyProductId,
          handle:           b.handle,
          rejected,
        })
        // Still include valid tags rather than dropping the product entirely
      }

      merged.push({
        shopifyProductId: b.shopifyProductId,
        handle:           b.handle,
        mattersTags:      valid,
        rationale:        claudeRationale(subagent.rationale),
        source:           'claude',
      })
      claudeCount += 1
      continue
    }

    // Rule-pass product (needsClaude === false, or deterministic hits present)
    if (!b.deterministic.needsClaude || b.deterministic.hits.length > 0) {
      const { valid, rejected } = validateTags(b.deterministic.finalMatters)

      if (rejected.length > 0) {
        outOfVocabErrors.push({
          shopifyProductId: b.shopifyProductId,
          handle:           b.handle,
          rejected,
        })
      }

      merged.push({
        shopifyProductId: b.shopifyProductId,
        handle:           b.handle,
        mattersTags:      valid,
        rationale:        ruleRationale(b.deterministic.hits),
        source:           'rule',
      })
      rulePassCount += 1
      continue
    }

    // needsClaude === true and no subagent proposal: skip (no tags to write)
  }

  return { merged, rulePassCount, claudeCount, outOfVocabErrors }
}

// ── Build pending writes ──────────────────────────────────────────────────────

function buildWrites(
  merged:      MergedProduct[],
  applyLimit:  number,
): PendingMetafield[] {
  const writes: PendingMetafield[] = []
  const subset = applyLimit < Infinity ? merged.slice(0, applyLimit) : merged

  for (const p of subset) {
    const ownerId = p.shopifyProductId.startsWith('gid://')
      ? p.shopifyProductId
      : `gid://shopify/Product/${p.shopifyProductId}`

    // Shadow tags
    writes.push({
      ownerId,
      namespace: 'xdipx',
      key:       'matters_tags_v2',
      type:      'list.single_line_text_field',
      value:     JSON.stringify(p.mattersTags),
      handle:    p.handle,
    })

    // Rationale (always write when present)
    if (p.rationale.trim()) {
      writes.push({
        ownerId,
        namespace: 'custom',
        key:       'matters_rationale',
        type:      'multi_line_text_field',
        value:     p.rationale,
        handle:    p.handle,
      })
    }
  }

  return writes
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  process.stderr.write(`apply-matters-to-shopify\n`)
  process.stderr.write(`Mode:      ${DRY_RUN ? 'DRY RUN (no writes)' : 'APPLY'}\n`)
  process.stderr.write(`Store:     ${STORE}\n`)
  process.stderr.write(`Briefs:    ${BRIEFS_PATH}\n`)
  process.stderr.write(`Input dir: ${INPUT_DIR}\n`)
  if (LIMIT !== Infinity) process.stderr.write(`Limit:     ${LIMIT} products\n`)
  if (ONLY_HANDLES.size)  process.stderr.write(`Handles:   ${[...ONLY_HANDLES].join(', ')}\n`)
  process.stderr.write('\n')

  // Verify shadow metafield definitions exist before doing anything else
  if (!DRY_RUN) {
    process.stderr.write('Checking shadow metafield definitions...\n')
    await assertMetafieldDefsExist()
    process.stderr.write('Shadow metafield definitions confirmed.\n\n')
  } else {
    process.stderr.write('(Dry-run: skipping metafield definition check.)\n\n')
  }

  // Load inputs
  process.stderr.write('Loading briefs...\n')
  const briefs = loadBriefs()
  process.stderr.write(`  Loaded ${briefs.length} briefs from ${path.basename(BRIEFS_PATH)}\n\n`)

  process.stderr.write('Loading subagent proposals...\n')
  const proposalMap = loadProposals()

  // Merge
  const { merged, rulePassCount, claudeCount, outOfVocabErrors } =
    mergeProducts(briefs, proposalMap)

  // Build pending writes (respects --limit)
  const writes = buildWrites(merged, LIMIT)

  const tagWrites       = writes.filter(w => w.key === 'matters_tags_v2')
  const rationaleWrites = writes.filter(w => w.key === 'matters_rationale')

  // Print summary of pending writes
  process.stderr.write('\nSample shadow tag writes (first 5):\n')
  for (const w of tagWrites.slice(0, 5)) {
    process.stderr.write(`  ${w.handle.padEnd(50)} -> ${w.value}\n`)
  }
  process.stderr.write('\nSample rationale writes (first 3):\n')
  for (const w of rationaleWrites.slice(0, 3)) {
    process.stderr.write(`  ${w.handle.padEnd(50)} -> "${w.value.slice(0, 80)}..."\n`)
  }
  process.stderr.write('\n')

  if (DRY_RUN) {
    process.stderr.write('DRY RUN -- exiting before writes.\n\n')
    printSummary({
      rulePassCount,
      claudeCount,
      totalToWrite: tagWrites.length,
      outOfVocabErrors,
      isDryRun: true,
      writtenCount: 0,
      errorCount: 0,
      perProductErrors: [],
    })
    return
  }

  // Apply writes in batches of CHUNK_SIZE
  let written = 0
  let errorCount = 0
  const perProductErrors: Array<{ shopifyProductId: string; message: string }> = []
  const t0 = Date.now()
  const totalBatches = Math.ceil(writes.length / CHUNK_SIZE)

  for (let i = 0; i < writes.length; i += CHUNK_SIZE) {
    const batch = writes.slice(i, i + CHUNK_SIZE)

    const result = await gql<{
      metafieldsSet: {
        metafields:  Array<{ id: string }> | null
        userErrors:  Array<{ field: string[]; message: string }>
      }
    }>(SET_MUTATION, {
      metafields: batch.map(w => ({
        ownerId:   w.ownerId,
        namespace: w.namespace,
        key:       w.key,
        type:      w.type,
        value:     w.value,
      })),
    })

    const errs = result.metafieldsSet.userErrors
    if (errs.length > 0) {
      errorCount += errs.length
      for (const e of errs) {
        const msg = `${e.field?.join('.') ?? '?'}: ${e.message}`
        process.stderr.write(`  ERROR in batch: ${msg}\n`)
        perProductErrors.push({ shopifyProductId: batch[0]?.ownerId ?? 'unknown', message: msg })
      }
    }

    const wrote = result.metafieldsSet.metafields?.length ?? 0
    written += wrote

    const batchNum  = Math.floor(i / CHUNK_SIZE) + 1
    const shouldLog = batchNum % 5 === 0 || batchNum === totalBatches
    if (shouldLog) {
      const elapsed = (Date.now() - t0) / 1000
      const rate    = (i + CHUNK_SIZE) / Math.max(elapsed, 0.01)
      const eta     = Math.max(0, (writes.length - i - CHUNK_SIZE) / Math.max(rate, 0.1))
      process.stderr.write(
        `  batch ${batchNum}/${totalBatches}: ${written} written, ${errorCount} errors, eta ${Math.round(eta)}s\n`,
      )
    }
  }

  process.stderr.write('\n')
  printSummary({
    rulePassCount,
    claudeCount,
    totalToWrite: tagWrites.length,
    outOfVocabErrors,
    isDryRun: false,
    writtenCount: written,
    errorCount,
    perProductErrors,
  })
}

// ── Summary printer ───────────────────────────────────────────────────────────

interface SummaryArgs {
  rulePassCount:    number
  claudeCount:      number
  totalToWrite:     number
  outOfVocabErrors: Array<{ shopifyProductId: string; handle: string; rejected: string[] }>
  isDryRun:         boolean
  writtenCount:     number
  errorCount:       number
  perProductErrors: Array<{ shopifyProductId: string; message: string }>
}

function printSummary(s: SummaryArgs): void {
  const line = '────────────────────────────────────────────────────'
  process.stderr.write(`Backfill apply complete\n`)
  process.stderr.write(`${line}\n`)
  process.stderr.write(`  Rule-pass products:        ${s.rulePassCount}\n`)
  process.stderr.write(`  Subagent products:         ${s.claudeCount}\n`)
  process.stderr.write(`  Total products to write:   ${s.totalToWrite}\n`)
  process.stderr.write(`  Out-of-vocab rejections:   ${s.outOfVocabErrors.length}\n`)
  process.stderr.write(`  Dry-run / Applied:         ${s.isDryRun ? 'dry-run' : 'applied'}\n`)
  if (!s.isDryRun) {
    process.stderr.write(`  Metafields written:        ${s.writtenCount}\n`)
    process.stderr.write(`  Shopify errors:            ${s.errorCount}\n`)
  }
  process.stderr.write(`  Shadow metafields written: xdipx.matters_tags_v2, custom.matters_rationale\n`)

  if (s.outOfVocabErrors.length > 0 || s.perProductErrors.length > 0) {
    process.stderr.write(`\nErrors:\n`)
    for (const e of s.outOfVocabErrors) {
      process.stderr.write(
        `  product ${e.shopifyProductId} (${e.handle}): rejected -- out-of-vocab tag(s): ${e.rejected.join(', ')}\n`,
      )
    }
    for (const e of s.perProductErrors) {
      process.stderr.write(`  product ${e.shopifyProductId}: Shopify mutation failed: ${e.message}\n`)
    }
  }
  process.stderr.write('\n')
}

main().catch(err => { console.error(err); process.exit(1) })
