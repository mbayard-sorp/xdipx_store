/**
 * One-time (or per-feature) backfill that brings existing Shopify products
 * up to parity with the latest importer output. Reuses the same orchestrator
 * and pushProductToShopify path as the live importer — no duplicate logic.
 *
 *   npx tsx scripts/backfill-product-enrichment.ts                     # dry-run, 5 products, --via=api
 *   npx tsx scripts/backfill-product-enrichment.ts --apply             # write
 *   npx tsx scripts/backfill-product-enrichment.ts --via=claude-code   # bill against Max subscription
 *   npx tsx scripts/backfill-product-enrichment.ts --titles-only --limit=20
 *   npx tsx scripts/backfill-product-enrichment.ts --specs-only --apply
 *   npx tsx scripts/backfill-product-enrichment.ts --ivr-only --apply
 *   npx tsx scripts/backfill-product-enrichment.ts --archive-discontinued --apply
 *
 * Scopes (combine to narrow work):
 *   --titles-only           — generateProductTitle only (cheap, fast)
 *   --keywords-only         — re-runs copy generators with keyword targeting
 *                              (tagline + seoMetaDescription + descriptionHtml + FAQs)
 *   --tags-only             — refreshes D1 type/subtype + D3 Title Case mood/audience/matters tags
 *   --specs-only            — refreshes C1 boxContents + C2 specifications + C3 careInstructions
 *   --ivr-only              — refreshes G1 ivrExperience + G2 ivrUseCase + G3 ivrFeatures
 *   --archive-discontinued  — no AI; pulls Nalpac feed, archives matching SKUs
 *   (no flag)               — full orchestrator, behaves like a re-import
 *
 * REMOVED in Phase 1 rebuild:
 *   --pairings-only — pairings (F1/F2) are now deal-cycle artifacts, regenerated when
 *                     a product enters the homepage deal slot against the freshest
 *                     catalog state. Migrated out of the import-time backfill scope.
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
 *   --skip-sanity   — skip the productPage upsert (Shopify-only test mode)
 *
 * Exit code: 0 on clean run, 1 if any product errored.
 */
// MUST be the first import — populates process.env (with override) before any
// downstream module reads it at evaluation time (e.g. db.server.ts builds a
// Neon client at module scope).
import './_load-env'
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
  getPipelineSetting,
} from '../app/lib/feed-processor.server'
import { makeLLMClient } from '../app/lib/llm-client.server'
import { upsertProductPage } from '../app/lib/sanity.server'
import { runBatchEmmaTake, type BatchEmmaTakeInput } from '../app/lib/batch-enrichment.server'
import {
  getCachedWrites,
  setCachedWrites,
  hashVoice,
  PROMPT_VERSION,
} from '../app/lib/enrichment-cache.server'

interface Args {
  apply:               boolean
  via:                 'api' | 'claude-code' | 'batch'
  mode:                'fill-gaps' | 'refresh' | 'full'
  scope:               'all' | 'titles-only' | 'keywords-only' | 'tags-only' | 'specs-only' | 'ivr-only' | 'archive-discontinued'
  limit?:              number
  handle?:             string
  sku?:                string
  fromHandle?:         string
  fromFile?:           string
  maxAgeDays:          number
  skipSanity:          boolean
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
      has('--titles-only')          ? 'titles-only'    :
      has('--keywords-only')        ? 'keywords-only'  :
      has('--tags-only')            ? 'tags-only'      :
      has('--specs-only')           ? 'specs-only'     :
      has('--ivr-only')             ? 'ivr-only'       :
      has('--archive-discontinued') ? 'archive-discontinued' :
                                      'all',
    maxAgeDays: Number(valOf('--max-age') ?? '90'),
    skipSanity: has('--skip-sanity'),
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
  if (out.via !== 'api' && out.via !== 'claude-code' && out.via !== 'batch') {
    console.error(`Invalid --via=${out.via}. Use api, claude-code, or batch.`)
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
  totalCost:  {
    inputTokens:         number
    outputTokens:        number
    cacheCreationTokens: number
    cacheReadTokens:     number
  }
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

  const rawDescription = snap.rawDescription ?? (snap.body_html ?? '').replace(/<[^>]+>/g, ' ').slice(0, 2000)
  const categoriesRaw  = await db
    .select({ categories: dealHistory.categories })
    .from(dealHistory)
    .where(eq(dealHistory.sku, row.sku))
    .limit(1)
  const categories = (categoriesRaw[0]?.categories as string[] | null | undefined) ?? []

  const dealPriceRaw   = snap.metafields['xdipx.original_price']
  const msrp           = Number(dealPriceRaw) || 0

  // Decide which fields to write per scope. Phase 1 rebuild — `pairings`
  // dropped (deal-cycle now); `specs` and `ivr` added; `tags` now also
  // covers the D1 type/subtype refresh (taxonomy lives with tags).
  const want = {
    title:    args.scope === 'all' || args.scope === 'titles-only',
    keywords: args.scope === 'all' || args.scope === 'keywords-only',
    tags:     args.scope === 'all' || args.scope === 'tags-only',
    specs:    args.scope === 'all' || args.scope === 'specs-only',
    ivr:      args.scope === 'all' || args.scope === 'ivr-only',
  }

  // Phase 1 rebuild — generated-content cache. Cache key: (productId, voiceHash,
  // promptVersion). Hit + mode != 'full' skips the orchestrator entirely.
  // --mode=full (and --from-file overrides) bypass the cache.
  const brandVoice = (await getPipelineSetting('brandVoice').catch(() => null)) ?? null
  const voiceHash  = hashVoice(brandVoice)
  const productGid = `gid://shopify/Product/${row.shopifyProductId}`

  let writes: ProductWrites | null = null
  let cost = { inputTokens: 0, outputTokens: 0 }
  let cacheStatus: 'hit' | 'miss' | 'bypass' | 'pre-generated' = 'miss'

  if (preGeneratedWrites) {
    writes = preGeneratedWrites
    cacheStatus = 'pre-generated'
    // No cost — content was generated externally. Telemetry shows zero for these rows.
  } else {
    if (args.mode !== 'full') {
      // Try the cache first. Hit means same voice + same prompt version + same
      // product GID — safe to reuse without re-running the orchestrator.
      const cached = await getCachedWrites(productGid, voiceHash).catch(err => {
        console.warn(`[backfill] ${row.sku} cache lookup failed (continuing without cache):`, err instanceof Error ? err.message : err)
        return null
      })
      if (cached) {
        writes = cached.writes
        cacheStatus = 'hit'
      }
    } else {
      cacheStatus = 'bypass'
    }
  }

  if (!writes) {
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
      summary.totalCost.inputTokens         += cost.inputTokens
      summary.totalCost.outputTokens        += cost.outputTokens
      summary.totalCost.cacheCreationTokens += result.telemetry.totalCacheCreationTokens
      summary.totalCost.cacheReadTokens     += result.telemetry.totalCacheReadTokens

      // Write the cache row so subsequent backfill passes (same voiceHash +
      // promptVersion) skip the orchestrator. Best-effort: a cache write
      // failure should not unwind a successful generation.
      await setCachedWrites(productGid, voiceHash, writes, {
        model:        args.via === 'claude-code' ? 'claude-code-agent-sdk' : 'anthropic-sdk-mixed',
        inputTokens:  cost.inputTokens,
        outputTokens: cost.outputTokens,
      }).catch(err => {
        console.warn(`[backfill] ${row.sku} cache write failed (orchestrator output preserved in-memory):`, err instanceof Error ? err.message : err)
      })
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

  // Phase 2 — write the inferred multi-select category back to Shopify so it
  // matches the array shape Sanity now uses. inferCategoryFallback handles
  // legacy single-string inputs (`couples`, `both`, `him`, etc.) and returns
  // the canonical Array<'for-him' | 'for-her' | 'couples'>. Only write when
  // mode=full (don't churn existing values on incremental runs).
  if (args.mode === 'full') {
    const inferred = inferCategoryFallback(snap.metafields['xdipx.category'])
    const existing = snap.metafields['xdipx.category'] ?? ''
    const existingNormalized = existing.trim().startsWith('[') ? existing : ''
    const desiredJson = JSON.stringify(inferred)
    if (existingNormalized !== desiredJson) {
      doc.category = inferred
      fieldsChanged.push('category')
    }
  }

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

  // Phase 1 rebuild — taxonomy fields (D1 type/subtype, D2 sensation dial)
  // are gated by `want.tags` since the dial registry and ask-emma vocab live
  // with the tag refresh. The `--tags-only` scope refreshes both classifiers
  // and tags in one pass.
  if (want.tags) {
    if (writes.productTypeDial && await maybeShouldRefresh(snap, 'xdipx.product_type_dial', args)) {
      doc.productTypeDial = writes.productTypeDial
      fieldsChanged.push('product_type_dial')
    }
    // D1 hierarchical subtype — lives in custom namespace, not xdipx.
    // No fill-gaps source-of-truth metafield to compare; always write when
    // the orchestrator returned a value (null indicates ambiguous and is
    // intentionally skipped).
    if (writes.productSubtypeDial != null) {
      doc.productSubtypeDial = writes.productSubtypeDial
      fieldsChanged.push('product_subtype_dial')
    }
    if (writes.sensationDialV2 && await maybeShouldRefresh(snap, 'xdipx.sensation_dial_v2', args)) {
      doc.sensationDialV2 = writes.sensationDialV2
      fieldsChanged.push('sensation_dial_v2')
    }
    if (writes.moodTags?.length     && await maybeShouldRefresh(snap, 'xdipx.mood_tags',     args)) { doc.moodTags     = writes.moodTags;     fieldsChanged.push('mood_tags') }
    if (writes.audienceTags?.length && await maybeShouldRefresh(snap, 'xdipx.audience_tags', args)) { doc.audienceTags = writes.audienceTags; fieldsChanged.push('audience_tags') }
    if (writes.mattersTags?.length  && await maybeShouldRefresh(snap, 'xdipx.matters_tags',  args)) { doc.mattersTags  = writes.mattersTags;  fieldsChanged.push('matters_tags') }
  }

  // Phase 1 rebuild — structured PDP content (C1 box, C2 specs, C3 care)
  // gated by `want.specs`. `--specs-only` runs all three together.
  if (want.specs) {
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
  }

  // moodImageUrl is image-pipeline output (Phase 2+) — push when present
  // regardless of scope, but the orchestrator's tool list excludes the
  // image generator on import paths so writes.moodImageUrl will normally
  // be undefined.
  if (writes.moodImageUrl && await maybeShouldRefresh(snap, 'xdipx.mood_image_url', args)) {
    doc.moodImageUrl = writes.moodImageUrl
    fieldsChanged.push('mood_image_url')
  }

  if (want.keywords) {
    if (writes.tagline           && await maybeShouldRefresh(snap, 'xdipx.tagline',              args)) { doc.tagline            = writes.tagline;             fieldsChanged.push('tagline') }
    if (writes.seoMetaDescription&& await maybeShouldRefresh(snap, 'xdipx.seo_meta_description', args)) { doc.seoMetaDescription = writes.seoMetaDescription;  fieldsChanged.push('seo_meta_description') }
    // descriptionHtml — always overwrite Shopify body_html with the freshly-generated
    // Emma's take. Editorial direction: every product's main description gets
    // rewritten by the orchestrator, regardless of what was there before. Sanity
    // mirrors the same value (in upsertProductPage below), so both surfaces stay
    // in sync. Hand-edits in Shopify Admin will be clobbered on the next backfill.
    if (writes.descriptionHtml) { doc.descriptionHtml    = writes.descriptionHtml;     fieldsChanged.push('descriptionHtml') }
  }
  // NOTE: pairings (F1/F2) removed from import-time backfill in Phase 1.
  // Pairings are now deal-cycle artifacts and refresh against the freshest
  // catalog when a product enters the homepage deal slot.

  // Sanity-only fields — no Shopify metafield equivalent. These need their
  // own change tracking because fieldsChanged only counts Shopify-targetable
  // updates. Without this, a product that has all Shopify metafields filled
  // but is missing Sanity FAQs / IVR fields would be `skipped: 1` and the
  // freshly-generated content would never reach the productPage doc.
  //
  // Phase 1 rebuild — gating:
  //   FAQs (H1) flow with `want.keywords` since they share the keyword bank context.
  //   IVR fields (G1/G2/G3) flow with `want.ivr` for the new --ivr-only scope.
  const sanityOnlyChanged: string[] = []
  if (want.keywords && writes.productFaqs?.length) sanityOnlyChanged.push('productFaqs')
  if (want.ivr      && writes.ivrExperience)       sanityOnlyChanged.push('ivrExperience')
  if (want.ivr      && writes.ivrUseCase?.length)  sanityOnlyChanged.push('ivrUseCase')
  if (want.ivr      && writes.ivrFeatures?.length) sanityOnlyChanged.push('ivrFeatures')

  if (fieldsChanged.length === 0 && sanityOnlyChanged.length === 0) {
    summary.skipped++
    console.log(JSON.stringify({ handle: snap.handle, sku: row.sku, mode: args.scope, fieldsChanged: [], cost, cache: cacheStatus, promptVersion: PROMPT_VERSION, durationMs: 0 }))
    return
  }

  if (!args.apply) {
    summary.changed++  // counted as "would change" in dry-run summary
    console.log(JSON.stringify({ handle: snap.handle, sku: row.sku, mode: args.scope, dryRun: true, fieldsChanged, sanityOnlyChanged, cost, cache: cacheStatus, promptVersion: PROMPT_VERSION }))
    return
  }

  let shopifyApplied = false
  if (fieldsChanged.length > 0) {
    try {
      if (!doc.tagline)            doc.tagline            = snap.metafields['xdipx.tagline']
      if (!doc.seoMetaDescription) doc.seoMetaDescription = snap.metafields['xdipx.seo_meta_description']
      // specifications backfill — preserve existing JSON-stringified array OR
      // attempt to parse legacy HTML/plain content into bullets. When neither
      // works the field is left empty and the PDP shows the fallback message.
      if (!doc.specifications) {
        const raw = snap.metafields['xdipx.specifications']
        if (raw?.trim().startsWith('[')) {
          try {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) doc.specifications = parsed.filter((s): s is string => typeof s === 'string')
          } catch { /* ignore — leave empty */ }
        }
      }

      await pushProductToShopify(doc)
      shopifyApplied = true
    } catch (err) {
      summary.errors.push({ sku: row.sku, message: `pushProductToShopify: ${err instanceof Error ? err.message : err}` })
      return
    }
  }

  // --skip-sanity short-circuit: phase-1 testing path where the Sanity admin
  // migrations (dial registry, askEmmaVocabulary Title Case, etc.) haven't
  // been done yet. Skip the productPage upsert entirely so Shopify-only state
  // can be inspected without touching Sanity.
  if (args.skipSanity) {
    if (shopifyApplied) {
      summary.changed++
      console.log(JSON.stringify({
        handle: snap.handle,
        sku:    row.sku,
        mode:   args.scope,
        applied: true,
        shopifyApplied,
        sanitySkipped: true,
        fieldsChanged,
        sanityOnlyChanged,
        cost,
      }))
    } else {
      summary.skipped++
    }
    return
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
      category: inferCategoryFallback(snap.metafields['xdipx.category']),
    }
    // Title — only overwrite when augmented (matches Shopify-side condition).
    if (doc.title !== undefined) upsertParams.title = doc.title
    if (doc.tagline)             upsertParams.tagline        = doc.tagline
    if (doc.seoTitle)            upsertParams.seoTitle       = doc.seoTitle
    if (doc.seoMetaDescription)  upsertParams.seoDescription = doc.seoMetaDescription
    if (want.keywords && writes.descriptionHtml)  upsertParams.description    = writes.descriptionHtml
    if (want.tags     && writes.productTypeDial)  upsertParams.productTypeDial = writes.productTypeDial
    if (want.tags     && writes.productSubtypeDial != null) upsertParams.productSubtypeDial = writes.productSubtypeDial
    if (want.tags     && writes.sensationDialV2)      upsertParams.sensationDialV2 = writes.sensationDialV2
    if (want.tags     && writes.moodTags?.length)     upsertParams.moodTags     = writes.moodTags
    if (want.tags     && writes.audienceTags?.length) upsertParams.audienceTags = writes.audienceTags
    if (want.tags     && writes.mattersTags?.length)  upsertParams.mattersTags  = writes.mattersTags
    if (want.specs    && writes.specifications)       upsertParams.specifications   = writes.specifications
    if (want.specs    && writes.careInstructions?.length) upsertParams.careInstructions = writes.careInstructions
    if (want.specs    && writes.boxContents?.length)  upsertParams.boxContents  = writes.boxContents
    if (want.ivr      && writes.ivrExperience)        upsertParams.ivrExperience = writes.ivrExperience
    if (want.ivr      && writes.ivrUseCase?.length)   upsertParams.ivrUseCase    = writes.ivrUseCase
    if (want.ivr      && writes.ivrFeatures?.length)  upsertParams.ivrFeatures   = writes.ivrFeatures
    if (want.keywords && writes.productFaqs?.length)  upsertParams.productFaqs   = writes.productFaqs
    if (writes.originalTitle)        upsertParams.originalTitle = writes.originalTitle
    if (writes.moodImageUrl)         upsertParams.moodImageUrl  = writes.moodImageUrl

    // Pricing fields (originalPrice / mapPrice) removed from Sanity productPage
    // schema — they live solely on Shopify metafields where the deal pipeline
    // and PDP loader read them. No Sanity sync needed.

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

function inferCategoryFallback(stored: string | undefined): Array<'for-him' | 'for-her' | 'couples'> {
  if (!stored) return ['for-him', 'for-her']
  // Phase 2 — Shopify metafield is now JSON-stringified array. Legacy values
  // are single strings (handle for-him/for-her/couples + 'both' → split).
  if (stored.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) {
        const valid = new Set(['for-him', 'for-her', 'couples'])
        return parsed.filter((s): s is 'for-him' | 'for-her' | 'couples' => typeof s === 'string' && valid.has(s))
      }
    } catch { /* fall through */ }
  }
  if (stored === 'both')    return ['for-him', 'for-her']
  if (stored === 'for-him' || stored === 'for-her' || stored === 'couples') return [stored]
  return ['for-him', 'for-her']
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

// ─── Batch API path (--via=batch) ────────────────────────────────────────────
//
// Refreshes Emma's Take across the matched products via Anthropic's Batch API
// (50% off both input and output tokens, async — typically completes within
// minutes for batches under ~50 requests, up to 24h for larger jobs). This is
// the cheapest way to do a catalog-wide voice refresh after a brand-voice
// change in /admin/settings.
//
// Scope: this MVP wires the heaviest single generator (Emma's Take, Sonnet,
// 600–800 output tokens) through batch. The other per-tool generators stay on
// the sync path. As the Nalpac automation matures, additional generators
// (FAQs, copy bundle, dial) can extend `runBatchEmmaTake` in
// app/lib/batch-enrichment.server.ts.
async function runBatchVoiceRefresh(args: Args, summary: BackfillSummary) {
  const rows = await listProducts(args)
  console.log(`[batch] ${rows.length} product(s) matched for batch Emma's Take refresh`)
  if (rows.length === 0) return

  const estimatedSavings = rows.length * 0.05  // ~$0.05/product savings on the Sonnet generator at 50% off
  console.log(`[cost-est] route: Anthropic Batch API (50% discount, async, results within 24h — usually minutes)`)
  console.log(`[cost-est] estimated savings vs. sync: ~${formatUsd(estimatedSavings)} for ${rows.length} products on Emma's Take alone`)
  console.log(`[cost-est] other generators (tagline / SEO meta / specs / dial / IVR / FAQs / care / box) still run on the sync API path when needed.`)
  if (!args.apply) {
    console.log(`[cost-est] dry-run: building batch payloads but skipping submission. Re-run with --apply to submit.`)
  }

  // Build batch inputs from each product's current Shopify metafields. The
  // batch generator only needs voice-relevant fields, so we pull a thin
  // snapshot rather than the full product context.
  const inputs: BatchEmmaTakeInput[] = []
  const skuByProductId = new Map<string, string>()
  for (const row of rows) {
    const numericId = row.shopifyProductId.split('/').pop()
    if (!numericId) {
      summary.errors.push({ sku: row.sku, message: 'invalid Shopify product ID' })
      continue
    }
    const snap = await fetchProductSnapshot(numericId)
    if (!snap) {
      summary.errors.push({ sku: row.sku, message: 'snapshot fetch failed' })
      continue
    }
    inputs.push({
      productId: row.shopifyProductId,
      deal: {
        seoTitle:        snap.title,
        brand:           snap.vendor,
        category:        snap.product_type ? [snap.product_type] : [],
        ...(snap.metafields['xdipx.tagline']           ? { tagline:    snap.metafields['xdipx.tagline'] }       : {}),
        ...(snap.metafields['custom.original_description'] ? { fullStory: snap.metafields['custom.original_description'] } : { fullStory: snap.body_html }),
        ...(snap.metafields['xdipx.product_type_dial'] ? { productTypeDial: snap.metafields['xdipx.product_type_dial'] as never } : {}),
      },
    })
    skuByProductId.set(row.shopifyProductId, row.sku)
  }

  if (inputs.length === 0) {
    console.log('[batch] no valid products to submit')
    return
  }

  if (!args.apply) {
    console.log(`[batch] dry-run: would submit ${inputs.length} requests`)
    summary.processed = inputs.length
    summary.skipped   = inputs.length
    return
  }

  const brandVoice = await getPipelineSetting('brandVoice')
  const result = await runBatchEmmaTake(inputs, {
    ...(brandVoice ? { brandVoice } : {}),
  })
  console.log(`[batch] batch ${result.meta.batchId} done: succeeded=${result.meta.succeededCount} errored=${result.meta.erroredCount} duration=${(result.meta.durationMs / 1000).toFixed(1)}s`)

  for (const failure of result.failures) {
    const sku = skuByProductId.get(failure.productId) ?? failure.productId
    summary.errors.push({ sku, message: failure.error })
  }

  // Push each successful result back to Shopify body_html. Sanity sync stays
  // out of scope for this MVP — admins typically re-sync via the existing
  // sync-sanity admin button after a voice refresh, since several Sanity
  // fields beyond descriptionHtml may also need refresh.
  for (const [productId, descriptionHtml] of result.results) {
    summary.processed++
    const sku = skuByProductId.get(productId) ?? productId
    try {
      const numericId = productId.split('/').pop()
      if (!numericId) throw new Error('invalid product ID')
      await shopifyAdmin(`/products/${numericId}.json`, 'PUT', {
        product: { id: Number(numericId), body_html: descriptionHtml },
      })
      summary.changed++
      summary.totalCost.outputTokens += descriptionHtml.length / 4  // rough char→token approximation
      console.log(`  ✓ ${sku}: descriptionHtml len=${descriptionHtml.length}`)
    } catch (err) {
      summary.errors.push({ sku, message: err instanceof Error ? err.message : String(err) })
    }
  }
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
    totalCost: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
  }

  console.log(`Backfill: scope=${args.scope} mode=${args.mode} via=${args.via} dryRun=${!args.apply}${args.fromFile ? ` fromFile=${args.fromFile}` : ''}`)

  if (args.scope === 'archive-discontinued') {
    await runArchiveDiscontinued(args, summary)
  } else if (args.fromFile) {
    await runFromFile(args, summary)
  } else if (args.via === 'batch') {
    await runBatchVoiceRefresh(args, summary)
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
    if (summary.totalCost.cacheCreationTokens > 0 || summary.totalCost.cacheReadTokens > 0) {
      const totalCacheable = summary.totalCost.cacheCreationTokens + summary.totalCost.cacheReadTokens
      const hitRate = totalCacheable > 0
        ? ((summary.totalCost.cacheReadTokens / totalCacheable) * 100).toFixed(1)
        : '0.0'
      console.log(`  cache:     creation=${summary.totalCost.cacheCreationTokens} read=${summary.totalCost.cacheReadTokens} hit-rate=${hitRate}%`)
    }
    // Actual $ figure assuming Sonnet pricing ($3/M input + $15/M output) for
    // the per-tool side. Underestimates slightly — Haiku-tier tools are
    // included in the input/output totals but priced cheaper. Treat as upper
    // bound on the API-key spend. Cache reads are billed at 10% of input price,
    // cache writes at 1.25× — so we adjust the input figure for both.
    const fullPriceInputTokens = summary.totalCost.inputTokens - summary.totalCost.cacheReadTokens
    const inUsd  = ((fullPriceInputTokens + summary.totalCost.cacheCreationTokens * 1.25) / 1_000_000) * 3
    const cacheReadUsd = (summary.totalCost.cacheReadTokens / 1_000_000) * 3 * 0.1
    const outUsd = (summary.totalCost.outputTokens / 1_000_000) * 15
    console.log(`  cost:      ~${formatUsd(inUsd + cacheReadUsd + outUsd)} (Sonnet upper-bound, accounts for cache pricing; Haiku tools are billed less)`)
    if (summary.processed > 0) {
      console.log(`  per-prod:  ~${formatUsd((inUsd + cacheReadUsd + outUsd) / summary.processed)} / product`)
    }
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
