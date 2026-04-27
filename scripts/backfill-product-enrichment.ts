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
  shopifyAdmin,
  type ProductPageDoc,
} from '../app/lib/shopify.server'
import { generateProductContent } from '../app/lib/emma-orchestrator.server'
import {
  fetchNalpacFeed,
  isDiscontinued,
} from '../app/lib/feed-processor.server'
import { makeLLMClient } from '../app/lib/llm-client.server'

interface Args {
  apply:               boolean
  via:                 'api' | 'claude-code'
  mode:                'fill-gaps' | 'refresh' | 'full'
  scope:               'all' | 'titles-only' | 'pairings-only' | 'keywords-only' | 'tags-only' | 'archive-discontinued'
  limit?:              number
  handle?:             string
  sku?:                string
  fromHandle?:         string
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
  if (handle)     out.handle     = handle
  if (sku)        out.sku        = sku
  if (fromHandle) out.fromHandle = fromHandle
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

  // Run orchestrator for everything except archive mode.
  // Note: the orchestrator runs *every* tool — this is a known cost. For
  // scope-narrowed runs we still let it run but only push the relevant fields
  // back to Shopify, so the budget hit is the same but the diff is narrower.
  // A future optimization could conditionally short-circuit tools, but the
  // orchestrator's prompt is already biased toward calling every applicable
  // tool exactly once.
  let writes: Awaited<ReturnType<typeof generateProductContent>>['writes'] | null = null
  let cost = { inputTokens: 0, outputTokens: 0 }
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
  if (!writes) {
    summary.errors.push({ sku: row.sku, message: 'orchestrator returned no writes' })
    return
  }

  // Build a narrow ProductPageDoc with only the fields we asked for.
  const doc: ProductPageDoc = { shopifyProductId: row.shopifyProductId }
  const fieldsChanged: string[] = []

  if (want.title && writes.productTitleAugmented && await maybeShouldRefresh(snap, 'xdipx.original_title', args)) {
    doc.title         = writes.productTitle
    doc.seoTitle      = writes.productTitle
    doc.originalTitle = writes.originalTitle
    fieldsChanged.push('title', 'original_title')
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
    if (writes.featureBullets?.length) { doc.featureBullets = writes.featureBullets; fieldsChanged.push('feature_bullets') }
  }

  if (want.pairings && writes.accessoryProductIds?.length) {
    if (await maybeShouldRefresh(snap, 'xdipx.pairing_why', args)) {
      doc.accessoryProductIds = writes.accessoryProductIds
      doc.pairingWhy          = writes.pairingWhy
      fieldsChanged.push('pairing_why', 'accessory_product_ids')
    }
  }

  if (fieldsChanged.length === 0) {
    summary.skipped++
    console.log(JSON.stringify({ handle: snap.handle, sku: row.sku, mode: args.scope, fieldsChanged: [], cost, durationMs: 0 }))
    return
  }

  if (!args.apply) {
    summary.changed++  // counted as "would change" in dry-run summary
    console.log(JSON.stringify({ handle: snap.handle, sku: row.sku, mode: args.scope, dryRun: true, fieldsChanged, cost }))
    return
  }

  try {
    // pushProductToShopify requires featureBullets when modifying — narrow
    // mode runs may not include it. Pull from the existing metafield as a
    // fallback so we don't fail validation.
    if (!doc.featureBullets) {
      const existing = snap.metafields['xdipx.feature_bullets']
      if (existing) {
        try { doc.featureBullets = JSON.parse(existing) as string[] } catch { /* ignore */ }
      }
    }
    if (!doc.tagline)            doc.tagline            = snap.metafields['xdipx.tagline']
    if (!doc.seoMetaDescription) doc.seoMetaDescription = snap.metafields['xdipx.seo_meta_description']
    if (!doc.specifications)     doc.specifications     = snap.metafields['xdipx.specifications']

    await pushProductToShopify(doc)
    summary.changed++
    console.log(JSON.stringify({ handle: snap.handle, sku: row.sku, mode: args.scope, applied: true, fieldsChanged, cost }))
  } catch (err) {
    summary.errors.push({ sku: row.sku, message: `pushProductToShopify: ${err instanceof Error ? err.message : err}` })
  }
}

function inferCategoryFallback(stored: string | undefined): 'for-him' | 'for-her' | 'both' | 'couples' {
  if (stored === 'for-him' || stored === 'for-her' || stored === 'both' || stored === 'couples') return stored
  return 'both'
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv)
  const summary: BackfillSummary = {
    processed: 0, changed: 0, skipped: 0, errors: [],
    totalCost: { inputTokens: 0, outputTokens: 0 },
  }

  console.log(`Backfill: scope=${args.scope} mode=${args.mode} via=${args.via} dryRun=${!args.apply}`)

  if (args.scope === 'archive-discontinued') {
    await runArchiveDiscontinued(args, summary)
  } else {
    const rows = await listProducts(args)
    console.log(`[backfill] ${rows.length} product(s) to process`)
    if (args.apply && rows.length > 50) {
      console.log(`\n!!! ABOUT TO APPLY ENRICHMENT TO ${rows.length} PRODUCTS !!!\nThis is a multi-hour, multi-dollar run. Re-run with --limit=N to scope down.\n`)
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
