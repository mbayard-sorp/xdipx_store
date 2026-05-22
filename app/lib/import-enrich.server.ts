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
import { importCandidates, dealHistory, enrichmentBatches } from '../../db/schema'
import {
  fetchProductSnapshot,
  gatherProductBrief,
  loadSharedEnrichmentContext,
} from '~/lib/enricher-brief.server'
import {
  submitFullEnrichmentBatch,
  collectFullEnrichmentBatch,
  type BatchFullEnrichmentInput,
} from '~/lib/batch-enrichment.server'
import {
  activateShopifyProduct,
  pushProductToShopify,
  type ProductPageDoc,
} from '~/lib/shopify.server'
import { upsertProductPage } from '~/lib/sanity.server'
import { getPipelineSetting, deriveSection } from '~/lib/feed-processor.server'
import type { ProductWrites } from '~/lib/emma-orchestrator.server'

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
async function applyFullEnrichmentWrites(numericProductId: string, writes: ProductWrites): Promise<void> {
  const snap = await fetchProductSnapshot(numericProductId)
  if (!snap) throw new Error(`fetchProductSnapshot returned null for ${numericProductId}`)

  const category = inferCategoryFallback(snap.metafields['xdipx.category'])

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
    if (doc.seoTitle)                       upsertParams.seoTitle          = doc.seoTitle
    if (writes.productSubtypeDial != null)  upsertParams.productSubtypeDial = writes.productSubtypeDial
    if (writes.sensationDialV2)             upsertParams.sensationDialV2   = writes.sensationDialV2
    if (sSpecs?.length)                     upsertParams.specifications    = sSpecs
    if (sCare?.length)                      upsertParams.careInstructions  = sCare
    if (sBox?.length)                       upsertParams.boxContents       = sBox
    if (writes.ivrExperience)               upsertParams.ivrExperience     = writes.ivrExperience
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
 * Find imported-but-unenriched products and submit ONE Anthropic batch for
 * them. Stamps each candidate's enrich_batch_id and records the batch row so a
 * later tick can collect it. Does not poll.
 */
export async function submitEnrichmentBatch(cap: number): Promise<{ submitted: number; batchId?: string; reason?: string }> {
  const rows = await db
    .select({ id: importCandidates.id, productId: dealHistory.shopifyProductId })
    .from(importCandidates)
    .innerJoin(dealHistory, eq(importCandidates.dealHistoryId, dealHistory.id))
    .where(and(
      eq(importCandidates.status, 'imported'),
      isNull(importCandidates.enrichedAt),
      isNull(importCandidates.enrichBatchId),
    ))
    .orderBy(asc(importCandidates.id))
    .limit(cap)

  const valid = rows.filter((r): r is { id: number; productId: string } => Boolean(r.productId))
  if (valid.length === 0) return { submitted: 0, reason: 'no_unenriched' }

  const context = await loadSharedEnrichmentContext()
  const inputs: BatchFullEnrichmentInput[] = []
  const candidateIds: number[] = []
  for (const r of valid) {
    const brief = await gatherProductBrief(r.productId)
    if (!brief) {
      console.warn(`[import-enrich] no brief for product ${r.productId} (candidate ${r.id}) — skipping`)
      continue
    }
    inputs.push({ productId: r.productId, brief })
    candidateIds.push(r.id)
  }
  if (inputs.length === 0) return { submitted: 0, reason: 'no_briefs' }

  const brandVoice = (await getPipelineSetting('brandVoice').catch(() => null)) ?? undefined
  const { batchId, productIds } = await submitFullEnrichmentBatch(
    inputs,
    context,
    brandVoice ? { brandVoice } : {},
  )

  await db.insert(enrichmentBatches).values({ batchId, status: 'pending', candidateIds, productIds })
  await db.update(importCandidates)
    .set({ enrichBatchId: batchId, updatedAt: new Date() })
    .where(inArray(importCandidates.id, candidateIds))

  console.log(`[import-enrich] submitted batch ${batchId} for ${inputs.length} product(s)`)
  return { submitted: inputs.length, batchId }
}

/**
 * Retrieve every pending batch. For each that has finished, write the generated
 * content back and stamp enriched_at; leave still-processing batches pending.
 */
export async function collectEnrichmentBatch(): Promise<{ enriched: number; failed: number; stillPending: number }> {
  const pendingBatches = await db
    .select()
    .from(enrichmentBatches)
    .where(eq(enrichmentBatches.status, 'pending'))
    .orderBy(asc(enrichmentBatches.submittedAt))

  let enrichedTotal = 0
  let failedTotal = 0
  let stillPending = 0

  for (const batch of pendingBatches) {
    let res: Awaited<ReturnType<typeof collectFullEnrichmentBatch>>
    try {
      res = await collectFullEnrichmentBatch(batch.batchId)
    } catch (err) {
      // Transient retrieve failure — leave pending, retry next tick.
      console.error(`[import-enrich] collect retrieve failed for batch ${batch.batchId}:`, err)
      stillPending++
      continue
    }

    if (!res.ended) {
      stillPending++
      continue
    }

    const idByProduct = new Map<string, number>()
    batch.productIds.forEach((p, i) => {
      const cid = batch.candidateIds[i]
      if (cid !== undefined) idByProduct.set(p, cid)
    })

    const failures = [...res.failures]
    let enriched = 0
    for (const [productId, writes] of res.results) {
      try {
        await applyFullEnrichmentWrites(productId, writes)
        const candidateId = idByProduct.get(productId)
        if (candidateId !== undefined) {
          await db.update(importCandidates)
            .set({ enrichedAt: new Date(), updatedAt: new Date() })
            .where(eq(importCandidates.id, candidateId))
        }
        enriched++
      } catch (err) {
        failures.push({ productId, error: `apply: ${err instanceof Error ? err.message : String(err)}` })
      }
    }

    await db.update(enrichmentBatches)
      .set({
        status:      'collected',
        collectedAt: new Date(),
        succeeded:   enriched,
        failed:      failures.length,
        error:       failures.length ? JSON.stringify(failures).slice(0, 4000) : null,
      })
      .where(eq(enrichmentBatches.id, batch.id))

    if (failures.length) {
      console.error(`[import-enrich] batch ${batch.batchId} collected with ${failures.length} failure(s):`, failures)
    }
    console.log(`[import-enrich] batch ${batch.batchId} collected: enriched=${enriched} failed=${failures.length}`)
    enrichedTotal += enriched
    failedTotal   += failures.length
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
  const pendingRow = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(enrichmentBatches)
    .where(eq(enrichmentBatches.status, 'pending'))
  const pendingCount = Number(pendingRow[0]?.c ?? 0)
  if (pendingCount === 0) {
    submit = await submitEnrichmentBatch(await getBatchCap())
  }

  return { ok: true, collect, publish, submit }
}
