/**
 * promote-matters-shadow-to-live.ts
 *
 * Copies xdipx.matters_tags_v2 (shadow) → xdipx.matters_tags (live) on every
 * Shopify product. This is the data-side half of the v2 "What Matters" flip;
 * the code-side half is the unconditional v2 vocab in feature-flags.server.ts,
 * ask-emma-vocab.server.ts, and sms-v2/discovery-gate.server.ts.
 *
 * Behavior:
 *   - Reads matters_tags_v2 + matters_tags for every product (paginated)
 *   - Writes v2 value verbatim to live (including empty arrays — the 738
 *     products with no v2 chips should not surface for matters filtering)
 *   - Skips products where live already matches v2 (no-op)
 *   - Skips products with no v2 metafield at all (never backfilled — e.g.,
 *     deleted-then-restored products outside the backfill window)
 *
 * Dry-run by default. Pass --apply to write.
 *
 * Usage:
 *   npx tsx scripts/promote-matters-shadow-to-live.ts                # dry-run
 *   npx tsx scripts/promote-matters-shadow-to-live.ts --apply        # write
 *   npx tsx scripts/promote-matters-shadow-to-live.ts --limit=10     # smoke
 *   npx tsx scripts/promote-matters-shadow-to-live.ts --only-handle=foo,bar
 */

import './_load-env'

const STORE   = process.env['SHOPIFY_STORE_DOMAIN']
const TOKEN   = process.env['SHOPIFY_ADMIN_ACCESS_TOKEN'] ?? process.env['SHOPIFY_ADMIN_TOKEN']
const VERSION = process.env['SHOPIFY_ADMIN_API_VERSION'] ?? '2024-10'

if (!STORE || !TOKEN) {
  console.error('ERROR: SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN must be set in .env')
  process.exit(1)
}

const ENDPOINT   = `https://${STORE}/admin/api/${VERSION}/graphql.json`
const CHUNK_SIZE = 25
const PAGE_SLEEP_MS = 500

// ── Arg parsing ──────────────────────────────────────────────────────────────

const argOf = (flag: string): string | undefined => {
  const found = process.argv.find(a => a.startsWith(`${flag}=`))
  return found ? found.split('=').slice(1).join('=') : undefined
}

const APPLY   = process.argv.includes('--apply')
const DRY_RUN = !APPLY
const LIMIT   = (() => {
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

// ── GraphQL client ────────────────────────────────────────────────────────────

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

// ── Read query ────────────────────────────────────────────────────────────────

const READ_QUERY = /* GraphQL */ `
  query Products($cursor: String) {
    products(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        v2Raw:   metafield(namespace: "xdipx", key: "matters_tags_v2") { value }
        liveRaw: metafield(namespace: "xdipx", key: "matters_tags")    { value }
      }
    }
  }
`

interface ProductNode {
  id:      string
  handle:  string
  v2Raw:   { value: string } | null
  liveRaw: { value: string } | null
}

// ── Write mutation ────────────────────────────────────────────────────────────

const SET_MUTATION = /* GraphQL */ `
  mutation PromoteMatters($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id key namespace }
      userErrors  { field message }
    }
  }
`

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseListValue(raw: string | null | undefined): string[] | null {
  if (raw === null || raw === undefined) return null
  try {
    const v = JSON.parse(raw)
    if (!Array.isArray(v)) return null
    return v.map(String)
  } catch {
    return null
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface PendingWrite {
  ownerId: string
  handle:  string
  v2:      string[]
  live:    string[]
}

async function main() {
  process.stderr.write(`promote-matters-shadow-to-live\n`)
  process.stderr.write(`Mode:   ${DRY_RUN ? 'DRY RUN (no writes)' : 'APPLY'}\n`)
  process.stderr.write(`Store:  ${STORE}\n`)
  if (LIMIT !== Infinity) process.stderr.write(`Limit:  ${LIMIT} products\n`)
  if (ONLY_HANDLES.size)  process.stderr.write(`Handles: ${[...ONLY_HANDLES].join(', ')}\n`)
  process.stderr.write('\n')

  // ── Phase 1: scan ─────────────────────────────────────────────────────────
  const pending:    PendingWrite[] = []
  let cursor:       string | null = null
  let pageNum       = 0
  let scanned       = 0
  let noV2          = 0
  let alreadyMatch  = 0

  process.stderr.write('Scanning products...\n')

  do {
    const data = await gql<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes:    ProductNode[]
      }
    }>(READ_QUERY, { cursor })

    pageNum += 1

    for (const node of data.products.nodes) {
      scanned += 1
      if (ONLY_HANDLES.size > 0 && !ONLY_HANDLES.has(node.handle)) continue

      const v2   = parseListValue(node.v2Raw?.value)
      const live = parseListValue(node.liveRaw?.value) ?? []

      if (v2 === null) {
        noV2 += 1
        continue
      }

      if (arraysEqual(v2, live)) {
        alreadyMatch += 1
        continue
      }

      pending.push({ ownerId: node.id, handle: node.handle, v2, live })
      if (pending.length >= LIMIT) break
    }

    if (pending.length >= LIMIT) break

    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null
    if (cursor) await sleep(PAGE_SLEEP_MS)

    if (pageNum % 5 === 0) {
      process.stderr.write(`  scanned ${scanned} products, ${pending.length} pending writes\n`)
    }
  } while (cursor)

  process.stderr.write(`\nScan complete:\n`)
  process.stderr.write(`  Scanned:               ${scanned}\n`)
  process.stderr.write(`  No v2 metafield:       ${noV2} (skipped)\n`)
  process.stderr.write(`  Already in sync:       ${alreadyMatch} (skipped)\n`)
  process.stderr.write(`  Pending writes:        ${pending.length}\n`)
  process.stderr.write('\n')

  // ── Sample diff ───────────────────────────────────────────────────────────
  process.stderr.write('Sample diffs (first 10):\n')
  for (const p of pending.slice(0, 10)) {
    const liveStr = p.live.length ? p.live.join(', ') : '(empty)'
    const v2Str   = p.v2.length   ? p.v2.join(', ')   : '(empty)'
    process.stderr.write(`  ${p.handle.padEnd(50)}\n`)
    process.stderr.write(`    live: ${liveStr}\n`)
    process.stderr.write(`    v2:   ${v2Str}\n`)
  }
  process.stderr.write('\n')

  if (DRY_RUN) {
    process.stderr.write('DRY RUN — exiting before writes. Re-run with --apply to promote.\n\n')
    return
  }

  // ── Phase 2: write ────────────────────────────────────────────────────────
  process.stderr.write(`Applying ${pending.length} writes in batches of ${CHUNK_SIZE}...\n`)

  let written       = 0
  let errorCount    = 0
  const perBatchErrors: Array<{ handle: string; message: string }> = []
  const t0          = Date.now()
  const totalBatches = Math.ceil(pending.length / CHUNK_SIZE)

  for (let i = 0; i < pending.length; i += CHUNK_SIZE) {
    const batch = pending.slice(i, i + CHUNK_SIZE)

    const result = await gql<{
      metafieldsSet: {
        metafields: Array<{ id: string }> | null
        userErrors: Array<{ field: string[]; message: string }>
      }
    }>(SET_MUTATION, {
      metafields: batch.map(p => ({
        ownerId:   p.ownerId,
        namespace: 'xdipx',
        key:       'matters_tags',
        type:      'list.single_line_text_field',
        value:     JSON.stringify(p.v2),
      })),
    })

    const errs = result.metafieldsSet.userErrors
    if (errs.length > 0) {
      errorCount += errs.length
      for (const e of errs) {
        const msg = `${e.field?.join('.') ?? '?'}: ${e.message}`
        perBatchErrors.push({ handle: batch[0]?.handle ?? 'unknown', message: msg })
        process.stderr.write(`  ERROR in batch ${Math.floor(i / CHUNK_SIZE) + 1}: ${msg}\n`)
      }
    }

    written += result.metafieldsSet.metafields?.length ?? 0

    const batchNum  = Math.floor(i / CHUNK_SIZE) + 1
    const shouldLog = batchNum % 5 === 0 || batchNum === totalBatches
    if (shouldLog) {
      const elapsed = (Date.now() - t0) / 1000
      const rate    = (i + CHUNK_SIZE) / Math.max(elapsed, 0.01)
      const eta     = Math.max(0, (pending.length - i - CHUNK_SIZE) / Math.max(rate, 0.1))
      process.stderr.write(
        `  batch ${batchNum}/${totalBatches}: ${written} written, ${errorCount} errors, eta ${Math.round(eta)}s\n`,
      )
    }
  }

  process.stderr.write('\n')
  process.stderr.write('Promote complete\n')
  process.stderr.write('────────────────────────────────────────────────────\n')
  process.stderr.write(`  Pending writes:   ${pending.length}\n`)
  process.stderr.write(`  Metafields written: ${written}\n`)
  process.stderr.write(`  Errors:           ${errorCount}\n`)
  if (perBatchErrors.length) {
    process.stderr.write('\nErrors:\n')
    for (const e of perBatchErrors) {
      process.stderr.write(`  ${e.handle}: ${e.message}\n`)
    }
  }
  process.stderr.write('\n')
}

main().catch(err => { console.error(err); process.exit(1) })
