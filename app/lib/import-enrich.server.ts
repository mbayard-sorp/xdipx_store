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
  type ProductBrief,
  type SharedEnrichmentContext,
} from '~/lib/batch-enrichment.server'
import {
  activateShopifyProduct,
  pushProductToShopify,
  appendProductTag,
  getHandleByProductId,
  type ProductPageDoc,
} from '~/lib/shopify.server'
import { createSuggestion } from '~/lib/team.server'
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

/**
 * Which transport generates enrichment content.
 *
 *   'batch-api' (default) — the cron tick submits Anthropic Message Batches
 *                           against the API key (metered spend, 50% batch
 *                           discount).
 *   'subagent'            — the daily R-ENRICH Claude cloud routine claims
 *                           candidates via /api/team/enrich-queue and generates
 *                           ProductWrites with the emma-product-enricher
 *                           subagent on the Max subscription (zero API spend).
 *                           The cron tick stops submitting batches but keeps
 *                           collecting any legacy in-flight ones, recovering
 *                           expired subagent leases, and publishing.
 *
 * Everything downstream of generation — quality gate, retry/park, Shopify +
 * Sanity writes, publish — is shared by both transports.
 */
export type EnrichTransport = 'batch-api' | 'subagent'

export async function getEnrichTransport(): Promise<EnrichTransport> {
  const raw = await getPipelineSetting('import_enrich_transport')
  return raw === 'subagent' ? 'subagent' : 'batch-api'
}

/**
 * enrich_batch_id prefix marking a candidate claimed by the subagent (Max)
 * transport rather than an Anthropic Message Batch. Reusing the same column
 * keeps every in-flight predicate (submit exclusion, funnel snapshot, admin
 * lifecycle badge) working unchanged for both transports; the prefix is what
 * tells collectEnrichmentBatch not to ask Anthropic about it.
 */
export const SUBAGENT_LEASE_PREFIX = 'subagent:'

export function isSubagentLease(batchId: string | null | undefined): boolean {
  return typeof batchId === 'string' && batchId.startsWith(SUBAGENT_LEASE_PREFIX)
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
  return explainQualityGateFailure(writes) === null
}

/**
 * Same predicate as passesQualityGate, but names the first failing check.
 * Null means the payload passes. Exported so the subagent transport can hand
 * the generating routine an actionable rejection reason (and so the gate is
 * unit-testable) without duplicating the rules.
 */
export function explainQualityGateFailure(writes: ProductWrites): string | null {
  if (!writes.descriptionHtml?.trim())     return 'descriptionHtml is empty'
  if (!writes.tagline?.trim())             return 'tagline is empty'
  if (!writes.seoMetaDescription || writes.seoMetaDescription.length < 100) return 'seoMetaDescription missing or under 100 chars'
  if (!writes.productTypeDial || !(PRODUCT_TYPE_DIALS as readonly string[]).includes(writes.productTypeDial)) return 'productTypeDial missing or not a known type'
  if (!writes.moodTags?.length)            return 'moodTags empty'
  if (!writes.audienceTags?.length)        return 'audienceTags empty'
  if (!writes.mattersTags?.length)         return 'mattersTags empty'
  const spread = checkDialSpread(writes.sensationDialV2?.items)
  if (!spread.ok) return `sensation dial spread violated (values [${spread.values.join(', ')}]: ${spread.distinct} distinct, ${spread.fives} fives, ${spread.ones} ones; need >=5 values, >=3 distinct, <=1 five, <=1 one)`
  return null
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
 * Read-only snapshot of the import_candidates funnel across the enrich stages.
 * A single grouped count query, used by the submit-blocker diagnostic so a tick
 * that submits nothing can name precisely which stage is empty or jammed.
 *
 * Stages (mutually exclusive within status='imported'):
 *   - pending:            status='pending', awaiting product-manager import
 *                         (upstream of enrichment, gated separately)
 *   - importedUnenriched: imported draft eligible to submit (no batch, not
 *                         enriched, not parked) -- the submit step's input set
 *   - inFlight:           claimed (enrich_batch_id set), awaiting collect
 *   - parked:             enrich_failed_at set, retry cap hit, needs review
 *   - enriched:           enriched_at set (may or may not be published yet)
 */
export interface EnrichFunnelSnapshot {
  pending:            number
  importedUnenriched: number
  inFlight:           number
  parked:             number
  enriched:           number
}

export async function snapshotEnrichFunnel(): Promise<EnrichFunnelSnapshot> {
  const rows = await db
    .select({
      pending: sql<number>`COUNT(*) FILTER (WHERE ${importCandidates.status} = 'pending')`,
      importedUnenriched: sql<number>`COUNT(*) FILTER (WHERE ${importCandidates.status} = 'imported'
        AND ${importCandidates.enrichedAt} IS NULL
        AND ${importCandidates.enrichBatchId} IS NULL
        AND ${importCandidates.enrichFailedAt} IS NULL)`,
      inFlight: sql<number>`COUNT(*) FILTER (WHERE ${importCandidates.status} = 'imported'
        AND ${importCandidates.enrichedAt} IS NULL
        AND ${importCandidates.enrichFailedAt} IS NULL
        AND ${importCandidates.enrichBatchId} IS NOT NULL)`,
      parked: sql<number>`COUNT(*) FILTER (WHERE ${importCandidates.status} = 'imported'
        AND ${importCandidates.enrichFailedAt} IS NOT NULL)`,
      enriched: sql<number>`COUNT(*) FILTER (WHERE ${importCandidates.status} = 'imported'
        AND ${importCandidates.enrichedAt} IS NOT NULL)`,
    })
    .from(importCandidates)

  const r = rows[0]
  return {
    pending:            Number(r?.pending ?? 0),
    importedUnenriched: Number(r?.importedUnenriched ?? 0),
    inFlight:           Number(r?.inFlight ?? 0),
    parked:             Number(r?.parked ?? 0),
    enriched:           Number(r?.enriched ?? 0),
  }
}

/**
 * The precise reason a tick submitted no enrichment batch. `idle` and
 * `batch_in_flight` are healthy no-ops (nothing to do, or a batch is
 * legitimately still processing within its SLA); the other three are jams that
 * will not self-clear without an upstream fix or owner action, and are the ones
 * worth a loud owner alert.
 */
export type SubmitBlockerKind =
  | 'idle'
  | 'batch_in_flight'
  | 'upstream_backlog'
  | 'all_parked'
  | 'no_briefs'
  | 'subagent_transport'

export interface SubmitBlocker {
  kind:      SubmitBlockerKind
  /** True when this state warrants a loud, owner-visible daily alert. */
  alertable: boolean
  detail:    string
}

/**
 * Pure classifier: given the funnel snapshot and the submit step's reason code,
 * name the binding blocker for a tick that produced no batch. Extracted so the
 * decision is unit-tested without a database. `submitReason` is one of
 * submitEnrichmentBatch's reasons ('no_unenriched', 'no_briefs') or
 * 'batch_in_flight' when the tick skipped submit because a batch was still in
 * flight.
 *
 * This exists because detectImportEnrichStall only ever counts
 * importedUnenriched rows: when the funnel is empty at that stage but jammed
 * elsewhere (everything parked, or a real backlog stuck upstream at 'pending',
 * or imported rows that cannot produce a brief), the pipeline was silent. That
 * silence is exactly how enrichment produced nothing for 75 days with no alert.
 */
export function classifySubmitBlocker(
  snap: EnrichFunnelSnapshot,
  submitReason: string | undefined,
): SubmitBlocker {
  if (submitReason === 'subagent_transport') {
    // Generation is delegated to the daily R-ENRICH routine (Max transport):
    // a tick that submits no Anthropic batch is the design working, never an
    // alert. Jam visibility on this transport comes from the stall watchdog
    // (unclaimed rows past the age threshold — covers a routine that stopped
    // running) plus the routine's own funnel report, which surfaces parked and
    // upstream-pending rows every run.
    return {
      kind:      'subagent_transport',
      alertable: false,
      detail:    `Enrichment transport is 'subagent': the daily R-ENRICH routine generates content on the Max subscription and the cron submits no Anthropic batches. Funnel: ${snap.importedUnenriched} awaiting claim, ${snap.inFlight} leased/in flight, ${snap.parked} parked.`,
    }
  }
  if (submitReason === 'no_briefs') {
    return {
      kind:      'no_briefs',
      alertable: true,
      detail:    `${snap.importedUnenriched} imported draft(s) awaiting enrichment could not produce a gatherable brief (missing dealHistory/snapshot); none could be submitted.`,
    }
  }
  if (submitReason === 'batch_in_flight' || snap.inFlight > 0) {
    return {
      kind:      'batch_in_flight',
      alertable: false,
      detail:    `${snap.inFlight} candidate(s) are in an enrichment batch still being collected; submit correctly waits until it drains.`,
    }
  }
  // submitReason === 'no_unenriched' (or defensively unknown): the submit input
  // set is empty. Name where the funnel is actually stuck.
  if (snap.pending > 0) {
    return {
      kind:      'upstream_backlog',
      alertable: true,
      detail:    `No imported drafts await enrichment, but ${snap.pending} candidate(s) sit at status='pending' upstream and are not being imported, so enrichment has nothing to claim.`,
    }
  }
  if (snap.parked > 0) {
    return {
      kind:      'all_parked',
      alertable: true,
      detail:    `No imported drafts await enrichment; ${snap.parked} candidate(s) are parked (enrich_failed_at set) and need manual review before they can re-enter the pipeline.`,
    }
  }
  return {
    kind:      'idle',
    alertable: false,
    detail:    'The enrichment funnel is empty at every stage; nothing to submit.',
  }
}

/**
 * Loud, owner-visible daily diagnostic for a tick that produced no batch. Fires
 * at most once per 24h (KV dedupe, same pattern as detectImportEnrichStall) and
 * only for an alertable blocker, so a healthy idle pipeline or a batch mid-flight
 * stays quiet. Never throws into the tick.
 */
export async function reportSubmitBlocker(
  snap: EnrichFunnelSnapshot,
  blocker: SubmitBlocker,
): Promise<{ alerted: boolean }> {
  if (!blocker.alertable) return { alerted: false }
  try {
    const { kvSetNX } = await import('~/lib/kv.server')
    const fresh = await kvSetNX('alert:import-enrich-no-submit', String(Date.now()), 24 * 3600)
    if (!fresh) {
      console.warn(`[import-enrich] no submit this tick (${blocker.kind}): ${blocker.detail}`)
      return { alerted: false }
    }

    const { sendOwnerEmail, escapeHtml } = await import('~/lib/owner-alerts.server')
    await sendOwnerEmail(
      `xdipx import-enrich: no enrichment submitted (${blocker.kind})`,
      `<p>The import-enrich pipeline is <strong>enabled</strong> but submitted no enrichment batch this tick.</p>`
        + `<p><strong>Blocker: ${escapeHtml(blocker.kind)}.</strong> ${escapeHtml(blocker.detail)}</p>`
        + `<p>Funnel: pending ${snap.pending}, imported awaiting enrichment ${snap.importedUnenriched}, `
        + `in flight ${snap.inFlight}, parked ${snap.parked}, enriched ${snap.enriched}.</p>`
        + `<p>Check the /cron/import-enrich logs. If parked, the candidates hit the retry cap; if an upstream `
        + `backlog, check product_manager_enabled and the import path; if no briefs, check dealHistory linkage.</p>`,
    )
    console.warn(`[import-enrich] NO-SUBMIT alert (${blocker.kind}): ${blocker.detail}; owner alerted`)
    return { alerted: true }
  } catch (err) {
    console.error('[import-enrich] no-submit reporter error (non-fatal):', err)
    return { alerted: false }
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
    // Subagent (Max transport) leases are not Anthropic batches: there is
    // nothing to retrieve. The R-ENRICH routine completes them itself via
    // /api/team/enrich-queue. All this collector does for them is age out
    // leases whose routine died (same STUCK_BATCH_MAX_HOURS window as a dead
    // batch), routing those candidates through the normal retry/park path so
    // they can be re-claimed — otherwise a crashed run would freeze its rows
    // in flight forever and, with the transport later flipped back to
    // batch-api, block every future submit behind stillPending > 0.
    if (isSubagentLease(batchId)) {
      const stuck: typeof candidates = []
      const live:  typeof candidates = []
      for (const c of candidates) (isBatchClaimStuck(c.claimedAt, now) ? stuck : live).push(c)
      for (const candidate of stuck) {
        await applyEnrichFailure(candidate, `subagent lease ${batchId} expired past ${STUCK_BATCH_MAX_HOURS}h`)
        recoveredTotal++
      }
      stillPending += live.length
      if (stuck.length) {
        console.warn(`[import-enrich] subagent lease ${batchId} expired; aged out ${stuck.length} candidate(s) for re-claim, ${live.length} still leased`)
      }
      continue
    }

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
      brand:      dealHistory.brand,
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
  // Collected for the social team's new-product suggestion below (#3736):
  // handle, title, category, vendor per product that actually went live.
  const wentLive: Array<{ handle: string; title: string; category: string; vendor: string }> = []
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

      // Best-effort handle lookup for the social suggestion below. A miss
      // falls back to the SKU so the row still names the product somehow.
      try {
        const handle = await getHandleByProductId(r.productId)
        wentLive.push({
          handle:   handle ?? r.sku,
          title:    r.title ?? r.sku,
          category: (r.categories ?? []).filter(c => !!c && c !== '(uncategorized)').join(', ') || 'uncategorized',
          vendor:   r.brand ?? 'unknown',
        })
      } catch {
        wentLive.push({ handle: r.sku, title: r.title ?? r.sku, category: 'uncategorized', vendor: r.brand ?? 'unknown' })
      }
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

  // Tell the social team products went live (ticket #3736). One batched row
  // per publish run, never one row per product, so a bulk publish cannot flood
  // the bus; the social routine reads its inbound mail at Step 7b. The daily
  // dedupe key means a re-run on the same day extends the open conversation
  // instead of opening a second one. Products activated OUTSIDE this chain
  // (manual Shopify status flip) are caught by handleProductUpdated in
  // server/webhooks.ts, which skips products this chain just published.
  if (wentLive.length > 0) {
    try {
      const day = new Date().toISOString().slice(0, 10)
      const lines = wentLive
        .map(p => `- ${p.title} (handle: ${p.handle}, category: ${p.category}, vendor: ${p.vendor})`)
        .join('\n')
      await createSuggestion({
        team:      'social',
        kind:      'campaign',
        category:  'social-automation',
        dedupeKey: `new-products:enrich:${day}`,
        suggestion:
          `${wentLive.length} product(s) went live on the storefront via the enrich-to-publish ` +
          `chain (owner direction 2026-08-16: posts about new products we now have on the site):\n` +
          `${lines}\n` +
          `Consider a new-arrivals post per routine-social-daily.md Step 7b. Every pick still ` +
          `passes the usual gates: Instagram category eligibility, stock, and the voice gate.`,
      })
    } catch (err) {
      console.warn('[import-enrich] new-product social suggestion filing failed (non-blocking):', err)
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
  /** Present when the tick submitted no batch: the named funnel blocker and
   *  whether the owner was alerted. Surfaces the reason in the cron response and
   *  logs, so an idle-or-jammed pipeline is never silent again. */
  noSubmit?: { blocker: SubmitBlocker; funnel: EnrichFunnelSnapshot; alerted: boolean }
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
  //
  // Under the 'subagent' transport the cron never submits: generation belongs
  // to the daily R-ENRICH routine (Max subscription, zero API spend). Collect
  // and publish above still ran — they drain legacy in-flight batches, recover
  // expired subagent leases, and flip enriched drafts live between routine runs.
  const transport = await getEnrichTransport()
  const submit =
    transport === 'subagent'    ? { submitted: 0, batchIds: [] as string[], reason: 'subagent_transport' } :
    collect.stillPending === 0  ? await submitEnrichmentBatch(await getBatchCap(), { deadline })
                                : { submitted: 0, batchIds: [] as string[], reason: 'batch_in_flight' }

  // A tick that submits nothing is where the pipeline used to go silent: the
  // stall detector only ever sees importedUnenriched rows, so an empty-input or
  // parked-out or upstream-jammed funnel raised no alert at all. Snapshot the
  // funnel, name the precise blocker, and raise a loud daily owner alert for the
  // states that will not self-clear. Never blocks the tick.
  if (submit.submitted === 0) {
    try {
      const funnel = await snapshotEnrichFunnel()
      const blocker = classifySubmitBlocker(funnel, submit.reason)
      const { alerted } = await reportSubmitBlocker(funnel, blocker)
      return { ok: true, stall, collect, publish, submit, noSubmit: { blocker, funnel, alerted } }
    } catch (err) {
      console.error('[import-enrich] no-submit diagnostic error (non-fatal):', err)
    }
  }

  return { ok: true, stall, collect, publish, submit }
}

// ─── Subagent (Max) transport: claim / complete / release ────────────────────
//
// The generation half of the enrich lifecycle when import_enrich_transport is
// 'subagent'. The daily R-ENRICH Claude cloud routine (billed to the Max
// subscription) calls these via /api/team/enrich-queue:
//
//   claim    — lease unenriched imported drafts (enrich_batch_id =
//              'subagent:<leaseId>') and hand back the same briefs + shared
//              editorial context the batch path embeds in its prompts.
//   complete — accept a generated ProductWrites payload, run the SAME quality
//              gate as the batch path, and on pass run the SAME
//              applyFullEnrichmentWrites + enriched_at stamp. A gate or apply
//              failure goes through the SAME decideEnrichFailure retry/park.
//   release  — the routine reports a product it could not generate for;
//              routed through retry/park like a batch failure.
//
// Publishing stays with the 30-minute cron tick (publishEnrichedProducts), so
// enriched drafts go live on the existing cadence regardless of transport.

export interface SubagentClaim {
  candidateId: number
  productId:   string
  sku?:        string
  brief:       ProductBrief
}

export interface SubagentClaimResult {
  leaseId:       string
  claims:        SubagentClaim[]
  /** Candidates that matched but produced no gatherable brief; left unclaimed
   *  (same behaviour as the batch submit path). */
  skippedNoBrief: number
  sharedContext: SharedEnrichmentContext
}

/**
 * Lease up to `cap` unenriched imported drafts to a subagent run. Uses the
 * exact selection predicate as submitEnrichmentBatch, so the two transports
 * can never double-generate: a row claimed by either is invisible to the other.
 * Each candidate is stamped immediately after its brief gathers, so a timeout
 * mid-loop never orphans gathered work.
 */
export async function claimEnrichmentForSubagent(
  cap: number,
  leaseId: string,
): Promise<SubagentClaimResult> {
  const lease = `${SUBAGENT_LEASE_PREFIX}${leaseId}`
  const rows = await db
    .select({ id: importCandidates.id, productId: dealHistory.shopifyProductId, sku: dealHistory.sku })
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

  const sharedContext = await loadSharedEnrichmentContext()
  const claims: SubagentClaim[] = []
  let skippedNoBrief = 0

  for (const r of rows) {
    if (!r.productId) continue
    const brief = await gatherProductBrief(r.productId)
    if (!brief) {
      console.warn(`[import-enrich] subagent claim: no brief for product ${r.productId} (candidate ${r.id}) — skipping`)
      skippedNoBrief++
      continue
    }
    // Pairings are deal-cycle artifacts — suppressed at import time on both
    // transports (see submitEnrichmentBatch).
    brief.pairingCandidates = []
    await db.update(importCandidates)
      .set({ enrichBatchId: lease, updatedAt: new Date() })
      .where(eq(importCandidates.id, r.id))
    const claim: SubagentClaim = { candidateId: r.id, productId: r.productId, brief }
    if (r.sku) claim.sku = r.sku
    claims.push(claim)
  }

  if (claims.length) {
    console.log(`[import-enrich] subagent lease ${lease}: claimed ${claims.length} candidate(s)`)
  }
  return { leaseId, claims, skippedNoBrief, sharedContext }
}

export type SubagentCompleteResult =
  | { ok: true;  result: 'enriched' }
  | { ok: false; result: 'requeued' | 'parked'; reason: string }
  | { ok: false; result: 'not_claimable'; reason: string }

/** Load one candidate row eligible for subagent complete/release: imported,
 *  not yet enriched or parked, currently under a subagent lease. */
async function getSubagentClaimedCandidate(candidateId: number): Promise<
  { id: number; productId: string; enrichAttempts: number } | { error: string }
> {
  const rows = await db
    .select({
      id:             importCandidates.id,
      batchId:        importCandidates.enrichBatchId,
      enrichedAt:     importCandidates.enrichedAt,
      enrichFailedAt: importCandidates.enrichFailedAt,
      status:         importCandidates.status,
      enrichAttempts: importCandidates.enrichAttempts,
      productId:      dealHistory.shopifyProductId,
    })
    .from(importCandidates)
    .innerJoin(dealHistory, eq(importCandidates.dealHistoryId, dealHistory.id))
    .where(eq(importCandidates.id, candidateId))
    .limit(1)
  const row = rows[0]
  if (!row)                          return { error: `candidate ${candidateId} not found` }
  if (row.status !== 'imported')     return { error: `candidate ${candidateId} status is '${row.status}', not 'imported'` }
  if (row.enrichedAt)                return { error: `candidate ${candidateId} already enriched` }
  if (row.enrichFailedAt)            return { error: `candidate ${candidateId} is parked` }
  if (!isSubagentLease(row.batchId)) return { error: `candidate ${candidateId} is not under a subagent lease (enrich_batch_id=${row.batchId ?? 'null'})` }
  if (!row.productId)                return { error: `candidate ${candidateId} has no linked Shopify product` }
  return { id: row.id, productId: row.productId, enrichAttempts: row.enrichAttempts }
}

/**
 * Accept a subagent-generated ProductWrites payload for one leased candidate.
 * Identical downstream semantics to the batch collect path: quality gate →
 * applyFullEnrichmentWrites → enriched_at on pass; decideEnrichFailure
 * retry/park on any failure.
 */
export async function completeSubagentEnrichment(
  candidateId: number,
  writes: ProductWrites,
): Promise<SubagentCompleteResult> {
  const candidate = await getSubagentClaimedCandidate(candidateId)
  if ('error' in candidate) return { ok: false, result: 'not_claimable', reason: candidate.error }

  const gateFailure = explainQualityGateFailure(writes)
  if (gateFailure === null) {
    try {
      await applyFullEnrichmentWrites(candidate.productId, writes)
      await db.update(importCandidates)
        .set({ enrichedAt: new Date(), updatedAt: new Date() })
        .where(eq(importCandidates.id, candidate.id))
      return { ok: true, result: 'enriched' }
    } catch (err) {
      const reason = `apply failed (subagent): ${err instanceof Error ? err.message : String(err)}`
      const disp = decideEnrichFailure(candidate.enrichAttempts)
      await applyEnrichFailure(candidate, reason)
      return { ok: false, result: disp.action === 'retry' ? 'requeued' : 'parked', reason }
    }
  }

  const reason = `quality gate failed (subagent): ${gateFailure}`
  const disp = decideEnrichFailure(candidate.enrichAttempts)
  await applyEnrichFailure(candidate, reason)
  return { ok: false, result: disp.action === 'retry' ? 'requeued' : 'parked', reason }
}

/**
 * The routine reports a leased candidate it could not generate content for
 * (subagent errored, returned unparseable JSON past its own retries, etc.).
 * Routed through the same retry/park path as a batch failure so the attempt
 * cap holds across transports.
 */
export async function releaseSubagentClaim(
  candidateId: number,
  reason: string,
): Promise<SubagentCompleteResult> {
  const candidate = await getSubagentClaimedCandidate(candidateId)
  if ('error' in candidate) return { ok: false, result: 'not_claimable', reason: candidate.error }
  const detail = `subagent generation failed: ${reason}`
  const disp = decideEnrichFailure(candidate.enrichAttempts)
  await applyEnrichFailure(candidate, detail)
  return { ok: false, result: disp.action === 'retry' ? 'requeued' : 'parked', reason: detail }
}
