/**
 * One-shot cleanup: remove the retired daily-deal bookkeeping from Shopify.
 *
 * Deletes these product metafields catalog-wide:
 *   xdipx.deal_status
 *   xdipx.deal_date
 *   xdipx.is_daily_deal
 *
 * …and strips the `deal-status-*` tags that mirrored deal_status for Storefront
 * queries. Nothing in the codebase reads any of them after the daily-deal
 * retirement; `deal_status: 'archived'` was 410-ing active, sellable PDPs.
 *
 * The metafield DEFINITIONS are left in place — this clears values only, so the
 * change is reversible. Deleting definitions is a separate, irreversible step.
 *
 * The `deal_history` Postgres table is NOT touched: it is the product catalog
 * table now (`deal_date` is NOT NULL and every imported product has a row).
 *
 * Usage:
 *   npx tsx scripts/clear-daily-deal-metafields.ts            # dry run
 *   npx tsx scripts/clear-daily-deal-metafields.ts --apply    # write
 */
import './_load-env'
import { adminGraphQL } from '~/lib/shopify.server'

const APPLY = process.argv.includes('--apply')
const KEYS = ['deal_status', 'deal_date', 'is_daily_deal'] as const

interface Node {
  id: string
  handle: string
  title: string
  status: string
  tags: string[]
  deal_status:   { value: string } | null
  deal_date:     { value: string } | null
  is_daily_deal: { value: string } | null
}

// Aliased single `metafield()` lookups rather than the `metafields(keys:)`
// connection — the connection rejects `keys` alongside `namespace`, and with a
// bare `keys` argument it returned nothing for this shop.
const SCAN = `
  query ScanDealMetafields($cursor: String) {
    products(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id handle title status tags
        deal_status:   metafield(namespace: "xdipx", key: "deal_status")   { value }
        deal_date:     metafield(namespace: "xdipx", key: "deal_date")     { value }
        is_daily_deal: metafield(namespace: "xdipx", key: "is_daily_deal") { value }
      }
    }
  }
`

const DELETE = `
  mutation DeleteMetafields($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields { key }
      userErrors { field message }
    }
  }
`

const SET_TAGS = `
  mutation SetTags($id: ID!, $tags: [String!]!) {
    productUpdate(input: { id: $id, tags: $tags }) {
      product { id }
      userErrors { field message }
    }
  }
`

/** Shopify Admin GraphQL is throttled on a leaky bucket; pace the writes. */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main(): Promise<void> {
  console.log(APPLY ? '=== APPLY (writing to Shopify) ===' : '=== DRY RUN (no writes) ===\n')

  let cursor: string | null = null
  let scanned = 0
  let mfDeleted = 0
  let taggedProducts = 0
  const byKey = new Map<string, number>()
  const errors: string[] = []

  for (;;) {
    const res: {
      products: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: Node[] }
    } = await adminGraphQL(SCAN, { cursor })

    for (const p of res.products.nodes) {
      scanned++
      const mfs = KEYS
        .map(k => ({ key: k, value: p[k]?.value }))
        .filter((m): m is { key: typeof KEYS[number]; value: string } => m.value != null)
      const staleTags = p.tags.filter(t => t.startsWith('deal-status-'))
      if (mfs.length === 0 && staleTags.length === 0) continue

      for (const m of mfs) byKey.set(m.key, (byKey.get(m.key) ?? 0) + 1)

      if (!APPLY) {
        const parts = [
          ...mfs.map(m => `${m.key}=${m.value}`),
          ...staleTags.map(t => `tag:${t}`),
        ]
        console.log(`  ${p.handle} [${p.status}] — ${parts.join(', ')}`)
        mfDeleted += mfs.length
        if (staleTags.length) taggedProducts++
        continue
      }

      if (mfs.length > 0) {
        const del: { metafieldsDelete: { userErrors: { message: string }[] } } =
          await adminGraphQL(DELETE, {
            metafields: mfs.map(m => ({ ownerId: p.id, namespace: 'xdipx', key: m.key })),
          })
        const errs = del.metafieldsDelete.userErrors
        if (errs.length > 0) errors.push(`${p.handle} metafields: ${errs.map(e => e.message).join('; ')}`)
        else mfDeleted += mfs.length
        await sleep(120)
      }

      if (staleTags.length > 0) {
        const keep = p.tags.filter(t => !t.startsWith('deal-status-'))
        const upd: { productUpdate: { userErrors: { message: string }[] } } =
          await adminGraphQL(SET_TAGS, { id: p.id, tags: keep })
        const errs = upd.productUpdate.userErrors
        if (errs.length > 0) errors.push(`${p.handle} tags: ${errs.map(e => e.message).join('; ')}`)
        else taggedProducts++
        await sleep(120)
      }
    }

    process.stderr.write(`… scanned ${scanned}\n`)
    if (!res.products.pageInfo.hasNextPage) break
    cursor = res.products.pageInfo.endCursor
  }

  console.log(`\nscanned products:      ${scanned}`)
  console.log(`metafields ${APPLY ? 'deleted' : 'to delete'}: ${mfDeleted}`)
  for (const [k, n] of [...byKey].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`)
  console.log(`products ${APPLY ? 'retagged' : 'to retag'}:  ${taggedProducts}`)

  if (errors.length > 0) {
    console.log(`\n${errors.length} error(s):`)
    for (const e of errors) console.log(`  ${e}`)
  }
  if (!APPLY) console.log('\nRe-run with --apply to write.')
}

await main()
process.exit(0)
