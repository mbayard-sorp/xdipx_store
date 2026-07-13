/**
 * Post-import enrichment + publish lifecycle.
 *
 * Auto-import (Phase 2) and manual approve produce a bare, unpublished Shopify
 * DRAFT. This module drives the rest of the flow:
 *
 *   import -> enrich (Anthropic Batch API, 50% off) -> publish (draft -> active)
 *
 * Vercel functions cap at 60s, so enrichment is split across cron ticks:
 *   - submitEnrichmentBatch:  find unenriched imports, submit one Batch, persist
 *                             the batch id (no poll).
 *   - collectEnrichmentBatch: on a later tick, retrieve finished batches, write
 *                             the generated content back to Shopify + Sanity,
 *                             stamp enriched_at.
 *   - publishEnrichedProducts: flip enriched drafts to active on curated channels.
 *
 * runImportEnrichTick orchestrates all three and is what the cron calls. It is
 * gated by the `import_enrich_enabled` pipeline setting (default off).
 *
 * Cost: enrichment is the only AI spend here and runs through the Batch API.
 * Selection + publish are deterministic and LLM-free.
 */

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { importCandidates, dealHistory, batchJobs } from '../../db/schema'
import {
  fetchProductSnapshot,
  gatherProductBrief,
} from '~/lib/enricher-brief.server'
import {
  enqueueBatchJob,
} from '~/lib/batch-orchestrator.server'
import {
  activateShopifyProduct,
  pushProductToShopify,
  type ProductPageDoc,
} from '~/lib/shopify.server'
import { upsertProductPage } from '~/lib/sanity.server'
import { getPipelineSetting, deriveSection } from '~/lib/feed-processor.server'
import { IVR_EXPERIENCE_LEVELS } from '~/lib/claude.server'
import type { OrchestratorInput, OrchestratorProductInput, ProductWrites } from '~/lib/emma-orchestrator.server'
import type { PairingCandidate } from '~/lib/shopify.server'

const VALID_IVR_EXPERIENCE = new Set<string>(IVR_EXPERIENCE_LEVELS as readonly string[])

/**
 * The batch enricher sometimes emits ivrExperience as a bare string (e.g. "any")
 * rather than the schema-required array of enum values. Coerce to an array and
 * drop anything outside the allowed set so Sanity does not get an invalid value.
 */
function normalizeIvrExperience(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
  return arr.filter((v): v is string => typeof v === 'string' && VALID_IVR_EXPERIENCE.has(v))
}

const DEFAULT_BATCH_CAP = 10

async function isEnrichEnabled(): Promise<boolean> {
  return (await getPipelineSetting('import_enrich_enabled')) === 'true'
}

async function getBatchCap(): Promise<number> {
  const raw = await getPipelineSetting('import_enrich_batch_cap')
  const n = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BATCH_CAP
}

/** Legacy single-string category values → the canonical multi-select array. */
function inferCategoryFallback(stored: string | undefined): Array<'for-him' | 'for-her' | 'couples'> {
  if (!stored) return ['for-him', 'for-her']
  if (stored.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) {
        const valid = new Set(['for-him', 'for-her', 'couples'])
        return parsed.filter((s): s is 'for-him' | 'for-her' | 'couples' => typeof s === 'string' && valid.has(s))
      }
    } catch { /* fall through */ }
  }
  if (stored === 'both') return ['for-him', 'for-her']
  if (stored === 'for-him' || stored === 'for-her' || stored === 'couples') return [stored]
  return ['for-him', 'for-her']
}

/**
 * Enforce the no-em-dash house rule on generated copy. Em-dashes become a
 * comma separator; en-dashes (used in ranges) become a hyphen. Existing hyphens
 * in compounds are untouched.
 */
function stripDashes(s: string): string {
  return s.replace(/\s*—\s*/g, ', ').replace(/\s*–\s*/g, '-')
}
const ed  = (s: string | undefined): string | undefined => (s == null ? s : stripDashes(s))
const edA = (a: readonly string[] | undefined): string[] | undefined => a?.map(stripDashes)

/**
 * Write a freshly-generated ProductWrites payload back to Shopify (metafields +
 * body_html) and mirror to the Sanity productPage. Unlike the backfill script's
 * fill-gaps path, this always writes every field the orchestrator produced —
 * these are bare drafts, so there is nothing to preserve.
 *
 * Mirrors the field mapping in scripts/backfill-product-enrichment.ts. Pairings
 * are intentionally skipped at import time (deal-cycle artifacts). The Sanity
 * mirror is best-effort: a Sanity failure does not unwind the Shopify write.
 */
export async function applyFullEnrichmentWrites(numericProductId: string, writes: ProductWrites): Promise<void> {
  const snap = await fetchProductSnapshot(numericProductId)
  if (!snap) throw new Error(`fetchProductSnapshot returned null for ${numericProductId}`)

  const category = inferCategoryFallback(snap.metafields['xdipx.category'])

  // Editorial sub-category tags from the Nalpac feed. The raw auto-import path
  // does not write these to Sanity, so propagate them here. "(uncategorized)" is
  // the master-collapse sentinel for a blank Sub-Category — never a real tag.
  const histRows = await db
    .select({ categories: dealHistory.categories })
    .from(dealHistory)
    .where(eq(dealHistory.shopifyProductId, numericProductId))
    .limit(1)
  const editorialTags = (histRows[0]?.categories ?? []).filter(
    (c): c is string => !!c && c !== '(uncategorized)',
  )

  // Em-dash-sanitized copy (house rule) — computed once, used for Shopify + Sanity.
  const sTagline = ed(writes.tagline)
  const sSeo     = ed(writes.seoMetaDescription)
  const sDesc    = ed(writes.descriptionHtml)
  const sSpecs   = edA(writes.specifications)
  const sCare    = edA(writes.careInstructions)
  const sBox     = edA(writes.boxContents)

  // Deterministic top-level menu section (exactly one).
  const section = deriveSection({
    productType:     snap.product_type,
    title:           snap.title,
    productTypeDial: writes.productTypeDial,
  })

  const doc: ProductPageDoc = {
    shopifyProductId:  numericProductId,
    category,
    sectionTags:        [section],
    tagline:            sTagline,
    seoMetaDescription: sSeo,
    descriptionHtml:    sDesc,
    moodTags:           writes.moodTags,
    audienceTags:       writes.audienceTags,
    mattersTags:        writes.mattersTags,
    productTypeDial:    writes.productTypeDial,
  }
  // Augmented display title — only override product.title when the orchestrator
  // decided the manufacturer's title needed an SEO descriptor appended.
  if (writes.productTitleAugmented && writes.productTitle) {
    doc.title    = ed(writes.productTitle)
    doc.seoTitle = ed(writes.productTitle)
  }
  if (writes.originalTitle)          doc.originalTitle       = ed(writes.originalTitle)
  if (writes.productSubtypeDial != null) doc.productSubtypeDial = writes.productSubtypeDial
  if (writes.sensationDialV2)        doc.sensationDialV2     = writes.sensationDialV2
  if (sSpecs?.length)                doc.specifications      = sSpecs
  if (sCare?.length)                 doc.careInstructions    = sCare
  if (sBox?.length)                  doc.boxContents         = sBox
  if (writes.emmaHero)               doc.emmaHero            = writes.emmaHero
  if (writes.moodImageUrl)           doc.moodImageUrl        = writes.moodImageUrl

  await pushProductToShopify(doc)

  // Mirror to the Sanity productPage so search index, voice/IVR surfaces, and
  // the keyword-bank projection don't lag. Best-effort with one retry.
  try {
    const gid = `gid://shopify/Product/${numericProductId}`
    const upsertParams: Parameters<typeof upsertProductPage>[0] = {
      handle:   snap.handle,
      shopifyProductId: gid,
      title:    doc.title ?? snap.title,
      vendor:   snap.vendor,
      category,
      tagline:        sTagline,
      description:    sDesc,
      seoDescription: sSeo,
      productTypeDial: writes.productTypeDial,
      moodTags:       writes.moodTags,
      audienceTags:   writes.audienceTags,
      mattersTags:    writes.mattersTags,
    }
    if (editorialTags.length)               upsertParams.tags              = editorialTags
    if (doc.seoTitle)                       upsertParams.seoTitle          = doc.seoTitle
    if (writes.productSubtypeDial != null)  upsertParams.productSubtypeDial = writes.productSubtypeDial
    if (writes.sensationDialV2)             upsertParams.sensationDialV2   = writes.sensationDialV2
    if (sSpecs?.length)                     upsertParams.specifications    = sSpecs
    if (sCare?.length)                      upsertParams.careInstructions  = sCare
    if (sBox?.length)                       upsertParams.boxContents       = sBox
    const ivrExperience = normalizeIvrExperience(writes.ivrExperience)
    if (ivrExperience.length)               upsertParams.ivrExperience     = ivrExperience
    if (writes.ivrUseCase?.length)          upsertParams.ivrUseCase        = writes.ivrUseCase
    if (writes.ivrFeatures?.length)         upsertParams.ivrFeatures       = writes.ivrFeatures
    if (writes.productFaqs?.length)         upsertParams.productFaqs       = writes.productFaqs
    if (writes.originalTitle)               upsertParams.originalTitle     = writes.originalTitle
    if (writes.moodImageUrl)                upsertParams.moodImageUrl      = writes.moodImageUrl
    const firstImage = snap.images[0]?.src
    if (firstImage) upsertParams.imageUrl = firstImage

    let lastErr: unknown
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await upsertProductPage(upsertParams)
        lastErr = null
        break
      } catch (err) {
        lastErr = err
        if (attempt === 1) await new Promise(r => setTimeout(r, 500))
      }
    }
    if (lastErr) {
      console.error(`[import-enrich] sanity upsert failed for ${numericProductId}:`, lastErr)
    }
  } catch (err) {
    console.error(`[import-enrich] sanity mirror error for ${numericProductId}:`, err)
  }
}

/**
 * Find imported-but-unenriched products and enqueue ONE batch_jobs row via the
 * new orchestrator. Stamps each candidate's enrich_batch_id with the jobId so
 * collectEnrichmentBatch can poll the batch_jobs table on a later tick.
 * Does NOT submit an Anthropic batch directly -- the enrichment-batch-poller
 * cron (every 2 min) drives all batch work through advanceInflightJobs().
 */
export async function submitEnrichmentBatch(cap: number): Promise<{ submitted: number; batchId?: string; reason?: string }> {
  const rows = await db
    .select({ id: importCandidates.id, productId: dealHistory.shopifyProductId, sku: importCandidates.masterKey })
    .from(importCandidates)
    .innerJoin(dealHistory, eq(importCandidates.dealHistoryId, dealHistory.id))
    .where(and(
      eq(importCandidates.status, 'imported'),
      isNull(importCandidates.enrichedAt),
      isNull(importCandidates.enrichBatchId),
    ))
    .orderBy(asc(importCandidates.id))
    .limit(cap)

  const valid = rows.filter((r): r is { id: number; productId: string; sku: string } => Boolean(r.productId))
  if (valid.length === 0) return { submitted: 0, reason: 'no_unenriched' }

  const products: Array<{ productId: string; sku: string; input: OrchestratorInput }> = []
  const candidateIds: number[] = []

  for (const r of valid) {
    const brief = await gatherProductBrief(r.productId)
    if (!brief) {
      console.warn(`[import-enrich] no brief for product ${r.productId} (candidate ${r.id}) -- skipping`)
      continue
    }
    const sku = brief.sku ?? r.sku

    // Map ProductBrief fields to the OrchestratorInput shape.
    const product: OrchestratorProductInput = {
      title:       brief.rawTitle,
      brand:       brief.brand,
      description: brief.rawDescription,
      categories:  brief.categories,
      dealPrice:   brief.dealPrice,
      msrp:        brief.msrp,
    }
    // Derive category from the brief's categories array using the same
    // coercion logic as inferCategoryFallback.
    const validCategoryValues = new Set<string>(['for-him', 'for-her', 'couples'])
    const category = brief.categories.filter(
      (c): c is 'for-him' | 'for-her' | 'couples' => validCategoryValues.has(c),
    )
    const effectiveCategory: Array<'for-him' | 'for-her' | 'couples'> =
      category.length > 0 ? category : ['for-him', 'for-her']

    // Map brief pairing candidates to PairingCandidate. Entries without a
    // numeric price are dropped since PairingCandidate.price is required.
    // handle is derived from productId (numeric suffix) as a fallback.
    const pairingCandidates: PairingCandidate[] = brief.pairingCandidates
      .filter((pc): pc is typeof pc & { price: number } => typeof pc.price === 'number')
      .map(pc => {
        const candidate: PairingCandidate = {
          productId: pc.productId,
          handle:    pc.productId.replace('gid://shopify/Product/', ''),
          title:     pc.title,
          price:     pc.price,
        }
        if (pc.brand)           candidate.brand           = pc.brand
        if (pc.productTypeDial) candidate.productTypeDial = pc.productTypeDial
        return candidate
      })

    // Build OrchestratorInput. exactOptionalPropertyTypes: omit pairingCandidates
    // entirely when the list is empty rather than setting it to undefined.
    const input: OrchestratorInput = pairingCandidates.length > 0
      ? {
          product,
          // Use rawTitle as seoTitle; the orchestrator's generateProductTitle tool
          // will augment it if needed (same as the bulk-import path).
          seoTitle:          brief.rawTitle,
          category:          effectiveCategory,
          pairingCandidates,
        }
      : {
          product,
          seoTitle:  brief.rawTitle,
          category:  effectiveCategory,
        }
    products.push({ productId: `gid://shopify/Product/${r.productId}`, sku, input })
    candidateIds.push(r.id)
  }
  if (products.length === 0) return { submitted: 0, reason: 'no_briefs' }

  const { jobId } = await enqueueBatchJob({
    jobType: 'full-enrichment',
    source:  'import-product',
    products,
  })

  // Reuse enrich_batch_id column to store the orchestrator jobId so
  // collectEnrichmentBatch can look up the batch_jobs row by jobId.
  await db.update(importCandidates)
    .set({ enrichBatchId: jobId, updatedAt: new Date() })
    .where(inArray(importCandidates.id, candidateIds))

  console.log(`[import-enrich] enqueued orchestrator job ${jobId} for ${products.length} product(s)`)
  return { submitted: products.length, batchId: jobId }
}

/**
 * Poll batch_jobs for orchestrator jobs enqueued by submitEnrichmentBatch.
 * The orchestrator's applying phase already called applyFullEnrichmentWrites
 * for each product -- this function only stamps enriched_at on candidates
 * whose jobs have reached a terminal state (done or failed).
 *
 * Still-in-flight jobs (queued/submitted/processing/applying) are left for
 * the next tick. The enrichment-batch-poller cron (every 2 min) advances them.
 */
export async function collectEnrichmentBatch(): Promise<{ enriched: number; failed: number; stillPending: number }> {
  // Find candidates that have an enrich_batch_id (orchestrator jobId)
  // but are not yet stamped enriched.
  const pendingCandidates = await db
    .select({
      id:    importCandidates.id,
      jobId: importCandidates.enrichBatchId,
    })
    .from(importCandidates)
    .where(and(
      eq(importCandidates.status, 'imported'),
      isNull(importCandidates.enrichedAt),
      sql`${importCandidates.enrichBatchId} IS NOT NULL`,
    ))
    .orderBy(asc(importCandidates.id))

  if (pendingCandidates.length === 0) {
    return { enriched: 0, failed: 0, stillPending: 0 }
  }

  // Collect unique jobIds and fetch matching batch_jobs rows in one query.
  const jobIds = [...new Set(pendingCandidates.map(c => c.jobId as string))]
  const jobRows = await db
    .select({ jobId: batchJobs.jobId, status: batchJobs.status })
    .from(batchJobs)
    .where(inArray(batchJobs.jobId, jobIds))

  const jobStatus = new Map(jobRows.map(r => [r.jobId, r.status]))

  let enrichedTotal = 0
  let failedTotal   = 0
  let stillPending  = 0

  for (const candidate of pendingCandidates) {
    const jobId = candidate.jobId as string
    const status = jobStatus.get(jobId)

    if (
      !status ||
      status === 'queued' ||
      status === 'submitted' ||
      status === 'processing' ||
      status === 'applying'
    ) {
      // Still in flight -- poller will advance it. Retry next tick.
      stillPending++
      continue
    }

    // Terminal: done or failed. Writes were already applied by the orchestrator's
    // applying phase. Stamp enriched_at so publishEnrichedProducts can proceed.
    if (status === 'done') {
      await db.update(importCandidates)
        .set({ enrichedAt: new Date(), updatedAt: new Date() })
        .where(eq(importCandidates.id, candidate.id))
      enrichedTotal++
      console.log(`[import-enrich] candidate ${candidate.id} job ${jobId} done -- stamped enriched_at`)
    } else {
      // status === 'failed': enrichment did not complete cleanly. Stamp enriched_at
      // anyway so this candidate does not block the queue indefinitely -- the
      // orchestrator may have applied partial writes. Log for ops visibility.
      await db.update(importCandidates)
        .set({ enrichedAt: new Date(), updatedAt: new Date() })
        .where(eq(importCandidates.id, candidate.id))
      failedTotal++
      console.warn(
        `[import-enrich] candidate ${candidate.id} job ${jobId} failed -- stamping enriched_at to unblock queue (partial writes may apply)`,
      )
    }
  }

  return { enriched: enrichedTotal, failed: failedTotal, stillPending }
}

/**
 * Flip enriched-but-unpublished imported drafts to active on the curated
 * channels (POS excluded — handled inside activateShopifyProduct). Products are
 * priced at import time, so enriched is the only gate. Best-effort per product.
 */
export async function publishEnrichedProducts(): Promise<{ published: number; failed: number }> {
  const rows = await db
    .select({ id: importCandidates.id, productId: dealHistory.shopifyProductId })
    .from(importCandidates)
    .innerJoin(dealHistory, eq(importCandidates.dealHistoryId, dealHistory.id))
    .where(and(
      eq(importCandidates.status, 'imported'),
      sql`${importCandidates.enrichedAt} IS NOT NULL`,
      isNull(importCandidates.publishedAt),
    ))

  let published = 0
  let failed = 0
  for (const r of rows) {
    if (!r.productId) continue
    try {
      await activateShopifyProduct(r.productId)
      await db.update(importCandidates)
        .set({ publishedAt: new Date(), updatedAt: new Date() })
        .where(eq(importCandidates.id, r.id))
      published++
    } catch (err) {
      console.error(`[import-enrich] publish failed for product ${r.productId} (candidate ${r.id}):`, err)
      failed++
    }
  }

  // Newly-active products auto-join their nav collection (smart collections keyed
  // on custom.section_tags, written at import), but the discovery index is KV/Neon
  // cached. Bust + rebuild once per publish batch (never per product) so new
  // arrivals surface in discovery rails / search near-immediately instead of
  // waiting for the next unconditional /cron/warm rebuild (<=15 min).
  if (published > 0) {
    try {
      const { invalidateDiscoveryIndex, triggerDiscoveryRebuild } = await import('~/lib/discovery.server')
      await invalidateDiscoveryIndex()
      triggerDiscoveryRebuild()
    } catch (err) {
      console.warn('[import-enrich] discovery index refresh after publish failed (will self-heal on next /cron/warm):', err)
    }
  }

  return { published, failed }
}

export interface ImportEnrichTickResult {
  ok:       boolean
  skipped?: boolean
  reason?:  string
  collect?: Awaited<ReturnType<typeof collectEnrichmentBatch>>
  publish?: Awaited<ReturnType<typeof publishEnrichedProducts>>
  submit?:  Awaited<ReturnType<typeof submitEnrichmentBatch>>
}

/**
 * One self-draining tick: collect finished batches, publish ready products,
 * then submit a new batch only if none is still in flight (avoids stacking
 * concurrent batches). Gated by `import_enrich_enabled`.
 */
export async function runImportEnrichTick(opts: { source?: 'cron' | 'manual' } = {}): Promise<ImportEnrichTickResult> {
  if (!(await isEnrichEnabled())) {
    return { ok: true, skipped: true, reason: 'disabled' }
  }
  void opts

  const collect = await collectEnrichmentBatch()
  const publish = await publishEnrichedProducts()

  let submit: Awaited<ReturnType<typeof submitEnrichmentBatch>> = { submitted: 0, reason: 'batch_in_flight' }
  // Gate: only enqueue a new job when no import-product jobs are still in flight.
  // This avoids stacking concurrent orchestrator jobs for the same source.
  const inflightRow = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(batchJobs)
    .where(and(
      eq(batchJobs.source, 'import-product'),
      inArray(batchJobs.status, ['queued', 'submitted', 'processing', 'applying']),
    ))
  const inflightCount = Number(inflightRow[0]?.c ?? 0)
  if (inflightCount === 0) {
    submit = await submitEnrichmentBatch(await getBatchCap())
  }

  return { ok: true, collect, publish, submit }
}
