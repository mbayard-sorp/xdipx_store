// Bootstrap script: populate Sanity dialRegistry with Emma-proposed labels
// for every ProductTypeDial that lacks coverage. Runs in two phases:
//
//   1. Classify all non-archived products (cheap Haiku call per product) and
//      group SKUs by type. Skips products that already have an
//      xdipx.product_type_dial metafield set.
//   2. For each ProductTypeDial value, generate a sensation dial on up to
//      N representative products. The dial generator emits items with
//      `proposed: true` for novel labels; we then call appendDialLabel to
//      persist those into the dialRegistry singleton in Sanity.
//
// Output: dialRegistry gets populated with 5–6 labels per type, sourced from
// real product context. `dialTaxonomy` (the rich 1/3/5 scale doc) is NOT
// touched — those are editorially curated.
//
// Usage:
//   npx tsx scripts/dial-bootstrap.ts                # dry-run, samples 3 per type
//   npx tsx scripts/dial-bootstrap.ts --apply        # write labels to Sanity
//   npx tsx scripts/dial-bootstrap.ts --per-type=5   # raise sample size
//   npx tsx scripts/dial-bootstrap.ts --skip-classify # use existing metafield only
import './_load-env'
import { db } from '../app/lib/db.server'
import { dealHistory } from '../db/schema'
import { sql } from 'drizzle-orm'
import { shopifyAdmin } from '../app/lib/shopify.server'
import {
  inferProductTaxonomy,
  generateSensationDialV2,
} from '../app/lib/claude.server'
import { appendDialLabel } from '../app/lib/dial-registry.server'
import { PRODUCT_TYPE_DIALS, type ProductTypeDial } from '../app/types'

interface Args {
  apply:        boolean
  perType:      number
  skipClassify: boolean
}

function parseArgs(argv: string[]): Args {
  const get = (prefix: string) => {
    const arg = argv.find(a => a.startsWith(`${prefix}=`))
    return arg ? arg.slice(prefix.length + 1) : undefined
  }
  return {
    apply:        argv.includes('--apply'),
    perType:      Number(get('--per-type') ?? '3'),
    skipClassify: argv.includes('--skip-classify'),
  }
}

interface ProductMeta {
  sku:           string
  numericId:     string
  title:         string
  description:   string
  brand:         string
  productType:   string  // Shopify's editorial product_type field
  existingDial:  ProductTypeDial | undefined
}

async function fetchProductMeta(numericId: string, sku: string): Promise<ProductMeta | null> {
  try {
    const res = await shopifyAdmin<{
      product: {
        id: number; title: string; vendor: string; body_html: string;
        product_type: string; status: string;
      } | null
    }>(`/products/${numericId}.json`)
    if (!res.product) return null
    if (res.product.status === 'archived') return null

    const mf = await shopifyAdmin<{ metafields: Array<{ key: string; value: string }> }>(
      `/products/${numericId}/metafields.json?namespace=xdipx&limit=10`,
    )
    const dial = mf.metafields.find(m => m.key === 'product_type_dial')?.value
    const validDial = dial && (PRODUCT_TYPE_DIALS as readonly string[]).includes(dial)
      ? (dial as ProductTypeDial)
      : undefined

    const description = res.product.body_html.replace(/<[^>]+>/g, ' ').slice(0, 600).trim()
    return {
      sku,
      numericId,
      title:        res.product.title,
      description,
      brand:        res.product.vendor,
      productType:  res.product.product_type ?? '',
      existingDial: validDial,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('429')) {
      // Soft retry once after pause for rate limit
      await new Promise(r => setTimeout(r, 1500))
      try { return await fetchProductMeta(numericId, sku) } catch { /* fall through */ }
    }
    console.warn(`  fetch ${sku}: ${msg.slice(0, 80)}`)
    return null
  }
}

async function classify(meta: ProductMeta): Promise<ProductTypeDial | null> {
  if (meta.existingDial) return meta.existingDial
  try {
    const t = await inferProductTaxonomy({
      title:       meta.title,
      brand:       meta.brand,
      description: meta.description,
      categories:  meta.productType ? [meta.productType] : [],
    })
    return t.type
  } catch (err) {
    console.warn(`  classify ${meta.sku}: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  console.log(`dial-bootstrap: apply=${args.apply} perType=${args.perType} skipClassify=${args.skipClassify}`)

  // Load all non-archived rows.
  const rows = await db
    .select({ sku: dealHistory.sku, shopifyProductId: dealHistory.shopifyProductId })
    .from(dealHistory)
    .where(sql`${dealHistory.status} != 'archived' AND ${dealHistory.sku} NOT LIKE 'XDX-TEST-%'`)
    .orderBy(dealHistory.sku)

  console.log(`[load] ${rows.length} candidate products (XDX-TEST-* excluded)`)

  // Phase 1 — fetch metadata + classify.
  const byType = new Map<ProductTypeDial, ProductMeta[]>()
  for (const t of PRODUCT_TYPE_DIALS) byType.set(t, [])

  let i = 0
  let classified = 0
  let skipped    = 0
  for (const row of rows) {
    i++
    const numericId = row.shopifyProductId.split('/').pop()
    if (!numericId) continue
    const meta = await fetchProductMeta(numericId, row.sku)
    if (!meta) { skipped++; continue }

    let type: ProductTypeDial | null
    if (args.skipClassify) {
      type = meta.existingDial ?? null
    } else {
      type = await classify(meta)
    }
    if (!type) { skipped++; continue }

    byType.get(type)!.push(meta)
    classified++
    if (i % 25 === 0) process.stdout.write(`  ...${i}/${rows.length} classified=${classified} skipped=${skipped}\r`)

    // Soft throttle to stay under Shopify Admin REST limits (~2 req/s burst).
    await new Promise(r => setTimeout(r, 80))
  }
  console.log()
  console.log(`[classify] done — ${classified} classified, ${skipped} skipped`)

  console.log('— distribution —')
  const sortedTypes = [...byType.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [t, list] of sortedTypes) {
    if (list.length === 0) continue
    console.log(`  ${t.padEnd(14)} ${list.length.toString().padStart(4)}`)
  }
  for (const [t, list] of sortedTypes) {
    if (list.length === 0) console.log(`  ${t.padEnd(14)}    0  ← no products of this type in catalog`)
  }

  // Phase 2 — for each type with at least one product, run dial generator on
  // up to N representatives. Append proposed labels to Sanity (dry-run skips
  // the write but still generates so we see what would be appended).
  console.log()
  console.log(`[dial-gen] sampling up to ${args.perType} per type`)

  const summary: Array<{ type: ProductTypeDial; sampled: number; appended: number; labels: string[] }> = []

  for (const [type, list] of byType) {
    if (list.length === 0) continue
    const sample = list.slice(0, args.perType)
    let appendedThisType = 0
    const labelsThisType: string[] = []

    for (const meta of sample) {
      try {
        const dial = await generateSensationDialV2({
          deal: {
            seoTitle:        meta.title,
            brand:           meta.brand,
            category:        meta.productType ? [meta.productType] : [],
            productTypeDial: type,
            fullStory:       meta.description,
          },
          // Empty preferred / taxonomy → "invent" mode for new types.
          preferredLabels: [],
          taxonomy:        [],
        })
        const proposed = dial.items.filter(it => it.proposed && typeof it.label === 'string')
        for (const item of proposed) {
          if (!args.apply) {
            console.log(`  [DRY] would append ${type} ← "${item.label}"`)
            labelsThisType.push(item.label)
            appendedThisType++
            continue
          }
          try {
            const next = await appendDialLabel(type, item.label)
            const isNew = next[next.length - 1] === item.label
            if (isNew) {
              labelsThisType.push(item.label)
              appendedThisType++
              console.log(`  ✓ ${type} ← "${item.label}"`)
            }
          } catch (err) {
            console.warn(`  ✗ append ${type} "${item.label}": ${err instanceof Error ? err.message : err}`)
          }
        }
      } catch (err) {
        console.warn(`  dial-gen ${meta.sku} (${type}): ${err instanceof Error ? err.message : err}`)
      }
    }

    summary.push({ type, sampled: sample.length, appended: appendedThisType, labels: labelsThisType })
  }

  console.log()
  console.log('— bootstrap summary —')
  for (const row of summary) {
    const lbls = row.labels.length > 0 ? ` · ${row.labels.join(', ')}` : ''
    console.log(`  ${row.type.padEnd(14)} sampled=${row.sampled} appended=${row.appended}${lbls}`)
  }

  if (!args.apply) {
    console.log()
    console.log('[dry-run] no Sanity writes performed. Re-run with --apply to persist labels.')
  }

  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
