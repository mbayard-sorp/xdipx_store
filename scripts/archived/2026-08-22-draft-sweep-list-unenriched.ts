// Read-only: enumerate Shopify DRAFT products and their enrichment state, to
// scope the 2026-08-22 Max-transport enrichment sweep the owner requested.
import '../_load-env'
import { eq } from 'drizzle-orm'
import { adminGraphQL } from '../../app/lib/shopify.server'
import { db } from '../../app/lib/db.server'
import { dealHistory } from '../../db/schema'

interface Node {
  id: string
  title: string
  handle: string
  vendor: string
  bodyHtml: string
  tagline: { value: string } | null
  variants: { edges: Array<{ node: { sku: string | null } }> }
}

async function main() {
  const drafts: Node[] = []
  let cursor: string | null = null
  for (;;) {
    const data: {
      products: {
        edges: Array<{ cursor: string; node: Node }>
        pageInfo: { hasNextPage: boolean }
      }
    } = await adminGraphQL(`
      query Drafts($cursor: String) {
        products(first: 100, after: $cursor, query: "status:draft") {
          edges {
            cursor
            node {
              id
              title
              handle
              vendor
              bodyHtml
              tagline: metafield(namespace: "xdipx", key: "tagline") { value }
              variants(first: 1) { edges { node { sku } } }
            }
          }
          pageInfo { hasNextPage }
        }
      }
    `, { cursor })
    for (const e of data.products.edges) drafts.push(e.node)
    if (!data.products.pageInfo.hasNextPage) break
    cursor = data.products.edges[data.products.edges.length - 1]!.cursor
  }

  const rows = []
  for (const p of drafts) {
    const numericId = p.id.split('/').pop()!
    const bodyLen = (p.bodyHtml ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, '').length
    const hist = await db
      .select({ id: dealHistory.id })
      .from(dealHistory)
      .where(eq(dealHistory.shopifyProductId, numericId))
      .limit(1)
    rows.push({
      productId: numericId,
      title: p.title,
      vendor: p.vendor,
      sku: p.variants.edges[0]?.node.sku ?? null,
      bodyLen,
      hasTagline: !!p.tagline?.value,
      hasDealHistory: hist.length > 0,
    })
  }
  const unenriched = rows.filter(r => r.bodyLen === 0 || !r.hasTagline)
  console.log(JSON.stringify({ totalDrafts: rows.length, unenriched: unenriched.length, rows: unenriched }, null, 1))
  process.exit(0)
}
main().catch(err => { console.error(err); process.exit(1) })
