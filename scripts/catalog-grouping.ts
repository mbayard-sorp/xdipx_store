/**
 * Catalog family grouping for Shop app cards (ticket #12683, supersedes
 * #12680 -- owner direction 2026-09-30: "yes, widen it and run the test").
 *
 * Shop renders each Shopify product as a separate card. A split color/
 * flavor/size product family (e.g. a bullet vibrator sold as separate
 * "Strawberry" and "Blueberry" products) shows as competing cards instead of
 * one card with options. Writing `xdipx.catalog_group` (the shared family
 * key) and `xdipx.catalog_option` (the value this product represents, e.g.
 * "Strawberry") onto every member of a family lets a Shop-side grouping
 * rule collapse them into one card.
 *
 * This covers ALL product families, toys included, because Shop approved
 * the whole catalog and agentic channels already drop mature products
 * regardless, so these fields are harmless there.
 *
 * The grouping logic itself (scripts/lib/catalog-grouping.ts) is pure and
 * unit-tested; this file is the thin Shopify I/O wrapper: fetch every active
 * product, group, report, and (only with --apply) write both metafields.
 *
 * PILOT GATE: do not pass --apply in production until the owner confirms
 * the pilot family (screaming-o-4b-bullet-rechargeable-bullet-vibrator,
 * handles screaming-o-4b-bullet-vibrator-strawberry and -blueberry) actually
 * collapses into one card in Shop. Dry run first, always.
 *
 * Usage:
 *   npx tsx scripts/catalog-grouping.ts            # dry run, reports families + collisions
 *   npx tsx scripts/catalog-grouping.ts --apply     # writes catalog_group / catalog_option
 *   npx tsx scripts/catalog-grouping.ts --apply --only=<family-key>   # limit the write to one family
 */
import './_load-env'
import { adminGraphQL } from '~/lib/shopify.server'
import { groupProducts, type GroupableProduct, type CatalogFamily } from './lib/catalog-grouping'

const APPLY = process.argv.includes('--apply')
const ONLY = process.argv.find(a => a.startsWith('--only='))?.slice('--only='.length) ?? null
const METAFIELDS_PER_BATCH = 25

interface ProductNode {
  id: string
  handle: string
  title: string
  vendor: string
}

const PRODUCTS_PAGE = `
  query CatalogGroupingProducts($cursor: String) {
    products(first: 100, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      nodes { id handle title vendor }
    }
  }
`

async function fetchAllActiveProducts(): Promise<ProductNode[]> {
  const out: ProductNode[] = []
  let cursor: string | null = null
  for (;;) {
    const res: {
      products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ProductNode[] }
    } = await adminGraphQL(PRODUCTS_PAGE, { cursor })
    out.push(...res.products.nodes)
    if (!res.products.pageInfo.hasNextPage) break
    cursor = res.products.pageInfo.endCursor
    await new Promise(r => setTimeout(r, 300))
  }
  return out
}

const METAFIELDS_SET = `
  mutation CatalogGroupingMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`

interface MetafieldInput {
  ownerId: string
  namespace: 'xdipx'
  key: 'catalog_group' | 'catalog_option'
  type: 'single_line_text_field'
  value: string
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function writeFamilies(families: readonly CatalogFamily[], idByHandle: Map<string, string>): Promise<{ written: number; failed: number }> {
  const inputs: MetafieldInput[] = []
  for (const family of families) {
    for (const member of family.members) {
      const ownerId = idByHandle.get(member.handle)
      if (!ownerId) continue
      inputs.push({ ownerId, namespace: 'xdipx', key: 'catalog_group', type: 'single_line_text_field', value: family.key })
      inputs.push({ ownerId, namespace: 'xdipx', key: 'catalog_option', type: 'single_line_text_field', value: member.option })
    }
  }

  let written = 0
  let failed = 0
  for (const batch of chunk(inputs, METAFIELDS_PER_BATCH)) {
    try {
      const res = await adminGraphQL<{ metafieldsSet: { userErrors: { field: string[]; message: string }[] } }>(
        METAFIELDS_SET, { metafields: batch },
      )
      if (res.metafieldsSet.userErrors.length > 0) {
        const errs = res.metafieldsSet.userErrors.map(e => `${e.field.join('.')}: ${e.message}`).join('; ')
        console.error(`  batch FAILED: ${errs}`)
        failed += batch.length
      } else {
        written += batch.length
      }
    } catch (err) {
      console.error(`  batch threw: ${err instanceof Error ? err.message : String(err)}`)
      failed += batch.length
    }
    await new Promise(r => setTimeout(r, 300))
  }
  return { written, failed }
}

async function main(): Promise<void> {
  console.log(APPLY ? '=== APPLY (writing xdipx.catalog_group / xdipx.catalog_option) ===' : '=== DRY RUN (no writes; pass --apply to write) ===')
  console.log('')

  const products = await fetchAllActiveProducts()
  console.log(`Fetched ${products.length} active products.`)

  const groupable: GroupableProduct[] = products
    .filter(p => p.vendor && p.vendor.trim().length > 0)
    .map(p => ({ handle: p.handle, vendor: p.vendor, title: p.title }))

  const { families, collisions } = groupProducts(groupable)
  const scoped = ONLY ? families.filter(f => f.key === ONLY) : families

  console.log('')
  console.log(`Families found: ${families.length}${ONLY ? ` (limited to --only=${ONLY}: ${scoped.length})` : ''}`)
  for (const f of scoped) {
    console.log(`  [${f.key}]`)
    for (const m of f.members) console.log(`    ${m.handle}  option="${m.option}"  (${m.title})`)
  }

  console.log('')
  console.log(`Collisions (never grouped, reported for a human to resolve): ${collisions.length}`)
  for (const c of collisions) {
    console.log(`  [${c.key}] reason=${c.reason}`)
    for (const m of c.members) console.log(`    ${m.handle}  (${m.title})`)
  }

  if (!APPLY) {
    console.log('')
    console.log('Dry run: nothing written. Pass --apply to write metafields (pilot family first -- see header).')
    return
  }

  const idByHandle = new Map(products.map(p => [p.handle, p.id]))
  const { written, failed } = await writeFamilies(scoped, idByHandle)
  console.log('')
  console.log(`Metafields written: ${written}, failed: ${failed}`)
}

main().catch(err => {
  console.error('catalog-grouping failed:', err)
  process.exit(1)
})
