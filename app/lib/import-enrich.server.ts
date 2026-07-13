/**
 * Post-import enrichment + publish lifecycle.
 *
 * Auto-import (Phase 2) and manual approve produce a bare, unpublished Shopify
 * DRAFT. This module drives the rest of the flow:
 *
 *   import -> enrich (Anthropic Batch API, 50% off) -> publish (draft -> active)
 *
 * Vercel functions cap at 60s, so enrichment is split across cron ticks:
 *   - submitEnrichmentBatch:  find unenriched imports, submit one single-call
 *                             full-enrichment Batch (one Sonnet request per
 *                             product), persist the batch id (no poll).
 *   - collectEnrichmentBatch: on a later tick, retrieve finished batches, run
 *                             the quality gate (passesQualityGate) on each
 *                             product, write passing writes back to Shopify +
 *                             Sanity and stamp enriched_at. Failing products
 *                             get one bounded retry before being parked
 *                             (enrich_failed_at) instead of published.
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
import { importCandidates, dealHistory } from '../../db/schema'
import {
  fetchProductSnapshot,
  gatherProductBrief,
  loadSharedEnrichmentContext,
} from '~/lib/enricher-brief.server'
import {
  submitFullEnrichmentBatch,
  collectFullEnrichmentBatch,
  checkDialSpread,
  type BatchFullEnrichmentInput,
} from '~/lib/batch-enrichment.server'
import {
  activateShopifyProduct,
  pushProductToShopify,
  appendProductTag,
  type ProductPageDoc,
} from '~/lib/shopify.server'
import { upsertProductPage } from '~/lib/sanity.server'
import { getPipelineSetting, deriveSection } from '~/lib/feed-processor.server'
import { IVR_EXPERIENCE_LEVELS } from '~/lib/claude.server'
import { EMMA_VOICE_ENRICHMENT } from '~/lib/emma-voice.server'
import { PRODUCT_TYPE_DIALS } from '~/types'
import type { ProductWrites } from '~/lib/emma-orchestrator.server'

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
 * Gate predicate for the ProductWrites a full-enrichment batch produced for one
 * product. Run BEFORE applyFullEnrichmentWrites. A previously-empty gate meant
 * even failed/partial batches got published; the key addition here is the
 * mood/audience/matters check -- a product can render a perfectly fine PDP
 * with empty tag arrays and still be invisible to every discovery rail and
 * Ask Emma filter.
 */
function passesQualityGate(writes: ProductWrites): boolean {
  if (!writes.descriptionHtml?.trim())     return false
  if (!writes.tagline?.trim())             return false
  if (!writes.seoMetaDescription || writes.seoMetaDescription.length < 100) return false
  if (!writes.productTypeDial || !(PRODUCT_TYPE_DIALS as readonly string[]).includes(writes.productTypeDial)) return false
  if (!writes.moodTags?.length)            return false
  if (!writes.audienceTags?.length)        return false
  if (!writes.mattersTags?.length)         return false
  if (!checkDialSpread(writes.sensationDialV2?.items).ok) return false
  return true
}

/** Bounded retry cap: after this many failed enrichment attempts, a candidate
 *  is parked (enrich_failed_at set) instead of re-submitted. */
const ENRICH_MAX_ATTEMPTS = 2

/**
 * Find imported-but-unenriched products and submit ONE Anthropic full-enrichment
 * batch -- a single Sonnet call per product (50% batch discount, no multi-turn
 * tool dispatch), replacing the 24-turn orchestrator path for auto-import.
 * Stamps each candidate's enrich_batch_id with the returned Anthropic batchId so
 * collectEnrichmentBatch can retrieve it on a later tick.
 *
 * The 24-turn poller (batch-orchestrator.server.ts / advanceInflightJobs) needs
 * no change -- it simply stops receiving 'import-product' jobs and keeps driving
 * 'field-regen' and other jobType consumers.
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
      isNull(importCandidates.enrichFailedAt),
    ))
    .orderBy(asc(importCandidates.id))
    .limit(cap)

  const valid = rows.filter((r): r is { id: number; productId: string } => Boolean(r.productId))
  if (valid.length === 0) return { submitted: 0, reason: 'no_unenriched' }

  const inputs: BatchFullEnrichmentInput[] = []
  const candidateIds: number[] = []

  for (const r of valid) {
    const brief = await gatherProductBrief(r.productId)
    if (!brief) {
      console.warn(`[import-enrich] no brief for product ${r.productId} (candidate ${r.id}) -- skipping`)
      continue
    }
    // Pairings are a deal-cycle artifact, curated against the freshest catalog
    // state when a product enters the homepage deal slot. Generating
    // pairing_why against the candidate list available at import time would be
    // discarded work -- suppress it here.
    brief.pairingCandidates = []
    inputs.push({ productId: `gid://shopify/Product/${r.productId}`, brief })
    candidateIds.push(r.id)
  }
  if (inputs.length === 0) return { submitted: 0, reason: 'no_briefs' }

  const sharedContext = await loadSharedEnrichmentContext()
  const { batchId } = await submitFullEnrichmentBatch(inputs, sharedContext, { brandVoice: EMMA_VOICE_ENRICHMENT })

  await db.update(importCandidates)
    .set({ enrichBatchId: batchId, updatedAt: new Date() })
    .where(inArray(importCandidates.id, candidateIds))

  console.log(`[import-enrich] submitted full-enrichment batch ${batchId} for ${inputs.length} product(s)`)
  return { submitted: inputs.length, batchId }
}

/**
 * Collect previously-submitted full-enrichment batches. Candidates sharing a
 * batchId (the common case -- one submit call batches up to the cap in a
 * single Anthropic Message Batch) are grouped so collectFullEnrichmentBatch is
 * called once per unique batch rather than once per candidate.
 *
 * For each candidate whose batch has ended, runs the quality gate (Part 3)
 * BEFORE calling applyFullEnrichmentWrites. Each product's apply is wrapped in
 * its own try/catch so one bad product never blocks the rest of the batch.
 *
 * On pass: writes are applied and enriched_at is stamped, same as before.
 * On fail (gate fails, batch returned no result/a failure, or the apply threw):
 * enriched_at is NOT stamped. enrich_attempts increments; below the retry cap,
 * enrich_batch_id is cleared so submitEnrichmentBatch re-selects the candidate
 * for one retry. At the cap, enrich_failed_at is set and enrich_batch_id is
 * left alone -- the row is parked, neither re-submitted nor published.
 */
export async function collectEnrichmentBatch(): Promise<{ enriched: number; failed: number; stillPending: number }> {
  const rows = await db
    .select({
      id:             importCandidates.id,
      batchId:        importCandidates.enrichBatchId,
      productId:      dealHistory.shopifyProductId,
      enrichAttempts: importCandidates.enrichAttempts,
    })
    .from(importCandidates)
    .innerJoin(dealHistory, eq(importCandidates.dealHistoryId, dealHistory.id))
    .where(and(
      eq(importCandidates.status, 'imported'),
      isNull(importCandidates.enrichedAt),
      isNull(importCandidates.enrichFailedAt),
      sql`${importCandidates.enrichBatchId} IS NOT NULL`,
    ))
    .orderBy(asc(importCandidates.id))

  const pending = rows.filter((r): r is { id: number; batchId: string; productId: string; enrichAttempts: number } =>
    Boolean(r.batchId) && Boolean(r.productId))

  if (pending.length === 0) {
    return { enriched: 0, failed: 0, stillPending: 0 }
  }

  const byBatch = new Map<string, typeof pending>()
  for (const c of pending) {
    const list = byBatch.get(c.batchId) ?? []
    list.push(c)
    byBatch.set(c.batchId, list)
  }

  let enrichedTotal = 0
  let failedTotal   = 0
  let stillPending  = 0

  for (const [batchId, candidates] of byBatch) {
    const collected = await collectFullEnrichmentBatch(batchId)
    if (!collected.ended) {
      stillPending += candidates.length
      continue
    }

    for (const candidate of candidates) {
      const gid          = `gid://shopify/Product/${candidate.productId}`
      const writes        = collected.results.get(gid)
      const batchFailure  = collected.failures.find(f => f.productId === gid)

      let ok = false
      if (writes && !batchFailure && passesQualityGate(writes)) {
        try {
          await applyFullEnrichmentWrites(candidate.productId, writes)
          ok = true
        } catch (err) {
          console.error(`[import-enrich] applyFullEnrichmentWrites failed for candidate ${candidate.id} (product ${candidate.productId}):`, err)
        }
      }

      if (ok) {
        await db.update(importCandidates)
          .set({ enrichedAt: new Date(), updatedAt: new Date() })
          .where(eq(importCandidates.id, candidate.id))
        enrichedTotal++
        continue
      }

      const attempts = candidate.enrichAttempts + 1
      const reason = batchFailure?.error ?? (!writes ? 'no result in batch' : 'quality gate failed')
      if (attempts < ENRICH_MAX_ATTEMPTS) {
        await db.update(importCandidates)
          .set({ enrichAttempts: attempts, enrichBatchId: null, updatedAt: new Date() })
          .where(eq(importCandidates.id, candidate.id))
        console.warn(`[import-enrich] candidate ${candidate.id} (product ${candidate.productId}) enrichment attempt ${attempts} failed (${reason}) -- re-queued for retry`)
      } else {
        await db.update(importCandidates)
          .set({ enrichAttempts: attempts, enrichFailedAt: new Date(), updatedAt: new Date() })
          .where(eq(importCandidates.id, candidate.id))
        console.warn(`[import-enrich] candidate ${candidate.id} (product ${candidate.productId}) enrichment attempt ${attempts} failed (${reason}) -- parked, needs manual review`)
      }
      failedTotal++
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

      // WS2b — tag the newly-activated product as a sourcing signal for the
      // daily merchandiser (opportunistic "New Arrivals" rail) and a future
      // /new page. Isolated try/catch: a tagging hiccup must never block the
      // publishedAt stamp below (the activation itself already succeeded).
      try {
        await appendProductTag(r.productId, 'new-arrival')
      } catch (tagErr) {
        console.warn(`[import-enrich] appendProductTag('new-arrival') failed for product ${r.productId} (candidate ${r.id}):`, tagErr instanceof Error ? tagErr.message : tagErr)
      }

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

  // Single-call full-enrichment batches create no durable in-flight row of
  // their own (unlike the old orchestrator's batch_jobs table), so
  // collect.stillPending IS the in-flight signal: only submit a new batch once
  // every previously-submitted batch has been collected, so we never stack
  // concurrent Anthropic batches for the same source.
  const submit = collect.stillPending === 0
    ? await submitEnrichmentBatch(await getBatchCap())
    : { submitted: 0, reason: 'batch_in_flight' }

  return { ok: true, collect, publish, submit }
}
