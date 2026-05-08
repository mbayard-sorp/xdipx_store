/**
 * audit-variant-original-descriptions.ts
 *
 * READ-ONLY. Walks all Shopify products via Admin GraphQL (paginated) and
 * reports per-variant coverage of the metafield `custom.original_description`.
 *
 * Usage:
 *   npx tsx scripts/audit-variant-original-descriptions.ts
 *   npx tsx scripts/audit-variant-original-descriptions.ts > /tmp/variant-coverage.md
 *
 * Markdown report goes to stdout.
 * Progress / diagnostics go to stderr (visible even when stdout is piped).
 *
 * Exit codes:
 *   0 — success
 *   1 — missing env vars or API error
 */

// MUST be first — populates process.env before any module reads it.
import './_load-env'

// ─── Admin GraphQL client (inline — scripts/ is excluded from tsconfig paths) ─

const SHOP  = process.env['SHOPIFY_STORE_DOMAIN'] ?? ''
const TOKEN = process.env['SHOPIFY_ADMIN_ACCESS_TOKEN'] ?? ''

if (!SHOP || !TOKEN) {
  process.stderr.write(
    'ERROR: SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN must be set.\n' +
    'Run scripts/setup-worktree.sh to symlink .env from the main repo.\n',
  )
  process.exit(1)
}

const ADMIN_GQL_ENDPOINT = `https://${SHOP}/admin/api/2024-10/graphql.json`

async function adminGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(ADMIN_GQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) {
    throw new Error(`Shopify Admin GraphQL error: ${res.status} ${res.statusText}`)
  }
  const { data, errors } = await res.json() as { data: T; errors?: { message: string }[] }
  if (errors?.length) {
    throw new Error(errors[0]?.message ?? 'Shopify Admin GraphQL error')
  }
  return data
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface VariantNode {
  id: string
  title: string
  metafield: { value: string } | null
}

interface ProductNode {
  handle: string
  title: string
  variants: {
    edges: Array<{ node: VariantNode }>
  }
}

interface ProductsQueryResult {
  products: {
    pageInfo: {
      hasNextPage: boolean
      endCursor: string | null
    }
    edges: Array<{ node: ProductNode }>
  }
}

interface VariantResult {
  handle: string
  productTitle: string
  variantId: string
  variantTitle: string
  hasDescription: boolean
  charCount: number
}

// ─── Query ────────────────────────────────────────────────────────────────────

// Paginate products; fetch up to 20 variants per product inline.
// The Admin API allows up to 100 products per page.
// 20 variants per product is generous — most products have fewer than 10.
const PRODUCTS_QUERY = /* GraphQL */ `
  query AuditVariantDescriptions($cursor: String) {
    products(first: 100, after: $cursor, sortKey: HANDLE) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          handle
          title
          variants(first: 20) {
            edges {
              node {
                id
                title
                metafield(namespace: "custom", key: "original_description") {
                  value
                }
              }
            }
          }
        }
      }
    }
  }
`

// ─── Pagination ───────────────────────────────────────────────────────────────

async function fetchAllVariants(): Promise<VariantResult[]> {
  const results: VariantResult[] = []
  let cursor: string | null = null
  let pageCount = 0

  do {
    pageCount++
    process.stderr.write(`[audit] Fetching page ${pageCount}${cursor ? ` (after ${cursor.slice(0, 8)}...)` : ''}...\n`)

    const data = await adminGraphQL<ProductsQueryResult>(PRODUCTS_QUERY, cursor ? { cursor } : {})
    const { products } = data

    for (const { node: product } of products.edges) {
      for (const { node: variant } of product.variants.edges) {
        const value = variant.metafield?.value ?? ''
        results.push({
          handle:        product.handle,
          productTitle:  product.title,
          variantId:     variant.id,
          variantTitle:  variant.title,
          hasDescription: typeof value === 'string' && value.trim().length > 0,
          charCount:     value.trim().length,
        })
      }
    }

    cursor = products.pageInfo.hasNextPage ? (products.pageInfo.endCursor ?? null) : null
  } while (cursor !== null)

  process.stderr.write(`[audit] Done — fetched ${pageCount} page(s).\n`)
  return results
}

// ─── Report helpers ───────────────────────────────────────────────────────────

function pct(n: number, total: number): string {
  if (total === 0) return '0%'
  return `${Math.round((n / total) * 100)}%`
}

/** Group variant rows by product handle, preserving insertion order. */
function groupByHandle(rows: VariantResult[]): Map<string, VariantResult[]> {
  const map = new Map<string, VariantResult[]>()
  for (const row of rows) {
    if (!map.has(row.handle)) map.set(row.handle, [])
    map.get(row.handle)!.push(row)
  }
  return map
}

// ─── Markdown output ──────────────────────────────────────────────────────────

function buildReport(rows: VariantResult[]): string {
  const totalVariants  = rows.length
  const withDesc       = rows.filter(r => r.hasDescription).length
  const missingDesc    = totalVariants - withDesc

  const byHandle = groupByHandle(rows)
  const totalProducts = byHandle.size

  const lines: string[] = []

  // ── Header ──
  lines.push(`# Variant \`custom.original_description\` Coverage Audit`)
  lines.push(``)
  lines.push(`Generated: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`)
  lines.push(``)

  // ── Summary table ──
  lines.push(`## Summary`)
  lines.push(``)
  lines.push(`| Metric | Value |`)
  lines.push(`|---|---|`)
  lines.push(`| Total products | ${totalProducts} |`)
  lines.push(`| Total variants | ${totalVariants} |`)
  lines.push(`| Variants with \`original_description\` | ${withDesc} (${pct(withDesc, totalVariants)}) |`)
  lines.push(`| Variants missing \`original_description\` | ${missingDesc} (${pct(missingDesc, totalVariants)}) |`)
  lines.push(``)

  // ── Per-product detail for any product with < 100% coverage ──
  const incompleteProducts: Array<{ handle: string; variants: VariantResult[] }> = []
  const zeroProducts: string[] = []

  for (const [handle, variants] of byHandle) {
    const covered = variants.filter(v => v.hasDescription).length
    if (covered < variants.length) {
      incompleteProducts.push({ handle, variants })
      if (covered === 0) zeroProducts.push(handle)
    }
  }

  if (incompleteProducts.length === 0) {
    lines.push(`## Per-Product Detail`)
    lines.push(``)
    lines.push(`All products have 100% variant coverage. Nothing to report.`)
    lines.push(``)
  } else {
    lines.push(`## Per-Product Detail (products with incomplete coverage)`)
    lines.push(``)
    lines.push(`Only products where at least one variant is missing \`original_description\` are listed.`)
    lines.push(``)

    for (const { handle, variants } of incompleteProducts) {
      const covered = variants.filter(v => v.hasDescription).length
      const productTitle = variants[0]?.productTitle ?? handle
      const coveragePct = pct(covered, variants.length)

      lines.push(`### \`${handle}\``)
      lines.push(``)
      lines.push(`**${productTitle}** — ${covered}/${variants.length} variants covered (${coveragePct})`)
      lines.push(``)
      lines.push(`| Variant Title | Present | Char Count |`)
      lines.push(`|---|---|---|`)

      for (const v of variants) {
        const present = v.hasDescription ? 'Y' : 'N'
        const chars   = v.hasDescription ? String(v.charCount) : '--'
        lines.push(`| ${v.variantTitle} | ${present} | ${chars} |`)
      }

      lines.push(``)
    }
  }

  // ── Zero-coverage list (highest priority backfill) ──
  lines.push(`## Zero-Coverage Products (highest priority for backfill)`)
  lines.push(``)

  if (zeroProducts.length === 0) {
    lines.push(`None. Every product has at least one variant with \`original_description\` set.`)
  } else {
    lines.push(`These ${zeroProducts.length} product(s) have no variants with \`original_description\` set at all:`)
    lines.push(``)
    for (const handle of zeroProducts) {
      lines.push(`- \`${handle}\``)
    }
  }

  lines.push(``)
  lines.push(`---`)
  lines.push(``)
  lines.push(`_Read-only audit. No mutations were made. Run the Nalpac backfill task to populate missing values._`)
  lines.push(``)

  return lines.join('\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  process.stderr.write(`[audit] Starting variant original_description coverage audit...\n`)
  process.stderr.write(`[audit] Store: ${SHOP}\n`)

  const rows = await fetchAllVariants()

  process.stderr.write(`[audit] Building report for ${rows.length} variants across ${groupByHandle(rows).size} products...\n`)

  const report = buildReport(rows)
  process.stdout.write(report)

  // Also print a quick summary to stderr.
  const withDesc = rows.filter(r => r.hasDescription).length
  const total    = rows.length
  process.stderr.write(`[audit] Coverage: ${withDesc}/${total} variants (${pct(withDesc, total)})\n`)

  process.exit(0)
}

main().catch((err) => {
  process.stderr.write(`[audit] Unhandled error: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
