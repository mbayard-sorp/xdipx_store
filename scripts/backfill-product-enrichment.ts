/**
 * One-time (or per-feature) backfill that brings existing Shopify products
 * up to parity with the latest importer output. Reuses the same orchestrator
 * and pushProductToShopify path as the live importer — no duplicate logic.
 *
 *   npx tsx scripts/backfill-product-enrichment.ts                     # dry-run, 5 products, --via=api
 *   npx tsx scripts/backfill-product-enrichment.ts --apply             # write
 *   npx tsx scripts/backfill-product-enrichment.ts --via=claude-code   # bill against Max subscription
 *   npx tsx scripts/backfill-product-enrichment.ts --pairings-only --apply
 *   npx tsx scripts/backfill-product-enrichment.ts --titles-only --limit=20
 *   npx tsx scripts/backfill-product-enrichment.ts --archive-discontinued --apply
 *
 * Modes (combine to scope work):
 *   --titles-only           — generateProductTitle only (cheap, fast)
 *   --pairings-only         — proposePairingWhy only (fills the new metafield)
 *   --keywords-only         — re-runs copy generators with the keyword bank
 *   --tags-only             — refreshes mood/audience/matters tags
 *   --archive-discontinued  — no AI; pulls Nalpac feed, archives matching SKUs
 *   (no flag)               — full orchestrator, behaves like a re-import
 *
 * Diff modes:
 *   --mode=fill-gaps  — only writes empty fields (default; safe re-runs)
 *   --mode=refresh    — overwrite when Shopify updatedAt is older than --max-age days
 *   --mode=full       — overwrite everything (post-deploy nuke)
 *
 * Other:
 *   --dry-run       — default true; require --apply for writes
 *   --apply         — actually write
 *   --limit=N       — cap at N products (default: 5 dry-run, no cap when apply)
 *   --handle=h      — single product by handle
 *   --sku=s         — single product by Nalpac SKU
 *   --from-handle=h — resume from this handle (alphabetical)
 *   --via=api|claude-code — pick the LLM transport (default: api)
 *
 * Exit code: 0 on clean run, 1 if any product errored.
 */
import 'dotenv/config'
import { eq, and, gte, sql } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { dealHistory } from '../db/schema'
import {
  pushProductToShopify,
  archiveShopifyProduct,
  getPairingCandidates,
  getProductHandleById,
  shopifyAdmin,
  type ProductPageDoc,
} from '../app/lib/shopify.server'
import { generateProductContent, type ProductWrites } from '../app/lib/emma-orchestrator.server'
import {
  fetchNalpacFeed,
  isDiscontinued,
} from '../app/lib/feed-processor.server'
import { makeLLMClient } from '../app/lib/llm-client.server'
import { upsertProductPage } from '../app/lib/sanity.server'

interface Args {
  apply:               boolean
  via:                 'api' | 'claude-code'
  mode:                'fill-gaps' | 'refresh' | 'full'
  scope:               'all' | 'titles-only' | 'pairings-only' | 'keywords-only' | 'tags-only' | 'archive-discontinued'
  limit?:              number
  handle?:             string
  sku?:                string
  fromHandle?:         string
  fromFile?:           string
  maxAgeDays:          number
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2)
  const has = (flag: string) => args.includes(flag)
  const valOf = (prefix: string) => {
    const arg = args.find(a => a.startsWith(`${prefix}=`))
    return arg ? arg.slice(prefix.length + 1) : undefined
  }

  const apply = has('--apply')
  const limit = valOf('--limit')
  const out: Args = {
    apply,
    via:        (valOf('--via') as Args['via']) ?? 'api',
    mode:       (valOf('--mode') as Args['mode']) ?? 'fill-gaps',
    scope:
      has('--titles-only')          ? 'titles-only'   :
      has('--pairings-only')        ? 'pairings-only' :
      has('--keywords-only')        ? 'keywords-only' :
      has('--tags-only')            ? 'tags-only'     :
      has('--archive-discontinued') ? 'archive-discontinued' :
                                      'all',
    maxAgeDays: Number(valOf('--max-age') ?? '90'),
  }
  if (limit) out.limit = Number(limit)
  if (!apply && out.limit === undefined) out.limit = 5
  const handle     = valOf('--handle')
  const sku        = valOf('--sku')
  const fromHandle = valOf('--from-handle')
  const fromFile   = valOf('--from-file')
  if (handle)     out.handle     = handle
  if (sku)        out.sku        = sku
  if (fromHandle) out.fromHandle = fromHandle
  if (fromFile)   out.fromFile   = fromFile
  if (out.via !== 'api' && out.via !== 'claude-code') {
    console.error(`Invalid --via=${out.via}. Use api or claude-code.`)
    process.exit(1)
  }
  return out
}

interface ProductRow {
  sku:               string
  brand:             string
  shopifyProductId:  string
  status:            string
}

async function listProducts(args: Args): Promise<ProductRow[]> {
  const conditions = []
  if (args.sku)    conditions.push(eq(dealHistory.sku, args.sku))
  // Skip already-archived rows by default.
  if (args.scope !== 'archive-discontinued') {
    conditions.push(sql`${dealHistory.status} != 'archived'`)
  }

  let query = db
    .select({
      sku:              dealHistory.sku,
      brand:            dealHistory.brand,
      shopifyProductId: dealHistory.shopifyProductId,
      status:           dealHistory.status,
    })
    .from(dealHistory)
    .orderBy(dealHistory.sku)
  if (conditions.length > 0) query = query.where(and(...conditions)) as typeof query

  let rows = await query
  if (args.fromHandle) {
    rows = rows.filter(r => r.sku >= args.fromHandle!)
  }
  if (args.limit !== undefined && args.limit > 0) rows = rows.slice(0, args.limit)
  return rows
}

interface ShopifyProductSnapshot {
  id:                string
  title:             string
  handle:            string
  vendor:            string
  body_html:         string
  status:            string
  product_type:      string
  updated_at:        string
  metafields:        Record<string, string>  // namespace.key -> raw value
  rawDescription?:   string
  images:            { src: string }[]
}

async function fetchProductSnapshot(numericId: string): Promise<ShopifyProductSnapshot | null> {
  try {
    const { product } = await shopifyAdmin<{
      product: {
        id:           number
        title:        string
        handle:       string
        vendor:       string
        body_html:    string
        status:       string
        product_type: string
        updated_at:   string
        images:       { src: string }[]
      } | null
    }>(`/products/${numericId}.json`)
    if (!product) return null

    const xdipx = await shopifyAdmin<{
      metafields: Array<{ namespace: string; key: string; value: string }>
    }>(`/products/${numericId}/metafields.json?namespace=xdipx&limit=50`)
    const custom = await shopifyAdmin<{
      metafields: Array<{ namespace: string; key: string; value: string }>
    }>(`/products/${numericId}/metafields.json?namespace=custom&limit=10`)

    const metafields: Record<string, string> = {}
    for (const m of [...(xdipx.metafields ?? []), ...(custom.metafields ?? [])]) {
      metafields[`${m.namespace}.${m.key}`] = m.value
    }

    const result: ShopifyProductSnapshot = {
      id:           String(product.id),
      title:        product.title,
      handle:       product.handle,
      vendor:       product.vendor,
      body_html:    product.body_html,
      status:       product.status,
      product_type: product.product_type,
      updated_at:   product.updated_at,
      metafields,
      images:       product.images ?? [],
    }
    if (metafields['custom.original_description']) result.rawDescription = metafields['custom.original_description']
    return result
  } catch (err) {
    console.warn(`[backfill] fetchProductSnapshot ${numericId} failed:`, err instanceof Error ? err.message : err)
    return null
  }
}

interface BackfillSummary {
  processed:  number
  changed:    number
  skipped:    number
  errors:     Array<{ sku: string; message: string }>
  totalCost:  { inputTokens: number; outputTokens: number }
}

async function maybeShouldRefresh(
  snap: ShopifyProductSnapshot,
  field: string,
  args: Args,
): Promise<boolean> {
  if (args.mode === 'full') return true
  const existing = snap.metafields[field]
  if (!existing) return true  // empty — fill regardless of mode
  if (args.mode === 'refresh') {
    const updated = new Date(snap.updated_at).getTime()
    const cutoff  = Date.now() - args.maxAgeDays * 24 * 60 * 60 * 1000
    return updated < cutoff
  }
  return false  // fill-gaps mode: leave populated values alone
}

// ─── Archive-discontinued mode (no AI) ───────────────────────────────────────

async function runArchiveDiscontinued(args: Args, summary: BackfillSummary) {
  const products = await fetchNalpacFeed()
  const flagged: string[] = []
  for (const p of products) {
    if (isDiscontinued(p)) flagged.push(p.SKU)
  }
  console.log(`[archive-discontinued] feed has ${flagged.length} discontinued SKU(s)`)

  for (const sku of flagged) {
    summary.processed++
    const rows = await db
      .select({ shopifyProductId: dealHistory.shopifyProductId, status: dealHistory.status })
      .from(dealHistory)
      .where(eq(dealHistory.sku, sku))
      .limit(1)
    const row = rows[0]
    if (!row) {
      summary.skipped++
      continue
    }
    if (row.status === 'archived') {
      summary.skipped++
      continue
    }
    if (!args.apply) {
      console.log(`  DRY: would archive ${sku} (Shopify ${row.shopifyProductId})`)
      continue
    }
    try {
      await archiveShopifyProduct(row.shopifyProductId, 'discontinued by manufacturer (backfill)')
      await db.update(dealHistory).set({ status: 'archived' }).where(eq(dealHistory.sku, sku))
      summary.changed++
      console.log(`  ✓ archived ${sku}`)
    } catch (err) {
      summary.errors.push({ sku, message: err instanceof Error ? err.message : String(err) })
    }
  }
}

// ─── Per-product enrichment (uses orchestrator) ──────────────────────────────

async function enrichOne(
  row: ProductRow,
  args: Args,
  summary: BackfillSummary,
  /** When provided, skip the orchestrator and use these writes directly.
   *  Used by `--from-file` mode where a Claude Code subagent has already
   *  produced the ProductWrites payload (Max-billed, zero API spend). */
  preGeneratedWrites?: ProductWrites,
): Promise<void> {
  summary.processed++

  const snap = await fetchProductSnapshot(row.shopifyProductId)
  if (!snap) {
    summary.errors.push({ sku: row.sku, message: 'Shopify product not found' })
    return
  }

  // Skip if Nalpac flagged it discontinued — archive instead.
  // (We don't refetch the feed here; rely on caller to use --archive-discontinued.)

  const rawDescription = snap.rawDescription ?? snap.body_html.replace(/<[^>]+>/g, ' ').slice(0, 2000)
  const categoriesRaw  = await db
    .select({ categories: dealHistory.categories })
    .from(dealHistory)
    .where(eq(dealHistory.sku, row.sku))
    .limit(1)
  const categories = (categoriesRaw[0]?.categories as string[] | null | undefined) ?? []

  const dealPriceRaw   = snap.metafields['xdipx.original_price']
  const msrp           = Number(dealPriceRaw) || 0

  // Decide which fields to write per scope.
  const want = {
    title:    args.scope === 'all' || args.scope === 'titles-only',
    pairings: args.scope === 'all' || args.scope === 'pairings-only',
    keywords: args.scope === 'all' || args.scope === 'keywords-only',
    tags:     args.scope === 'all' || args.scope === 'tags-only',
  }

  // Run orchestrator unless caller pre-generated writes (e.g. via --from-file
  // where a Claude Code subagent already did the work on the Max subscription).
  // Note: the orchestrator runs *every* tool — this is a known cost. For
  // scope-narrowed runs we still let it run but only push the relevant fields
  // back to Shopify, so the budget hit is the same but the diff is narrower.
  let writes: ProductWrites | null = null
  let cost = { inputTokens: 0, outputTokens: 0 }
  if (preGeneratedWrites) {
    writes = preGeneratedWrites
    // No cost — content was generated externally. Telemetry shows zero for these rows.
  } else {
    try {
      const llmClient = makeLLMClient(args.via)
      const pairingCandidates = await getPairingCandidates({
        shopifyProductId: row.shopifyProductId,
        subCategories:    categories,
      }).catch(() => [])

      const result = await generateProductContent({
        product: {
          title:       snap.title,
          brand:       snap.vendor || row.brand,
          description: rawDescription,
          categories,
          dealPrice:   Number(snap.metafields['xdipx.map_price']) || msrp,
          msrp,
        },
        seoTitle:          snap.title,
        category:          inferCategoryFallback(snap.metafields['xdipx.category']),
        pairingCandidates,
        llmClient,
      })
      writes = result.writes
      cost = {
        inputTokens:  result.telemetry.totalInputTokens,
        outputTokens: result.telemetry.totalOutputTokens,
      }
      summary.totalCost.inputTokens  += cost.inputTokens
      summary.totalCost.outputTokens += cost.outputTokens
    } catch (err) {
      summary.errors.push({ sku: row.sku, message: `orchestrator: ${err instanceof Error ? err.message : err}` })
      return
    }
  }
  if (!writes) {
    summary.errors.push({ sku: row.sku, message: 'orchestrator returned no writes' })
    return
  }

  // Build a narrow ProductPageDoc with only the fields we asked for.
  const doc: ProductPageDoc = { shopifyProductId: row.shopifyProductId }
  const fieldsChanged: string[] = []

  // Augmented display title — only override product.title when the orchestrator
  // decided the manufacturer's title needed an SEO descriptor appended.
  if (want.title && writes.productTitleAugmented && await maybeShouldRefresh(snap, 'xdipx.original_title', args)) {
    doc.title    = writes.productTitle
    doc.seoTitle = writes.productTitle
    fieldsChanged.push('title')
  }

  // Manufacturer's verbatim title — store it on xdipx.original_title regardless of
  // whether we augmented the display title. Provides a stable source-of-truth for
  // legal / sourcing / future re-augmentation.
  if (writes.originalTitle && await maybeShouldRefresh(snap, 'xdipx.original_title', args)) {
    doc.originalTitle = writes.originalTitle
    fieldsChanged.push('original_title')
  }

  // Core PDP attributes — populate when missing, regardless of --titles-only / etc.
  // scope flags. The PDP's sensation-dial UI ([app/routes/_layout.products.$slug.tsx])
  // and the IVR/chat search-tag flow both depend on these. Without them, backfilled
  // products silently render without the dial visualization.
  if (writes.productTypeDial && await maybeShouldRefresh(snap, 'xdipx.product_type_dial', args)) {
    doc.productTypeDial = writes.productTypeDial
    fieldsChanged.push('product_type_dial')
  }
  if (writes.sensationDialV2 && await maybeShouldRefresh(snap, 'xdipx.sensation_dial_v2', args)) {
    doc.sensationDialV2 = writes.sensationDialV2
    fieldsChanged.push('sensation_dial_v2')
  }
  if (writes.specifications && await maybeShouldRefresh(snap, 'xdipx.specifications', args)) {
    doc.specifications = writes.specifications
    fieldsChanged.push('specifications')
  }
  if (writes.careInstructions?.length && await maybeShouldRefresh(snap, 'xdipx.care_instructions', args)) {
    doc.careInstructions = writes.careInstructions
    fieldsChanged.push('care_instructions')
  }
  if (writes.boxContents?.length && await maybeShouldRefresh(snap, 'xdipx.box_contents', args)) {
    doc.boxContents = writes.boxContents
    fieldsChanged.push('box_contents')
  }
  if (writes.moodImageUrl && await maybeShouldRefresh(snap, 'xdipx.mood_image_url', args)) {
    doc.moodImageUrl = writes.moodImageUrl
    fieldsChanged.push('mood_image_url')
  }

  if (want.tags) {
    if (writes.moodTags?.length     && await maybeShouldRefresh(snap, 'xdipx.mood_tags',     args)) { doc.moodTags     = writes.moodTags;     fieldsChanged.push('mood_tags') }
    if (writes.audienceTags?.length && await maybeShouldRefresh(snap, 'xdipx.audience_tags', args)) { doc.audienceTags = writes.audienceTags; fieldsChanged.push('audience_tags') }
    if (writes.mattersTags?.length  && await maybeShouldRefresh(snap, 'xdipx.matters_tags',  args)) { doc.mattersTags  = writes.mattersTags;  fieldsChanged.push('matters_tags') }
  }

  if (want.keywords) {
    if (writes.tagline           && await maybeShouldRefresh(snap, 'xdipx.tagline',              args)) { doc.tagline            = writes.tagline;             fieldsChanged.push('tagline') }
    if (writes.seoMetaDescription&& await maybeShouldRefresh(snap, 'xdipx.seo_meta_description', args)) { doc.seoMetaDescription = writes.seoMetaDescription;  fieldsChanged.push('seo_meta_description') }
    if (writes.descriptionHtml   && (args.mode === 'full' || !snap.body_html))                           { doc.descriptionHtml    = writes.descriptionHtml;     fieldsChanged.push('descriptionHtml') }
  }

  if (want.pairings && writes.accessoryProductIds?.length) {
    if (await maybeShouldRefresh(snap, 'xdipx.pairing_why', args)) {
      doc.accessoryProductIds = writes.accessoryProductIds
      doc.pairingWhy          = writes.pairingWhy
      fieldsChanged.push('pairing_why', 'accessory_product_ids')
    }
  }

  // Sanity-only fields — no Shopify metafield equivalent. These need their
  // own change tracking because fieldsChanged only counts Shopify-targetable
  // updates. Without this, a product that has all Shopify metafields filled
  // but is missing Sanity FAQs / IVR fields would be `skipped: 1` and the
  // freshly-generated content would never reach the productPage doc.
  const sanityOnlyChanged: string[] = []
  if (writes.productFaqs?.length)   sanityOnlyChanged.push('productFaqs')
  if (writes.ivrExperience)         sanityOnlyChanged.push('ivrExperience')
  if (writes.ivrUseCase?.length)    sanityOnlyChanged.push('ivrUseCase')
  if (writes.ivrFeatures?.length)   sanityOnlyChanged.push('ivrFeatures')

  if (fieldsChanged.length === 0 && sanityOnlyChanged.length === 0) {
    summary.skipped++
    console.log(JSON.stringify({ handle: snap.handle, sku: row.sku, mode: args.scope, fieldsChanged: [], cost, durationMs: 0 }))
    return
  }

  if (!args.apply) {
    summary.changed++  // counted as "would change" in dry-run summary
    console.log(JSON.stringify({ handle: snap.handle, sku: row.sku, mode: args.scope, dryRun: true, fieldsChanged, sanityOnlyChanged, cost }))
    return
  }

  let shopifyApplied = false
  if (fieldsChanged.length > 0) {
    try {
      if (!doc.tagline)            doc.tagline            = snap.metafields['xdipx.tagline']
      if (!doc.seoMetaDescription) doc.seoMetaDescription = snap.metafields['xdipx.seo_meta_description']
      if (!doc.specifications)     doc.specifications     = snap.metafields['xdipx.specifications']

      await pushProductToShopify(doc)
      shopifyApplied = true
    } catch (err) {
      summary.errors.push({ sku: row.sku, message: `pushProductToShopify: ${err instanceof Error ? err.message : err}` })
      return
    }
  }

  // Mirror the same writes to the Sanity productPage doc so search index,
  // voice/IVR surfaces, and the keyword-bank productPage projection don't lag.
  // Runs whenever there are EITHER Shopify-side changes OR Sanity-only changes
  // (FAQs / IVR fields) — without the latter, a fully-populated Shopify product
  // would skip the Sanity sync and orphan the freshly-generated FAQs.
  // Mirrors the pattern at app/lib/bulk-import.server.ts:309-371.
  // Best-effort: failures here are logged + recorded but don't unwind the
  // already-successful Shopify write.
  try {
    const handle = await getProductHandleById(row.shopifyProductId)
    if (!handle) {
      summary.errors.push({ sku: row.sku, message: 'sanity: could not resolve Shopify handle — skipping productPage sync' })
      return
    }
    const gid = `gid://shopify/Product/${row.shopifyProductId}`

    // Build the upsert payload narrowed to what actually got written above.
    // Mirrors --mode=fill-gaps semantics: we only forward fields whose Shopify
    // counterpart was just updated (i.e. they're keys in `doc`).
    const upsertParams: Parameters<typeof upsertProductPage>[0] = {
      handle,
      shopifyProductId: gid,
      title:    snap.title,                  // safe default; orchestrator title overrides below
      vendor:   snap.vendor || row.brand,
      tags:     categories,
      category: snap.metafields['xdipx.category'] || undefined,
    }
    // Title — only overwrite when augmented (matches Shopify-side condition).
    if (doc.title !== undefined) upsertParams.title = doc.title
    if (doc.tagline)             upsertParams.tagline        = doc.tagline
    if (doc.seoTitle)            upsertParams.seoTitle       = doc.seoTitle
    if (doc.seoMetaDescription)  upsertParams.seoDescription = doc.seoMetaDescription
    if (writes.descriptionHtml)  upsertParams.description    = writes.descriptionHtml
    if (writes.productTypeDial)  upsertParams.productTypeDial = writes.productTypeDial
    if (writes.moodTags?.length)     upsertParams.moodTags     = writes.moodTags
    if (writes.audienceTags?.length) upsertParams.audienceTags = writes.audienceTags
    if (writes.mattersTags?.length)  upsertParams.mattersTags  = writes.mattersTags
    if (writes.ivrExperience)        upsertParams.ivrExperience    = writes.ivrExperience
    if (writes.ivrUseCase?.length)   upsertParams.ivrUseCase       = writes.ivrUseCase
    if (writes.ivrFeatures?.length)  upsertParams.ivrFeatures      = writes.ivrFeatures
    if (writes.productFaqs?.length)  upsertParams.productFaqs      = writes.productFaqs
    if (writes.moodImageUrl)         upsertParams.moodImageUrl     = writes.moodImageUrl

    // Pricing context — pulled from the Shopify snapshot's metafields, not
    // the orchestrator (orchestrator doesn't touch these).
    const originalPrice = Number(snap.metafields['xdipx.original_price'])
    const mapPrice      = Number(snap.metafields['xdipx.map_price'])
    if (Number.isFinite(originalPrice) && originalPrice > 0) upsertParams.originalPrice = originalPrice
    if (Number.isFinite(mapPrice)      && mapPrice      > 0) upsertParams.mapPrice      = mapPrice

    // Hero image for first-time productPage creates (idempotent on re-runs;
    // upsertProductPage skips when previewImageUrl is already on Sanity CDN).
    const firstImage = snap.images[0]?.src
    if (firstImage) upsertParams.imageUrl = firstImage

    // One retry on transient failure (network / short auth blip), matching
    // the live import flow.
    let lastErr: unknown
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await upsertProductPage(upsertParams)
        lastErr = null
        break
      } catch (err) {
        lastErr = err
        if (attempt === 1) {
          await new Promise(r => setTimeout(r, 500))
        }
      }
    }
    if (lastErr) {
      summary.errors.push({
        sku: row.sku,
        message: `sanity: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
      })
      return
    }
    // Both write paths complete (or only-Sanity for products with no Shopify changes).
    summary.changed++
    console.log(JSON.stringify({
      handle: snap.handle,
      sku:    row.sku,
      mode:   args.scope,
      applied: true,
      shopifyApplied,
      fieldsChanged,
      sanityOnlyChanged,
      cost,
    }))
  } catch (err) {
    // Defensive — anything thrown outside the retry block.
    summary.errors.push({
      sku: row.sku,
      message: `sanity: unexpected: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}

function inferCategoryFallback(stored: string | undefined): 'for-him' | 'for-her' | 'both' | 'couples' {
  if (stored === 'for-him' || stored === 'for-her' || stored === 'both' || stored === 'couples') return stored
  return 'both'
}

// ─── --from-file mode ────────────────────────────────────────────────────────
// Reads a JSON file of pre-generated writes and runs the same Shopify+Sanity
// push logic as the regular flow, skipping the orchestrator entirely. Designed
// for the Claude Code subagent path where `emma-product-enricher` (or similar)
// generates ProductWrites payloads on the Max subscription, then this script
// just ships them. Zero Anthropic API spend in this mode.
//
// Expected file shape:
//   [
//     { "shopifyProductId": "8718262894763", "writes": { /* ProductWrites */ } },
//     ...
//   ]

interface FromFileEntry {
  shopifyProductId: string
  /** Optional — for log output. The product is looked up by shopifyProductId. */
  sku?: string
  writes: ProductWrites
}

async function runFromFile(args: Args, summary: BackfillSummary) {
  const { readFile } = await import('node:fs/promises')
  const path = args.fromFile!
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch (err) {
    console.error(`[from-file] cannot read ${path}: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
  let entries: FromFileEntry[]
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) throw new Error('expected top-level array')
    entries = parsed as FromFileEntry[]
  } catch (err) {
    console.error(`[from-file] invalid JSON in ${path}: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }

  console.log(`[from-file] ${entries.length} pre-generated entry/entries to push`)
  console.log(`[cost-est] route: pre-generated content (subagent path) — zero Anthropic API spend; only Shopify + Sanity write calls`)

  // Look up each entry's deal_history row by shopifyProductId so we can
  // re-use the existing enrichOne plumbing (snap fetch, fill-gaps, push).
  const limit = args.apply ? entries.length : Math.min(entries.length, args.limit ?? 5)
  const slice = entries.slice(0, limit)

  for (const entry of slice) {
    if (!entry.shopifyProductId || !entry.writes) {
      summary.errors.push({ sku: entry.sku ?? '?', message: 'from-file entry missing shopifyProductId or writes' })
      continue
    }
    // Find the matching deal_history row to populate ProductRow shape.
    const histRows = await db
      .select({
        sku:              dealHistory.sku,
        shopifyProductId: dealHistory.shopifyProductId,
        brand:            dealHistory.brand,
        status:           dealHistory.status,
      })
      .from(dealHistory)
      .where(eq(dealHistory.shopifyProductId, entry.shopifyProductId))
      .limit(1)
    const histRow = histRows[0]
    if (!histRow) {
      summary.errors.push({ sku: entry.sku ?? entry.shopifyProductId, message: 'no deal_history row for shopifyProductId' })
      continue
    }
    const row: ProductRow = {
      sku:              histRow.sku,
      brand:            histRow.brand,
      shopifyProductId: histRow.shopifyProductId,
      status:           histRow.status,
    }
    await enrichOne(row, args, summary, entry.writes)
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Empirical per-product API cost (Anthropic key spend) for the per-tool content
 * generators — taglines, bullets, specs, SEO meta, Emma's take, FAQs, sensation
 * dial, IVR fields, etc. Each product fires ~14 generator calls split between
 * Sonnet and Haiku. Sample: a 5-product apply run earlier this session at
 * `--via=api` totalled ~$1.00 outer-loop tokens; per-tool tokens add roughly
 * the same again, so $0.30–0.50/product is a safe estimate.
 *
 * Architecture: outer orchestrator turn loop routes through Max subscription
 * (zero API spend, mostly cache-read). Per-tool generators route through the
 * Anthropic API key — that's where this estimate lives.
 */
const ESTIMATED_API_COST_PER_PRODUCT_USD = 0.40

function formatUsd(n: number): string {
  return n < 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(2)}`
}

async function main() {
  const args = parseArgs(process.argv)
  const summary: BackfillSummary = {
    processed: 0, changed: 0, skipped: 0, errors: [],
    totalCost: { inputTokens: 0, outputTokens: 0 },
  }

  console.log(`Backfill: scope=${args.scope} mode=${args.mode} via=${args.via} dryRun=${!args.apply}${args.fromFile ? ` fromFile=${args.fromFile}` : ''}`)

  if (args.scope === 'archive-discontinued') {
    await runArchiveDiscontinued(args, summary)
  } else if (args.fromFile) {
    await runFromFile(args, summary)
  } else {
    const rows = await listProducts(args)
    console.log(`[backfill] ${rows.length} product(s) to process`)

    // Cost estimate for the API-key spend (per-tool generators). Outer-loop
    // tokens on --via=claude-code are charged to Max and not surfaced here.
    const estimatedCostUsd = rows.length * ESTIMATED_API_COST_PER_PRODUCT_USD
    if (rows.length > 0) {
      const route = args.via === 'claude-code'
        ? 'hybrid: outer orchestrator on Max subscription, per-tool generators on Anthropic API key'
        : 'fully on Anthropic API key (orchestrator + per-tool)'
      console.log(`[cost-est] route: ${route}`)
      console.log(`[cost-est] estimated API spend: ~${formatUsd(estimatedCostUsd)} for ${rows.length} products (~${formatUsd(ESTIMATED_API_COST_PER_PRODUCT_USD)}/product, baseline)`)
      if (!args.apply) {
        console.log(`[cost-est] dry-run still runs the full orchestrator per product, so cost is the same as apply minus the Shopify push.`)
      }
    }

    if (args.apply && rows.length > 50) {
      console.log(`\n!!! ABOUT TO APPLY ENRICHMENT TO ${rows.length} PRODUCTS !!!\nEstimated API spend ~${formatUsd(estimatedCostUsd)}. Multi-hour run. Re-run with --limit=N to scope down.\n`)
    }
    for (const row of rows) {
      await enrichOne(row, args, summary)
    }
  }

  const ok = summary.errors.length === 0
  console.log()
  console.log('— summary —')
  console.log(`  processed: ${summary.processed}`)
  console.log(`  changed:   ${summary.changed}${args.apply ? '' : ' (would change)'}`)
  console.log(`  skipped:   ${summary.skipped}`)
  console.log(`  errors:    ${summary.errors.length}`)
  if (summary.totalCost.inputTokens > 0 || summary.totalCost.outputTokens > 0) {
    console.log(`  tokens:    input=${summary.totalCost.inputTokens} output=${summary.totalCost.outputTokens}`)
    // Actual $ figure assuming Sonnet pricing ($3/M input + $15/M output) for
    // the per-tool side. Underestimates slightly — Haiku-tier tools are
    // included in the input/output totals but priced cheaper. Treat as upper
    // bound on the API-key spend.
    const inUsd  = (summary.totalCost.inputTokens  / 1_000_000) * 3
    const outUsd = (summary.totalCost.outputTokens / 1_000_000) * 15
    console.log(`  cost:      ~${formatUsd(inUsd + outUsd)} (Sonnet upper-bound; Haiku tools are billed less)`)
  }
  for (const err of summary.errors) {
    console.log(`    ✗ ${err.sku}: ${err.message}`)
  }
  process.exit(ok ? 0 : 1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
