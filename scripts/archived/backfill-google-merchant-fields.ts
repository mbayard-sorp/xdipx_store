/**
 * Backfills Google Merchant Center fields on every active Shopify product so
 * GMC can ingest and approve the catalog under the adult-content policy.
 *
 * What it sets (idempotent -- only writes missing values unless --force):
 *
 *   Per product (mm-google-shopping namespace):
 *     - google_product_category   -- derived from xdipx.product_type_dial
 *     - age_group                 -- "adult"
 *     - condition                 -- "new"
 *     - gender                    -- derived from xdipx.audience_tags
 *     - mpn                       -- the Nalpac SKU (GTIN fallback)
 *     - custom_product            -- "TRUE" when no UPC is available
 *     - color                     -- parsed from xdipx.specifications JSON
 *     - material                  -- parsed from xdipx.specifications JSON
 *     - size                      -- parsed from xdipx.specifications JSON (omitted when absent)
 *     - custom_label_0            -- xdipx.product_type_dial value
 *     - custom_label_1            -- audience bucket: for-him | for-her | couples | unisex
 *     - custom_label_2            -- deal score tier: high | mid | low
 *     - custom_label_3            -- "deal" if is_daily_deal, else "vault"
 *     - custom_label_4            -- price bucket: under-30 | 30-to-60 | 60-plus
 *
 *   Per variant:
 *     - barcode                   -- Nalpac UPC/barcode, sourced from the main
 *                                    product-attributes feed by SKU. Shopify's
 *                                    Google channel forwards `barcode` as the
 *                                    `gtin` attribute in the Merchant feed.
 *
 * Skips:
 *   - mm-google-shopping.adult    -- already handled by set-google-adult-flag.ts
 *   - any field that already has a value (unless --force)
 *
 * Usage:
 *   npx tsx scripts/backfill-google-merchant-fields.ts                # dry run
 *   npx tsx scripts/backfill-google-merchant-fields.ts --apply        # write
 *   npx tsx scripts/backfill-google-merchant-fields.ts --apply --force  # overwrite existing values
 *   npx tsx scripts/backfill-google-merchant-fields.ts --only-barcodes  # only push UPCs to variant.barcode
 *   npx tsx scripts/backfill-google-merchant-fields.ts --only-metafields  # skip variant barcode writes
 *   npx tsx scripts/backfill-google-merchant-fields.ts --limit=5      # process first N products
 *
 * Environment (reads from .env):
 *   SHOPIFY_STORE_DOMAIN        -- e.g. xdipx.myshopify.com
 *   SHOPIFY_ADMIN_ACCESS_TOKEN  -- Admin API token (shpat_...)
 *   SHOPIFY_ADMIN_API_VERSION   -- optional, default 2024-10
 */
import 'dotenv/config'
import { parse } from 'csv-parse/sync'

const STORE   = process.env['SHOPIFY_STORE_DOMAIN']
const TOKEN   = process.env['SHOPIFY_ADMIN_ACCESS_TOKEN'] ?? process.env['SHOPIFY_ADMIN_TOKEN']
const VERSION = process.env['SHOPIFY_ADMIN_API_VERSION'] ?? '2024-10'

const APPLY           = process.argv.includes('--apply')
const FORCE           = process.argv.includes('--force')
const ONLY_BARCODES   = process.argv.includes('--only-barcodes')
const ONLY_METAFIELDS = process.argv.includes('--only-metafields')
const LIMIT = (() => {
  const idx = process.argv.findIndex(a => a === '--limit' || a.startsWith('--limit='))
  if (idx < 0) return Infinity
  const raw = process.argv[idx]!.startsWith('--limit=')
    ? process.argv[idx]!.slice('--limit='.length)
    : process.argv[idx + 1]
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`ERROR: --limit requires a positive integer, got "${raw}"`)
    process.exit(1)
  }
  return n
})()

if (!STORE || !TOKEN) {
  console.error('ERROR: SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN must be set in .env')
  process.exit(1)
}
if (ONLY_BARCODES && ONLY_METAFIELDS) {
  console.error('ERROR: --only-barcodes and --only-metafields are mutually exclusive')
  process.exit(1)
}

const ENDPOINT = `https://${STORE}/admin/api/${VERSION}/graphql.json`
const NALPAC_MAIN_FEED = process.env['NALPAC_FEED_MAIN_URL']
  ?? 'https://productfeeds.wyomind.com/feeds/1s6o37vbh23/nal-product-attributes-main.csv'

// --- Google Product Category mapping ----------------------------------------
//
// Numeric IDs from the official Google product taxonomy. Using IDs (not the
// "Mature > Erotic > Adult Toys" string) keeps the value stable across
// taxonomy revisions and removes the chance of typos.
//
//   5391 = Mature > Erotic > Adult Toys
//   776  = Health & Beauty > Personal Care > Sexual Wellness
//
// Anything not in this map falls back to ADULT_TOYS so the product still
// validates instead of erroring out of the feed.
const ADULT_TOYS      = '5391'
const SEXUAL_WELLNESS = '776'
const GMC_CATEGORY_BY_DIAL: Record<string, string> = {
  vibrator:    ADULT_TOYS,
  dildo:       ADULT_TOYS,
  anal:        ADULT_TOYS,
  bondage:     ADULT_TOYS,
  'cock-ring': ADULT_TOYS,
  stroker:     ADULT_TOYS,
  couples:     ADULT_TOYS,
  harness:     ADULT_TOYS,
  extender:    ADULT_TOYS,
  pump:        ADULT_TOYS,
  enhancer:    ADULT_TOYS,
  novelty:     ADULT_TOYS,
  'sex-machine': ADULT_TOYS,
  wear:        ADULT_TOYS,
  'book-media': ADULT_TOYS,
  lube:        SEXUAL_WELLNESS,
  massage:     SEXUAL_WELLNESS,
  wellness:    SEXUAL_WELLNESS,
  condom:      SEXUAL_WELLNESS,
}

function categoryFor(dial: string | null): string {
  if (!dial) return ADULT_TOYS
  return GMC_CATEGORY_BY_DIAL[dial] ?? ADULT_TOYS
}

function genderFor(audienceTags: string[]): 'male' | 'female' | 'unisex' {
  const hasHim = audienceTags.includes('for-him')
  const hasHer = audienceTags.includes('for-her')
  if (hasHim && !hasHer) return 'male'
  if (hasHer && !hasHim) return 'female'
  return 'unisex'
}

// --- New helper functions ----------------------------------------------------

function parseSpecValue(specs: string[], key: string): string | null {
  const lower = key.toLowerCase()
  for (const spec of specs) {
    const [k, ...rest] = spec.split(':')
    if (k?.trim().toLowerCase() === lower && rest.length) {
      return rest.join(':').trim() || null
    }
  }
  return null
}

function customLabel1(audienceTags: string[]): string {
  const hasHim    = audienceTags.includes('for-him')
  const hasHer    = audienceTags.includes('for-her')
  const hasCouples = audienceTags.includes('couples')
  if (hasCouples || (hasHim && hasHer)) return 'couples'
  if (hasHim) return 'for-him'
  if (hasHer) return 'for-her'
  return 'unisex'
}

function customLabel2(dealScoreRaw: string | null | undefined): string {
  const score = parseFloat(dealScoreRaw ?? '')
  if (isNaN(score)) return 'low'
  if (score > 80) return 'high'
  if (score >= 60) return 'mid'
  return 'low'
}

function customLabel4(price: string | null | undefined): string {
  const n = parseFloat(price ?? '')
  if (isNaN(n)) return 'under-30'
  if (n < 30) return 'under-30'
  if (n <= 60) return '30-to-60'
  return '60-plus'
}

// --- Shopify GraphQL helper -------------------------------------------------

type ShopifyExtensions = {
  cost?: {
    requestedQueryCost?: number
    throttleStatus?: {
      maximumAvailable?:  number
      currentlyAvailable: number
      restoreRate:        number
    }
  }
}
type ShopifyError = { message: string; extensions?: { code?: string } }

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':           'application/json',
        'X-Shopify-Access-Token': TOKEN!,
      },
      body: JSON.stringify({ query, variables }),
    })
    if (res.status === 429 || res.status >= 500) {
      const wait = Math.min(30_000, 1000 * Math.pow(2, attempt))
      console.warn(`  Shopify HTTP ${res.status}, backing off ${wait}ms...`)
      await new Promise(r => setTimeout(r, wait))
      continue
    }
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`)
    const body = await res.json() as {
      data:        T
      errors?:     ShopifyError[]
      extensions?: ShopifyExtensions
    }

    // GraphQL-cost throttling: 200 OK with errors: [{ message: "Throttled" }]
    // and extensions.cost.throttleStatus telling us how long to wait.
    const throttled = body.errors?.some(
      e => e.message === 'Throttled' || e.extensions?.code === 'THROTTLED',
    )
    if (throttled) {
      const ts        = body.extensions?.cost?.throttleStatus
      const requested = body.extensions?.cost?.requestedQueryCost ?? 100
      const wait = ts
        ? Math.max(1000, Math.ceil((requested - ts.currentlyAvailable) / ts.restoreRate * 1000) + 250)
        : Math.min(30_000, 1000 * Math.pow(2, attempt))
      console.warn(`  Shopify throttled (cost ${requested}, available ${ts?.currentlyAvailable}, restore ${ts?.restoreRate}/s), waiting ${wait}ms...`)
      await new Promise(r => setTimeout(r, wait))
      continue
    }
    if (body.errors?.length) throw new Error(`GraphQL: ${body.errors.map(e => e.message).join('; ')}`)

    // Proactive pacing: if we're running low, sleep until the bucket has
    // room for another request of similar cost.
    const ts        = body.extensions?.cost?.throttleStatus
    const requested = body.extensions?.cost?.requestedQueryCost ?? 0
    if (ts && requested > 0 && ts.currentlyAvailable < requested * 2) {
      const wait = Math.ceil((requested * 2 - ts.currentlyAvailable) / ts.restoreRate * 1000)
      if (wait > 0) await new Promise(r => setTimeout(r, wait))
    }
    return body.data
  }
  throw new Error('Shopify request failed after retries (throttled)')
}

// --- Nalpac feed: SKU -> UPC map --------------------------------------------

async function buildSkuToUpcMap(): Promise<Map<string, string>> {
  console.log(`Fetching Nalpac main feed: ${NALPAC_MAIN_FEED}`)
  const res = await fetch(NALPAC_MAIN_FEED)
  if (!res.ok) throw new Error(`Nalpac main feed HTTP ${res.status}`)
  const csv  = await res.text()
  const rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[]
  const map  = new Map<string, string>()
  for (const row of rows) {
    const sku = (row['SKU'] ?? row['Sku'] ?? '').trim()
    const upc = (row['UPC/barcode'] ?? row['UPC'] ?? row['Barcode'] ?? '').trim()
    if (sku && upc) map.set(sku, upc)
  }
  console.log(`Indexed ${map.size} SKU -> UPC pairs from ${rows.length} feed rows.`)
  return map
}

// --- Shopify product enumeration -------------------------------------------

const LIST_QUERY = `
  query Products($cursor: String) {
    products(first: 25, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        title
        nalpacSku:      metafield(namespace: "xdipx", key: "nalpac_sku")            { value }
        dial:           metafield(namespace: "xdipx", key: "product_type_dial")     { value }
        audienceTags:   metafield(namespace: "xdipx", key: "audience_tags")         { value }
        specifications: metafield(namespace: "xdipx", key: "specifications")        { value }
        dealScore:      metafield(namespace: "xdipx", key: "deal_score")            { value }
        isDailyDeal:    metafield(namespace: "xdipx", key: "is_daily_deal")         { value }
        gmcCategory:    metafield(namespace: "mm-google-shopping", key: "google_product_category") { value }
        gmcAgeGroup:    metafield(namespace: "mm-google-shopping", key: "age_group") { value }
        gmcCondition:   metafield(namespace: "mm-google-shopping", key: "condition") { value }
        gmcGender:      metafield(namespace: "mm-google-shopping", key: "gender")    { value }
        gmcMpn:         metafield(namespace: "mm-google-shopping", key: "mpn")       { value }
        gmcCustom:      metafield(namespace: "mm-google-shopping", key: "custom_product") { value }
        gmcColor:       metafield(namespace: "mm-google-shopping", key: "color")     { value }
        gmcMaterial:    metafield(namespace: "mm-google-shopping", key: "material")  { value }
        gmcSize:        metafield(namespace: "mm-google-shopping", key: "size")      { value }
        gmcLabel0:      metafield(namespace: "mm-google-shopping", key: "custom_label_0") { value }
        gmcLabel1:      metafield(namespace: "mm-google-shopping", key: "custom_label_1") { value }
        gmcLabel2:      metafield(namespace: "mm-google-shopping", key: "custom_label_2") { value }
        gmcLabel3:      metafield(namespace: "mm-google-shopping", key: "custom_label_3") { value }
        gmcLabel4:      metafield(namespace: "mm-google-shopping", key: "custom_label_4") { value }
        variants(first: 50) {
          nodes { id sku barcode price }
        }
      }
    }
  }
`

type Variant = { id: string; sku: string | null; barcode: string | null; price: string }
type Product = {
  id:             string
  handle:         string
  title:          string
  nalpacSku:      { value: string } | null
  dial:           { value: string } | null
  audienceTags:   { value: string } | null
  specifications: { value: string } | null
  dealScore:      { value: string } | null
  isDailyDeal:    { value: string } | null
  gmcCategory:    { value: string } | null
  gmcAgeGroup:    { value: string } | null
  gmcCondition:   { value: string } | null
  gmcGender:      { value: string } | null
  gmcMpn:         { value: string } | null
  gmcCustom:      { value: string } | null
  gmcColor:       { value: string } | null
  gmcMaterial:    { value: string } | null
  gmcSize:        { value: string } | null
  gmcLabel0:      { value: string } | null
  gmcLabel1:      { value: string } | null
  gmcLabel2:      { value: string } | null
  gmcLabel3:      { value: string } | null
  gmcLabel4:      { value: string } | null
  variants:       { nodes: Variant[] }
}

async function* listProducts(): AsyncGenerator<Product> {
  let cursor: string | null = null
  do {
    const data = await gql<{
      products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Product[] }
    }>(LIST_QUERY, { cursor })
    for (const p of data.products.nodes) yield p
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null
  } while (cursor)
}

// --- Write mutations --------------------------------------------------------

const SET_METAFIELDS = `
  mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id key namespace }
      userErrors { field message }
    }
  }
`

const UPDATE_VARIANTS = `
  mutation UpdateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id barcode }
      userErrors { field message }
    }
  }
`

type MetafieldWrite = {
  ownerId:   string
  namespace: string
  key:       string
  type:      string
  value:     string
}

type VariantBarcodeWrite = {
  productId:  string
  productHdl: string
  variantId:  string
  sku:        string
  barcode:    string
}

function parseListMetafield(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

// --- Main -------------------------------------------------------------------

async function main() {
  const mode = APPLY ? 'APPLY' : 'DRY RUN'
  console.log(`Mode: ${mode}${FORCE ? ' (forcing overwrite of existing values)' : ''}`)
  if (ONLY_BARCODES)   console.log('Scope: variant barcodes only')
  if (ONLY_METAFIELDS) console.log('Scope: metafields only')
  if (Number.isFinite(LIMIT)) console.log(`Limit: first ${LIMIT} product(s)`)

  const skuToUpc = ONLY_METAFIELDS ? new Map<string, string>() : await buildSkuToUpcMap()

  const metafieldWrites: MetafieldWrite[]     = []
  const barcodeWrites:   VariantBarcodeWrite[] = []

  let total                   = 0
  let withDial                = 0
  let withNalpacSku           = 0
  let withSpecs               = 0
  let upcMatched              = 0
  let upcMissing              = 0
  let variantsAlreadyBarcoded = 0

  for await (const p of listProducts()) {
    if (total >= LIMIT) break
    total++
    const dial         = p.dial?.value ?? null
    const audienceTags = parseListMetafield(p.audienceTags?.value)
    const nalpacSku    = p.nalpacSku?.value?.trim() ?? null
    const specsRaw     = parseListMetafield(p.specifications?.value)
    if (dial)             withDial++
    if (nalpacSku)        withNalpacSku++
    if (specsRaw.length)  withSpecs++

    // ---- Variant barcode (GTIN) ---------------------------------------
    if (!ONLY_METAFIELDS) {
      for (const v of p.variants.nodes) {
        if (v.barcode) { variantsAlreadyBarcoded++; if (!FORCE) continue }
        const sku = (v.sku ?? '').trim()
        const upc = sku ? skuToUpc.get(sku) ?? null : null
        if (!upc) { upcMissing++; continue }
        upcMatched++
        barcodeWrites.push({
          productId:  p.id,
          productHdl: p.handle,
          variantId:  v.id,
          sku,
          barcode:    upc,
        })
      }
    }

    // ---- Product-level mm-google-shopping metafields -----------------
    if (!ONLY_BARCODES) {
      const wants: Array<{ key: string; value: string; existing: string | null | undefined }> = [
        { key: 'google_product_category', value: categoryFor(dial),       existing: p.gmcCategory?.value  },
        { key: 'age_group',               value: 'adult',                  existing: p.gmcAgeGroup?.value  },
        { key: 'condition',               value: 'new',                    existing: p.gmcCondition?.value },
        { key: 'gender',                  value: genderFor(audienceTags),  existing: p.gmcGender?.value    },
      ]

      // mpn falls back to the Nalpac SKU (manufacturer part number). Skip
      // when we have neither a nalpac_sku metafield nor any variant SKU.
      const mpn = nalpacSku ?? p.variants.nodes.find(v => v.sku)?.sku?.trim() ?? null
      if (mpn) wants.push({ key: 'mpn', value: mpn, existing: p.gmcMpn?.value })

      // custom_product = TRUE when we have no GTIN for any variant. We use
      // the barcodeWrites we just queued PLUS any pre-existing barcodes to
      // decide. If at least one variant has/will-have a barcode, the product
      // is identified; otherwise mark it custom so GMC accepts it.
      const willHaveGtin = p.variants.nodes.some(v => v.barcode)
        || barcodeWrites.some(b => b.productId === p.id)
      if (!willHaveGtin) {
        wants.push({ key: 'custom_product', value: 'TRUE', existing: p.gmcCustom?.value })
      }

      // ---- New fields from specifications + deal metadata --------------

      // color and material from xdipx.specifications JSON array
      const color    = parseSpecValue(specsRaw, 'color') ?? parseSpecValue(specsRaw, 'colour')
      const material = parseSpecValue(specsRaw, 'material')
      const size     = parseSpecValue(specsRaw, 'size')

      if (color)    wants.push({ key: 'color',    value: color,    existing: p.gmcColor?.value    })
      if (material) wants.push({ key: 'material', value: material, existing: p.gmcMaterial?.value })
      if (size)     wants.push({ key: 'size',     value: size,     existing: p.gmcSize?.value     })

      // custom_label_0: product type dial (skip when not set)
      if (dial) {
        wants.push({ key: 'custom_label_0', value: dial, existing: p.gmcLabel0?.value })
      }

      // custom_label_1: audience bucket
      const cl1 = customLabel1(audienceTags)
      wants.push({ key: 'custom_label_1', value: cl1, existing: p.gmcLabel1?.value })

      // custom_label_2: deal score tier
      const cl2 = customLabel2(p.dealScore?.value)
      wants.push({ key: 'custom_label_2', value: cl2, existing: p.gmcLabel2?.value })

      // custom_label_3: deal vs vault
      const cl3 = p.isDailyDeal?.value === 'true' ? 'deal' : 'vault'
      wants.push({ key: 'custom_label_3', value: cl3, existing: p.gmcLabel3?.value })

      // custom_label_4: price bucket from first variant
      const cl4 = customLabel4(p.variants.nodes[0]?.price)
      wants.push({ key: 'custom_label_4', value: cl4, existing: p.gmcLabel4?.value })

      for (const w of wants) {
        if (!FORCE && w.existing === w.value) continue
        metafieldWrites.push({
          ownerId:   p.id,
          namespace: 'mm-google-shopping',
          key:       w.key,
          type:      'single_line_text_field',
          value:     w.value,
        })
      }
    }
  }

  console.log('')
  console.log('=== Scan complete ===')
  console.log(`  Products scanned:                ${total}`)
  console.log(`  With xdipx.product_type_dial:    ${withDial}`)
  console.log(`  With xdipx.nalpac_sku:           ${withNalpacSku}`)
  console.log(`  With xdipx.specifications:       ${withSpecs}`)
  if (!ONLY_METAFIELDS) {
    console.log(`  Variant barcodes to write:       ${barcodeWrites.length}`)
    console.log(`    UPC matched in Nalpac feed:    ${upcMatched}`)
    console.log(`    UPC missing (no feed match):   ${upcMissing}`)
    console.log(`    Variants already had barcode:  ${variantsAlreadyBarcoded}`)
  }
  if (!ONLY_BARCODES) {
    console.log(`  Metafield writes queued:         ${metafieldWrites.length}`)
  }

  if (!APPLY) {
    console.log('')
    console.log('Dry run. Re-run with --apply to write.')
    if (barcodeWrites.length > 0) {
      console.log('\nSample barcode writes (first 5):')
      for (const b of barcodeWrites.slice(0, 5)) {
        console.log(`  ${b.productHdl} / variant ${b.sku} -> barcode ${b.barcode}`)
      }
    }
    if (metafieldWrites.length > 0) {
      console.log('\nSample metafield writes (first 15):')
      for (const m of metafieldWrites.slice(0, 15)) {
        console.log(`  ${m.ownerId.split('/').pop()} ${m.namespace}.${m.key} = "${m.value}"`)
      }
    }
    return
  }

  // ---- Apply metafields (25 per call) ------------------------------------
  if (metafieldWrites.length > 0) {
    console.log(`\nWriting ${metafieldWrites.length} metafields in batches of 25...`)
    const CHUNK = 25
    let written = 0
    for (let i = 0; i < metafieldWrites.length; i += CHUNK) {
      const batch = metafieldWrites.slice(i, i + CHUNK)
      const result = await gql<{
        metafieldsSet: {
          metafields: Array<{ id: string }> | null
          userErrors: Array<{ field: string[]; message: string }>
        }
      }>(SET_METAFIELDS, { metafields: batch })
      const errs = result.metafieldsSet.userErrors
      if (errs.length > 0) {
        console.error(`  x batch ${i / CHUNK + 1}: ${errs.map(e => `${e.field?.join('.')} ${e.message}`).join('; ')}`)
      }
      const w = result.metafieldsSet.metafields?.length ?? 0
      written += w
      console.log(`  + metafield batch ${i / CHUNK + 1}: wrote ${w}/${batch.length}`)
    }
    console.log(`Wrote ${written} metafields.`)
  }

  // ---- Apply variant barcodes (grouped by productId) ---------------------
  if (barcodeWrites.length > 0) {
    console.log(`\nWriting ${barcodeWrites.length} variant barcodes (grouped by product)...`)
    const byProduct = new Map<string, VariantBarcodeWrite[]>()
    for (const b of barcodeWrites) {
      const arr = byProduct.get(b.productId) ?? []
      arr.push(b)
      byProduct.set(b.productId, arr)
    }
    let written = 0
    let i = 0
    for (const [productId, writes] of byProduct) {
      i++
      const result = await gql<{
        productVariantsBulkUpdate: {
          productVariants: Array<{ id: string; barcode: string | null }> | null
          userErrors: Array<{ field: string[]; message: string }>
        }
      }>(UPDATE_VARIANTS, {
        productId,
        variants: writes.map(w => ({ id: w.variantId, barcode: w.barcode })),
      })
      const errs = result.productVariantsBulkUpdate.userErrors
      const handle = writes[0]?.productHdl ?? productId
      if (errs.length > 0) {
        console.error(`  x ${handle}: ${errs.map(e => `${e.field?.join('.')} ${e.message}`).join('; ')}`)
      } else {
        const w = result.productVariantsBulkUpdate.productVariants?.length ?? 0
        written += w
        console.log(`  + ${i}/${byProduct.size} ${handle}: wrote ${w}/${writes.length} variant barcodes`)
      }
    }
    console.log(`Wrote ${written} variant barcodes.`)
  }

  console.log('\nDone.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
