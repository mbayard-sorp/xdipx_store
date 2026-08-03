/**
 * Post-import enrichment + publish lifecycle.
 *
 * Auto-import (Phase 2) and manual approve produce a bare, unpublished Shopify
 * DRAFT. This module drives the rest of the flow:
 *
 *   import -> enrich (Anthropic Batch API, 50% off) -> publish (draft -> active)
 *
 * The Vercel function budget (300s) is split across cron ticks, and within a
 * tick the submit step is chunked so a mid-loop timeout can never lose gathered
 * work:
 *   - submitEnrichmentBatch:  find unenriched imports, then in small chunks
 *                             gather briefs, submit one full-enrichment Batch per
 *                             chunk (one Sonnet request per product), and persist
 *                             that chunk's batch id immediately (no poll) before
 *                             starting the next chunk. A tick deadline stops the
 *                             loop before the function budget so already-submitted
 *                             chunks are always durably stamped.
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
import { ensureProductTypeForPublish } from '~/lib/product-type.server'
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

/**
 * How many products' briefs to gather + submit as one Anthropic batch before
 * stamping their enrich_batch_id. Small so each chunk is a durable unit of work:
 * a timeout after chunk N still leaves chunks 1..N stamped and collectable.
 */
const BRIEF_CHUNK_SIZE = 5

/**
 * Wall-clock budget for one tick's submit loop. The Vercel function budget is
 * 300s; stop gathering new chunks well before that so an in-progress chunk can
 * finish and stamp. Collect + publish run before submit, so this is a ceiling on
 * the whole tick, not just submit.
 */
const TICK_BUDGET_MS = 240_000

/** Stall detector: alert when this many imported rows sit unclaimed (null
 *  enrich_batch_id) past the age threshold, a signal the submit step is failing
 *  to make progress. */
const STALL_COUNT_THRESHOLD = 25
const STALL_AGE_HOURS = 6

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

  // Pricing engine v2 keys margin rules on Shopify product_type. Imports since
  // the 2026-07-22 fix set it at creation; this backfills any product that
  // reached enrichment without one (reused drafts, pre-fix imports). Guard
  // logging happens inside — never blocks the enrichment write.
  if (!snap.product_type?.trim()) {
    await ensureProductTypeForPublish({
      numericProductId: numericProductId,
      categories:       editorialTags,
      title:            snap.title,
      currentType:      null,
    })
  }

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
export const ENRICH_MAX_ATTEMPTS = 2

/**
 * A real Anthropic Message Batch always reaches `ended` within its 24h SLA.
 * A batch still unfinished well past that (canceled, expired, or one whose id
 * we can no longer retrieve) is dead: its candidates would otherwise sit
 * `stillPending` forever and, because a new submit is gated on
 * `stillPending === 0`, freeze the entire enrich→publish pipeline behind one
 * stuck batch. Past this age we treat the claim as failed and route it through
 * the normal retry/park path so it can re-submit against a fresh batch.
 */
export const STUCK_BATCH_MAX_HOURS = 26

/** What to do with one candidate after a failed or stuck batch collection. */
export type EnrichFailureDisposition =
  | { action: 'retry'; enrichAttempts: number }
  | { action: 'park';  enrichAttempts: number }

/**
 * Pure retry-vs-park decision, shared by the per-product quality-gate failure
 * path and the new stuck/errored-batch recovery paths. Below the attempt cap a
 * candidate is re-queued (enrich_batch_id cleared) for one more try; at the cap
 * it is parked (enrich_failed_at set). Extracted so the decision is unit-tested
 * without a database.
 */
export function decideEnrichFailure(currentAttempts: number): EnrichFailureDisposition {
  const enrichAttempts = currentAttempts + 1
  return enrichAttempts < ENRICH_MAX_ATTEMPTS
    ? { action: 'retry', enrichAttempts }
    : { action: 'park',  enrichAttempts }
}

/**
 * Pure: has a claimed-but-uncollected candidate's batch been in flight long
 * enough to be presumed dead? `claimedAt` is the row's last update, stamped
 * when its enrich_batch_id was set and untouched until collection. Null anchors
 * (never seen in practice) are treated as not-stuck so a missing timestamp can
 * never trigger a spurious recovery.
 */
export function isBatchClaimStuck(
  claimedAt: Date | null | undefined,
  now: Date,
  maxHours: number = STUCK_BATCH_MAX_HOURS,
): boolean {
  if (!claimedAt) return false
  const ageHours = (now.getTime() - claimedAt.getTime()) / 3_600_000
  return ageHours >= maxHours
}

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
export async function submitEnrichmentBatch(
  cap: number,
  opts: { deadline?: number } = {},
): Promise<{ submitted: number; batchIds: string[]; reason?: string }> {
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
  if (valid.length === 0) return { submitted: 0, batchIds: [], reason: 'no_unenriched' }

  // Load the shared enrichment context once; it is reused across every chunk.
  const sharedContext = await loadSharedEnrichmentContext()

  const batchIds: string[] = []
  let submittedTotal = 0

  // Chunk the brief-gather + submit + stamp cycle. Stamping each chunk's
  // enrich_batch_id right after its batch is created means a timeout later in
  // the loop can never orphan already-gathered work: those products are already
  // claimed and collectEnrichmentBatch picks them up on the next tick. This is
  // the fix for the stall where a full cap-sized serial gather timed out before
  // stamping anything and every subsequent tick repeated the same doomed loop.
  for (let i = 0; i < valid.length; i += BRIEF_CHUNK_SIZE) {
    if (opts.deadline && Date.now() >= opts.deadline) {
      console.warn(`[import-enrich] tick deadline reached after ${submittedTotal} submitted; ${valid.length - i} product(s) deferred to next tick`)
      break
    }

    const chunk = valid.slice(i, i + BRIEF_CHUNK_SIZE)
    const inputs: BatchFullEnrichmentInput[] = []
    const candidateIds: number[] = []

    for (const r of chunk) {
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
      // Bare numeric id: the productId becomes the Anthropic batch custom_id,
      // which must match ^[a-zA-Z0-9_-]{1,64}$; a gid:// prefix is rejected.
      inputs.push({ productId: String(r.productId), brief })
      candidateIds.push(r.id)
    }
    if (inputs.length === 0) continue

    const { batchId } = await submitFullEnrichmentBatch(inputs, sharedContext, { brandVoice: EMMA_VOICE_ENRICHMENT })

    // Stamp THIS chunk immediately, before gathering the next one.
    await db.update(importCandidates)
      .set({ enrichBatchId: batchId, updatedAt: new Date() })
      .where(inArray(importCandidates.id, candidateIds))

    batchIds.push(batchId)
    submittedTotal += inputs.length
    console.log(`[import-enrich] submitted full-enrichment batch ${batchId} for ${inputs.length} product(s)`)
  }

  if (submittedTotal === 0) return { submitted: 0, batchIds: [], reason: 'no_briefs' }
  return { submitted: submittedTotal, batchIds }
}

/**
 * Stall watchdog. Counts imported products that are still unclaimed by the
 * enrichment step (null enrich_batch_id, not yet enriched or parked) and whose
 * eligibility anchor (approval time, falling back to last update) is older than
 * STALL_AGE_HOURS. When more than STALL_COUNT_THRESHOLD are stuck, emails the
 * owner at most once per 24h. Runs every tick, including when the pipeline is
 * disabled, so a backlog that built up behind a flipped-off valve is still
 * surfaced. Never throws into the tick; failures are logged and swallowed.
 */
export async function detectImportEnrichStall(enabled: boolean): Promise<{ stuck: number; oldestHours: number | null; alerted: boolean }> {
  try {
    const cutoff = new Date(Date.now() - STALL_AGE_HOURS * 3600 * 1000)
    const rows = await db
      .select({
        anchor: sql<string>`COALESCE(${importCandidates.reviewedAt}, ${importCandidates.updatedAt})`,
      })
      .from(importCandidates)
      .where(and(
        eq(importCandidates.status, 'imported'),
        isNull(importCandidates.enrichedAt),
        isNull(importCandidates.enrichBatchId),
        isNull(importCandidates.enrichFailedAt),
      ))

    const anchors = rows
      .map(r => new Date(r.anchor))
      .filter(d => !Number.isNaN(d.getTime()) && d < cutoff)
    const stuck = anchors.length
    const oldest = anchors.reduce<Date | null>((min, d) => (min === null || d < min ? d : min), null)
    const oldestHours = oldest ? Math.round((Date.now() - oldest.getTime()) / 3600_000) : null

    if (stuck <= STALL_COUNT_THRESHOLD) return { stuck, oldestHours, alerted: false }

    const { kvSetNX } = await import('~/lib/kv.server')
    const fresh = await kvSetNX('alert:import-enrich-stall', String(Date.now()), 24 * 3600)
    if (!fresh) return { stuck, oldestHours, alerted: false }

    const { sendOwnerEmail, escapeHtml } = await import('~/lib/owner-alerts.server')
    const state = enabled ? 'enabled' : 'DISABLED'
    await sendOwnerEmail(
      `xdipx import-enrich stall: ${stuck} products stuck`,
      `<p>${escapeHtml(String(stuck))} imported products have sat unclaimed by enrichment for over ${STALL_AGE_HOURS}h `
        + `(oldest ${escapeHtml(String(oldestHours ?? '?'))}h). The import_enrich pipeline is <strong>${state}</strong>.</p>`
        + `<p>If disabled, this is an expected backlog. If enabled, the submit step is failing to stamp enrich_batch_id; `
        + `check the /cron/import-enrich logs and the import_enrich_batch_cap setting.</p>`,
    )
    console.warn(`[import-enrich] STALL: ${stuck} stuck (oldest ${oldestHours}h), pipeline ${state}; owner alerted`)
    return { stuck, oldestHours, alerted: true }
  } catch (err) {
    console.error('[import-enrich] stall detector error (non-fatal):', err)
    return { stuck: 0, oldestHours: null, alerted: false }
  }
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
/**
 * Apply a failed/stuck-batch disposition to one candidate: below the retry cap,
 * clear enrich_batch_id so submitEnrichmentBatch re-selects it for a fresh
 * batch; at the cap, park it (enrich_failed_at). Mirrors the inline handling the
 * per-product quality-gate path used before this was extracted, so the retry/
 * park behaviour there is unchanged.
 */
async function applyEnrichFailure(
  candidate: { id: number; productId: string; enrichAttempts: number },
  reason: string,
): Promise<void> {
  const disp = decideEnrichFailure(candidate.enrichAttempts)
  if (disp.action === 'retry') {
    await db.update(importCandidates)
      .set({ enrichAttempts: disp.enrichAttempts, enrichBatchId: null, updatedAt: new Date() })
      .where(eq(importCandidates.id, candidate.id))
    console.warn(`[import-enrich] candidate ${candidate.id} (product ${candidate.productId}) enrichment attempt ${disp.enrichAttempts} failed (${reason}) -- re-queued for retry`)
  } else {
    await db.update(importCandidates)
      .set({ enrichAttempts: disp.enrichAttempts, enrichFailedAt: new Date(), updatedAt: new Date() })
      .where(eq(importCandidates.id, candidate.id))
    console.warn(`[import-enrich] candidate ${candidate.id} (product ${candidate.productId}) enrichment attempt ${disp.enrichAttempts} failed (${reason}) -- parked, needs manual review`)
  }
}

export async function collectEnrichmentBatch(): Promise<{ enriched: number; failed: number; stillPending: number; recovered: number }> {
  const rows = await db
    .select({
      id:             importCandidates.id,
      batchId:        importCandidates.enrichBatchId,
      productId:      dealHistory.shopifyProductId,
      enrichAttempts: importCandidates.enrichAttempts,
      claimedAt:      importCandidates.updatedAt,
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

  const pending = rows.filter((r): r is { id: number; batchId: string; productId: string; enrichAttempts: number; claimedAt: Date } =>
    Boolean(r.batchId) && Boolean(r.productId))

  if (pending.length === 0) {
    return { enriched: 0, failed: 0, stillPending: 0, recovered: 0 }
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
  let recoveredTotal = 0
  const now = new Date()

  for (const [batchId, candidates] of byBatch) {
    // Recovery guard: isolate each batch. A single un-retrievable batch id
    // (Anthropic 404 after batch/result expiry, an invalid id, or a transient
    // API error) makes retrieve() throw. Before this guard that throw
    // propagated out of collectEnrichmentBatch and killed the whole tick, so
    // publish and submit never ran and every candidate froze behind one poison
    // batch. Now the failure is contained to its own batch and its candidates
    // are routed through the normal retry/park path, which re-submits them
    // against a fresh batch (or parks them at the cap).
    let collected: Awaited<ReturnType<typeof collectFullEnrichmentBatch>>
    try {
      collected = await collectFullEnrichmentBatch(batchId)
    } catch (err) {
      const reason = `batch collect error: ${err instanceof Error ? err.message : String(err)}`
      for (const candidate of candidates) {
        await applyEnrichFailure(candidate, reason)
        failedTotal++
      }
      console.error(`[import-enrich] collectFullEnrichmentBatch threw for batch ${batchId}; ${candidates.length} candidate(s) routed to retry/park:`, err)
      continue
    }

    if (!collected.ended) {
      // A real batch always ends within 24h. One still unfinished past
      // STUCK_BATCH_MAX_HOURS is dead; age its candidates out through the
      // failure path so a resubmit can happen, instead of counting them
      // stillPending forever and blocking every future submit.
      const stuck: typeof candidates = []
      const live:  typeof candidates = []
      for (const c of candidates) (isBatchClaimStuck(c.claimedAt, now) ? stuck : live).push(c)
      for (const candidate of stuck) {
        await applyEnrichFailure(candidate, `batch stuck in '${collected.status}' past ${STUCK_BATCH_MAX_HOURS}h`)
        recoveredTotal++
      }
      stillPending += live.length
      if (stuck.length) {
        console.warn(`[import-enrich] batch ${batchId} stuck in '${collected.status}'; aged out ${stuck.length} candidate(s) for resubmit, ${live.length} still in flight`)
      }
      continue
    }

    for (const candidate of candidates) {
      const resultKey     = String(candidate.productId)
      const writes        = collected.results.get(resultKey)
      const batchFailure  = collected.failures.find(f => f.productId === resultKey)

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

      const reason = batchFailure?.error ?? (!writes ? 'no result in batch' : 'quality gate failed')
      await applyEnrichFailure(candidate, reason)
      failedTotal++
    }
  }

  return { enriched: enrichedTotal, failed: failedTotal, stillPending, recovered: recoveredTotal }
}

/**
 * Flip enriched-but-unpublished imported drafts to active on the curated
 * channels (POS excluded — handled inside activateShopifyProduct). Products are
 * priced at import time, so enriched is the only gate. Best-effort per product.
 */
export async function publishEnrichedProducts(): Promise<{ published: number; failed: number }> {
  const rows = await db
    .select({
      id:         importCandidates.id,
      productId:  dealHistory.shopifyProductId,
      sku:        dealHistory.sku,
      title:      dealHistory.seoTitle,
      categories: dealHistory.categories,
    })
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
      // Last-line guard: never flip a draft live without a product_type the
      // pricing engine can resolve. Backfills by derivation when missing and
      // error-logs (without blocking publish) when unresolvable — a typeless
      // live product prices on the global fallback rule.
      await ensureProductTypeForPublish({
        numericProductId: r.productId,
        sku:              r.sku,
        title:            r.title ?? '',
        categories:       (r.categories ?? []).filter((c): c is string => !!c && c !== '(uncategorized)'),
      })

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
  stall?:   Awaited<ReturnType<typeof detectImportEnrichStall>>
  collect?: Awaited<ReturnType<typeof collectEnrichmentBatch>>
  publish?: Awaited<ReturnType<typeof publishEnrichedProducts>>
  submit?:  Awaited<ReturnType<typeof submitEnrichmentBatch>>
}

/**
 * One self-draining tick: collect finished batches, publish ready products,
 * then submit a new batch only if none is still in flight (avoids stacking
 * concurrent batches). Gated by `import_enrich_enabled`. The stall watchdog runs
 * before the gate so a backlog behind a flipped-off valve is still surfaced.
 */
export async function runImportEnrichTick(opts: { source?: 'cron' | 'manual' } = {}): Promise<ImportEnrichTickResult> {
  void opts
  const deadline = Date.now() + TICK_BUDGET_MS

  const enabled = await isEnrichEnabled()
  const stall = await detectImportEnrichStall(enabled)

  if (!enabled) {
    return { ok: true, skipped: true, reason: 'disabled', stall }
  }

  const collect = await collectEnrichmentBatch()
  const publish = await publishEnrichedProducts()

  // Single-call full-enrichment batches create no durable in-flight row of
  // their own (unlike the old orchestrator's batch_jobs table), so
  // collect.stillPending IS the in-flight signal: only submit a new batch once
  // every previously-submitted batch has been collected, so we never stack
  // concurrent Anthropic batches for the same source.
  const submit = collect.stillPending === 0
    ? await submitEnrichmentBatch(await getBatchCap(), { deadline })
    : { submitted: 0, batchIds: [], reason: 'batch_in_flight' }

  return { ok: true, stall, collect, publish, submit }
}
