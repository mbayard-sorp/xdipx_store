/**
 * audit-blog-embed-stock.ts
 *
 * Ticket #2753: a published Notebook post keeps its blogProductEmbed handles
 * forever, but the products behind them decay. Nothing re-checks after publish —
 * the content routine stock-verifies an embed once, before embedding, and
 * inventory-sentinel watches only hero/rail/featured slots. So a post can sit
 * live for weeks pointing readers at an out-of-stock, de-listed, or 404'd
 * product, and the worst case (a post whose ONLY embed is dead) offers no
 * purchasable path at all.
 *
 * This script is the recurring sweep. It reads every published blogPost's embed
 * handles from Sanity, resolves each distinct handle's buyability from Shopify
 * Admin (status + totalInventory) and an optional storefront PDP probe, and
 * prints the posts whose embeds are dead — worst (no buyable path) first. The
 * classification logic lives in app/lib/blog-embed-stock-audit.ts and is
 * unit-tested; this script only supplies live data and prints the report.
 *
 * Signals (per the #2753 sweep — do NOT use Admin publishedAt: it is null across
 * a headless catalog and flags essentially every handle as a false positive):
 *   - GONE:         no Admin product, status ARCHIVED, or storefront PDP 404
 *   - INACTIVE:     Admin status set and not ACTIVE (e.g. DRAFT)
 *   - OUT OF STOCK: totalInventory known and <= 0
 *
 * Usage:
 *   tsx scripts/audit-blog-embed-stock.ts               # human-readable report
 *   tsx scripts/audit-blog-embed-stock.ts --json        # JSON array of reports
 *   tsx scripts/audit-blog-embed-stock.ts --no-storefront # skip the PDP probe
 *
 * Report goes to stdout; the summary line goes to stderr so it survives piping.
 *
 * Exit codes:
 *   0 — ran successfully (whether or not dead embeds were found — advisory audit)
 *   1 — Sanity connection failure or SANITY_PROJECT_ID missing
 */

import './_load-env'
import { createClient } from '@sanity/client'
import { adminGraphQL } from '../app/lib/shopify.server'
import {
  findDeadEmbeds,
  groupByDeadHandle,
  type EmbedAuditPost,
  type ProductBuyability,
} from '../app/lib/blog-embed-stock-audit'

const argv = process.argv.slice(2)
const AS_JSON = argv.includes('--json')
const PROBE_STOREFRONT = !argv.includes('--no-storefront')

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

const SITE_URL = (process.env['SITE_URL'] ?? 'https://xdipx.com').replace(/\/$/, '')

/** Escape a handle for use inside a Shopify Admin search query literal. */
function queryLiteral(handle: string): string {
  return handle.replace(/["\\]/g, '\\$&')
}

/** Resolve one handle's Admin status + totalInventory. */
async function fetchAdminBuyability(handle: string): Promise<{ found: boolean; status: string | null; totalInventory: number | null }> {
  const data = await adminGraphQL<{
    products: { nodes: Array<{ handle: string; status: string; totalInventory: number | null }> }
  }>(
    `query EmbedStock($q: String!) {
      products(first: 1, query: $q) {
        nodes { handle status totalInventory }
      }
    }`,
    { q: `handle:"${queryLiteral(handle)}"` },
  )
  const node = (data.products?.nodes ?? []).find((n) => n.handle?.toLowerCase() === handle.toLowerCase())
  if (!node) return { found: false, status: null, totalInventory: null }
  return { found: true, status: node.status ?? null, totalInventory: node.totalInventory ?? null }
}

/** Probe the live storefront PDP; returns the HTTP status, or null on network error. */
async function probeStorefront(handle: string): Promise<number | null> {
  try {
    const res = await fetch(`${SITE_URL}/products/${encodeURIComponent(handle)}`, {
      method: 'GET',
      redirect: 'manual',
    })
    return res.status
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const rawPosts = await sanity.fetch<EmbedAuditPost[]>(
    `*[_type == "blogPost" && status == "published"]{
      "slug": slug.current,
      "embedHandles": body[_type == "blogProductEmbed"].productHandle
    }`,
  )
  // GROQ returns null (not []) for a post with no matching embeds.
  const posts: EmbedAuditPost[] = rawPosts.map((p) => ({ ...p, embedHandles: p.embedHandles ?? [] }))

  const distinctHandles = [...new Set(posts.flatMap((p) => p.embedHandles.map((h) => h.toLowerCase().trim())).filter(Boolean))]

  const buyability: ProductBuyability[] = []
  for (const handle of distinctHandles) {
    const admin = await fetchAdminBuyability(handle)
    const storefrontStatus = PROBE_STOREFRONT ? await probeStorefront(handle) : null
    buyability.push({ handle, ...admin, storefrontStatus })
  }

  const reports = findDeadEmbeds(posts, buyability)

  const groups = groupByDeadHandle(reports)

  if (AS_JSON) {
    process.stdout.write(JSON.stringify({ reports, groupedByHandle: groups }, null, 2) + '\n')
  } else if (reports.length === 0) {
    process.stdout.write('No dead blog embeds found.\n')
  } else {
    for (const r of reports) {
      const flag = r.hasNoBuyablePath ? '  [NO BUYABLE PATH]' : ''
      process.stdout.write(
        `DEAD EMBEDS  /notebook/${r.slug}${flag}\n` +
          r.deadEmbeds
            .map((d) => `  ${d.reason.padEnd(12)} ${d.handle}`)
            .join('\n') +
          `\n  embeds: ${r.embedHandles.join(', ')}\n\n`,
      )
    }

    const shared = groups.filter((g) => g.slugs.length > 1)
    if (shared.length > 0) {
      process.stdout.write('REMEDIATE BY ROOT CAUSE (one handle, multiple posts — fix once, clear all)\n')
      for (const g of shared) {
        process.stdout.write(
          `  ${g.reason.padEnd(12)} ${g.handle}  ->  ${g.slugs.length} posts: ${g.slugs.join(', ')}\n`,
        )
      }
      process.stdout.write('\n')
    }
  }

  const deadCount = reports.reduce((n, r) => n + r.deadEmbeds.length, 0)
  const noPath = reports.filter((r) => r.hasNoBuyablePath).length
  process.stderr.write(
    `Scanned ${posts.length} published posts (${distinctHandles.length} distinct handles) — ` +
      `${reports.length} post(s) with ${deadCount} dead embed(s), ${noPath} with no buyable path.\n`,
  )
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
