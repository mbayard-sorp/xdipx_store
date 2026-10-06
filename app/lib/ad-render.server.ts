/**
 * Ad Studio v2 render pipeline (PR-C). Turns a hearted idea into gated
 * creatives, one ad_creatives row per (idea, format).
 *
 *   enqueueRenders(ideaIds, actor)   rows in status draft, slogans rotated
 *   renderCreative(creativeId)       plate, composite, five gates, upload
 *
 * The plate (text-free) comes from generate-image.server.ts at the lane's
 * ceiling: object-first archetype B on paid lanes, the cast on-skin path only
 * on adult and owned. The slogan is composited in ad-compose.server.ts, never
 * generated. One plate per idea per aspect bucket is shared by every format in
 * that bucket, so a swap of slogan costs nothing and three sizes cost one image.
 * Everything is idempotent per creative id. Spend logs under feature
 * 'ads-creative', which the ads team budget already sums.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, ne, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { adCreatives, adIdeas, mediaAssets, type AdIdeaProduct } from '../../db/schema'
import { enqueueSkipReason } from '~/lib/ad-render-eligibility'
import { LANE_FORMATS, PLATE_IMAGE_SIZE, TEXT_FORMAT_ID, getAdFormat, isTextFormat, type AdFormat } from '~/lib/ad-formats'
import {
  AdLaneCeilingError, GATE_ORDER, aggregateGates, buildExportPayload, buildPlatePrompt, chooseLayout,
  conceptUsesPlate, emptyGates, getConcept, isGatesJson, normaliseSlogan, notRun, pickSlogan, planPlate,
  type GateResult, type GatesJson, type LayoutTemplate, type PlatePlan,
} from '~/lib/ad-render-rules'
import { fidelityGateResult, policyGate, textGateResult, visionGateResult, voiceGate } from '~/lib/ad-copy-gates.server'
import type { VisionVerdict } from '~/lib/social-vision-gate.server'
import type { ProductFidelityVerdict } from '~/lib/social-product-fidelity.server'
import type { ComposeInput, ComposeResult } from '~/lib/ad-compose.server'

const FEATURE = 'ads-creative'
const SLOGAN_WINDOW_DAYS = 30
/** A render that has been "rendering" this long is treated as dead and may be retried. */
const STALE_RENDERING_MS = 10 * 60 * 1000
export const PENDING_ASSET_URL = 'pending:ad-creative'
export const TEXT_ASSET_URL = 'text-only:ad-creative'

export function isPlaceholderUrl(url: string | null | undefined): boolean {
  return !url || url.startsWith('pending:') || url.startsWith('text-only:')
}

// ---------------------------------------------------------------------------
// Dependencies (injected in tests)
// ---------------------------------------------------------------------------

export interface ProductLite {
  title: string
  referenceImageUrl: string | null
  sellable: boolean | null
}

export interface PlateResult {
  buffer: Buffer | null
  model: string
  provider: string
  requestId: string | null
  costUsd: number
  /** Set when the on-skin path could not run and an object plate was used. */
  note?: string
}

export interface RenderDeps {
  getProduct(handle: string): Promise<ProductLite | null>
  generatePlate(args: { plan: PlatePlan; prompt: string; format: AdFormat; refImageUrl: string; handle: string; conceptSlug: string; ideaId: number }): Promise<PlateResult>
  gateVision(buf: Buffer): Promise<VisionVerdict>
  gateFidelity(buf: Buffer, refImageUrl: string): Promise<ProductFidelityVerdict>
  compose(input: ComposeInput): Promise<ComposeResult>
  upload(pathname: string, buf: Buffer, contentType: string): Promise<{ url: string }>
  budgetRemainingCents(): Promise<number>
  estimatePlateCents(): number
}

async function defaultDeps(): Promise<RenderDeps> {
  const [{ getProductByHandle }, { isProductSellable }, { generateImage }, vgb, { composeAd }, { blobPut }, team, pricing] = await Promise.all([
    import('~/lib/shopify.server'),
    import('~/lib/social-publish-gate.server'),
    import('~/lib/generate-image.server'),
    import('~/lib/vision-gate-buffer.server'),
    import('~/lib/ad-compose.server'),
    import('~/lib/blob.server'),
    import('~/lib/team.server'),
    import('~/lib/model-pricing.server'),
  ])
  return {
    async getProduct(handle) {
      const p = await getProductByHandle(handle)
      if (!p) return null
      const bare = (p as unknown as { bareProductReference?: { url: string | null } }).bareProductReference?.url ?? null
      return { title: p.title, referenceImageUrl: bare ?? p.images[0]?.url ?? null, sellable: isProductSellable(p) }
    },
    async generatePlate(a) {
      if (a.plan.archetype === 'on-skin') {
        try {
          return await generateOnSkinPlate(a)
        } catch (err) {
          console.warn('[ad-render] on-skin plate failed, using an object plate', err)
          const fallback: PlatePlan = { ...a.plan, archetype: 'B', onSkin: false, sceneAxes: null, ground: 'coral-soft' }
          const prompt = buildPlatePrompt({ plan: fallback, conceptSlug: a.conceptSlug, ideaId: a.ideaId, productTitle: 'the product', format: a.format })
          const r = await objectPlate({ ...a, plan: fallback, prompt })
          return { ...r, note: 'on-skin path unavailable, object-first plate used' }
        }
      }
      return objectPlate(a)

      async function objectPlate(b: typeof a): Promise<PlateResult> {
        const res = await generateImage({
          prompt: b.prompt,
          count: 1,
          imageSize: PLATE_IMAGE_SIZE[b.format.plateBucket],
          refImageUrl: b.refImageUrl,
          feature: FEATURE,
          caller: 'ad-render',
          sku: b.handle,
          logCost: true,
        })
        return {
          buffer: res.buffers[0] ?? null,
          model: res.model,
          provider: res.provider,
          requestId: res.requestId ?? null,
          costUsd: pricing.estimateImageCostUsd(res.model, res.buffers.length),
        }
      }
    },
    gateVision: buf => vgb.gateImageBuffer(buf, undefined, undefined, 'ads'),
    gateFidelity: (buf, ref) => vgb.gateProductFidelityBuffer(buf, ref, undefined, undefined, 'ads'),
    compose: composeAd,
    upload: (p, buf, contentType) => blobPut(p, buf, { contentType }),
    async budgetRemainingCents() {
      const [cfg, spent] = await Promise.all([team.getTeamConfig('ads'), team.getTodaySpendCents('ads')])
      return Math.max(0, cfg.dailyCents - spent)
    },
    estimatePlateCents: () => Math.ceil(pricing.estimateImageCostUsd('atlas/seedream-4.5-edit', 1) * 100),
  }
}

/**
 * The on-skin path for adult and owned lanes: the social cast composite with the
 * concept's briefed axes. The composite already rehosts to Shopify Files and
 * runs its own vision gate; the bytes are fetched back here so the ad gate
 * chain judges the same pixels that ship.
 */
async function generateOnSkinPlate(a: { plan: PlatePlan; prompt: string; format: AdFormat; refImageUrl: string; handle: string; conceptSlug: string; ideaId: number }): Promise<PlateResult> {
  const [{ getApprovedCastMembers }, { resolveCastReference }, { generateCastComposite }, { logImageCost }, pricing] = await Promise.all([
    import('~/lib/sanity.server'),
    import('~/lib/social-cast-reference.server'),
    import('~/lib/social-media.server'),
    import('~/lib/token-log.server'),
    import('~/lib/model-pricing.server'),
  ])
  const roster = await getApprovedCastMembers()
  if (!roster.length) throw new Error('no approved cast members returned')
  const member = roster[a.ideaId % roster.length]!
  const axes = a.plan.sceneAxes ?? {}
  const resolved = resolveCastReference({ member, cropScale: axes.cropScale, prompt: a.prompt, contactMode: axes.contactMode })
  const today = new Date().toISOString().slice(0, 10)
  const result = await generateCastComposite({
    prompt: resolved.prompt,
    handle: a.handle,
    mood: `ad-${a.conceptSlug}`.slice(0, 24),
    date: today,
    presenterImageUrl: resolved.presenterImageUrl,
    productImageUrl: a.refImageUrl,
    scale: 'true size relative to the hand, never enlarged',
    count: 1,
    aspectRatio: a.format.plateBucket === 'wide' ? '16:9' : '4:5',
    caller: 'ad-render',
    castSlugs: [member.slug],
    sceneAxes: {
      ...(axes.bodyZone ? { bodyZone: axes.bodyZone } : {}),
      ...(axes.contactMode ? { contactMode: axes.contactMode } : {}),
      ...(axes.cropScale ? { cropScale: axes.cropScale } : {}),
      ...(axes.sceneLocation ? { sceneLocation: axes.sceneLocation } : {}),
    },
    ...(resolved.extraReferenceUrls.length ? { extraImageUrls: [a.refImageUrl, ...resolved.extraReferenceUrls] } : { extraImageUrls: [a.refImageUrl] }),
  })
  let costUsd = 0
  for (const c of result.costs) {
    costUsd += pricing.estimateImageCostUsd(c.costKey, c.count)
    await logImageCost({ feature: FEATURE, model: c.costKey, count: c.count, caller: 'ad-render', sku: a.handle })
  }
  const url = result.urls[0]
  if (!url) throw new Error(`cast composite produced no usable frame (${(result.dropReasons ?? []).join('; ') || 'no reason given'})`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`could not fetch the cast frame: HTTP ${res.status}`)
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    model: result.costs[0]?.costKey ?? 'cast-composite',
    provider: 'cast',
    requestId: result.requestIds[0] ?? null,
    costUsd,
  }
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

export interface EnqueuedCreative { ideaId: number; creativeId: number; format: string; slogan: string | null; existing: boolean }
export interface EnqueueSkip { ideaId: number; format?: string; reason: string }
export interface EnqueueResult { created: EnqueuedCreative[]; skipped: EnqueueSkip[] }

function platformForLane(lane: string): string {
  return lane === 'meta' ? 'meta' : lane === 'google' ? 'google' : 'other'
}

/** Normalised slogans used by OTHER ideas' creatives in the last 30 days. */
async function recentSlogans(excludeIdeaId: number): Promise<Set<string>> {
  const since = new Date(Date.now() - SLOGAN_WINDOW_DAYS * 86_400_000)
  const rows = await db
    .select({ slogan: adCreatives.slogan })
    .from(adCreatives)
    .where(and(
      isNotNull(adCreatives.slogan),
      gte(adCreatives.createdAt, since),
      sql`${adCreatives.ideaId} is distinct from ${excludeIdeaId}`,
    ))
  return new Set(rows.map(r => normaliseSlogan(r.slogan ?? '')).filter(Boolean))
}

/**
 * Create one draft creative per (idea, format) for hearted ideas. Idempotent:
 * an idea that already has a row for a format returns that row. Ideas that are
 * not hearted (or already rendered, for a top-up) are skipped with the reason.
 * `autoPick` also lets unrated (proposed) ideas through, so the daily render
 * pass can produce creatives before the owner rates (owner direction
 * 2026-10-06). The idea keeps its status; only the owner's heart moves it.
 */
export async function enqueueRenders(ideaIds: readonly number[], actor: string, opts: { autoPick?: boolean } = {}): Promise<EnqueueResult> {
  const result: EnqueueResult = { created: [], skipped: [] }
  const { createAdCampaign } = await import('~/lib/team.server')
  for (const ideaId of [...new Set(ideaIds)]) {
    const [idea] = await db.select().from(adIdeas).where(eq(adIdeas.id, ideaId)).limit(1)
    if (!idea) { result.skipped.push({ ideaId, reason: 'idea_not_found' }); continue }
    const notEligible = enqueueSkipReason(idea.status, opts)
    if (notEligible) {
      result.skipped.push({ ideaId, reason: notEligible })
      continue
    }
    const formatIds = LANE_FORMATS[idea.lane] ?? []
    if (formatIds.length === 0) { result.skipped.push({ ideaId, reason: 'no_formats_for_lane' }); continue }
    if ((idea.headlines ?? []).length === 0) { result.skipped.push({ ideaId, reason: 'no_headlines' }); continue }

    const existing = await db.select().from(adCreatives).where(eq(adCreatives.ideaId, ideaId)).orderBy(asc(adCreatives.id))
    const byFormat = new Map(existing.map(c => [c.format, c]))
    const used = await recentSlogans(ideaId)
    let campaignId = existing[0]?.adCampaignId ?? null

    for (const [index, formatId] of formatIds.entries()) {
      const have = byFormat.get(formatId)
      if (have) {
        result.created.push({ ideaId, creativeId: have.id, format: formatId, slogan: have.slogan ?? null, existing: true })
        continue
      }
      const format = getAdFormat(formatId)
      const text = isTextFormat(formatId)
      const slogan = text
        ? null
        : pickSlogan({ headlines: idea.headlines ?? [], usedElsewhere: used, index, ...(format ? { maxChars: format.maxSloganChars } : {}) })
      if (!text && !slogan) { result.skipped.push({ ideaId, format: formatId, reason: 'no_fresh_slogan' }); continue }

      if (campaignId == null) {
        campaignId = await createAdCampaign({
          platform: platformForLane(idea.lane),
          name: idea.title.slice(0, 120),
          objective: 'traffic',
          policyCheck: idea.policyCheck,
          creativeJson: { ideaId, source: 'ad-studio-v2' },
        })
      }
      const [asset] = await db.insert(mediaAssets).values({
        kind: 'image',
        purpose: 'ad_static',
        blobUrl: text ? TEXT_ASSET_URL : PENDING_ASSET_URL,
        contentType: 'image/png',
        width: format?.width ?? null,
        height: format?.height ?? null,
        provenance: { ideaId, concept: idea.conceptSlug, format: formatId, state: 'placeholder' },
      }).returning({ id: mediaAssets.id })
      if (!asset) { result.skipped.push({ ideaId, format: formatId, reason: 'asset_insert_failed' }); continue }
      const [row] = await db.insert(adCreatives).values({
        adCampaignId: campaignId,
        format: formatId,
        assetId: asset.id,
        status: 'draft',
        policyCheck: idea.policyCheck,
        ideaId,
        lane: idea.lane,
        registerTier: idea.registerTier,
        slogan,
        width: format?.width ?? null,
        height: format?.height ?? null,
        hookCopy: slogan,
        exportPayload: buildExportPayload({ lane: idea.lane, format: formatId, slogan, headlines: idea.headlines ?? [], destinationUrl: idea.destinationUrl ?? null }),
        renderJson: { state: 'queued', enqueuedBy: actor, enqueuedAt: new Date().toISOString(), ...(opts.autoPick ? { autoPick: true } : {}) },
      }).returning({ id: adCreatives.id })
      if (!row) { result.skipped.push({ ideaId, format: formatId, reason: 'creative_insert_failed' }); continue }
      result.created.push({ ideaId, creativeId: row.id, format: formatId, slogan, existing: false })
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export type RenderStatus = 'draft' | 'blocked' | 'failed' | 'skipped'

export interface RenderOutcome {
  creativeId: number
  status: RenderStatus
  /** Why nothing was rendered: budget, in_progress, already_rendered, not_found. */
  skipped?: string
  error?: string
  gates?: GatesJson
  assetUrl?: string | null
  costUsd?: number
}

export interface RenderOptions {
  /** Re-render a creative that already has a finished image. */
  force?: boolean
}

function renderLedger(prev: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const base = prev && typeof prev === 'object' ? (prev as Record<string, unknown>) : {}
  return { ...base, ...patch }
}

async function patchCreative(id: number, set: Partial<typeof adCreatives.$inferInsert>): Promise<void> {
  await db.update(adCreatives).set({ ...set, updatedAt: new Date() }).where(eq(adCreatives.id, id))
}

/** Find a sibling creative of the same idea and plate bucket that already holds a plate. */
async function findSharedPlate(ideaId: number, bucket: string, excludeId: number): Promise<{ assetId: number; url: string; gates: GatesJson | null; model: string | null; requestId: string | null; costUsd: number } | null> {
  const siblings = await db
    .select({ id: adCreatives.id, format: adCreatives.format, plateAssetId: adCreatives.plateAssetId, gates: adCreatives.gatesJson })
    .from(adCreatives)
    .where(and(eq(adCreatives.ideaId, ideaId), isNotNull(adCreatives.plateAssetId), ne(adCreatives.id, excludeId)))
    .orderBy(desc(adCreatives.id))
  const match = siblings.find(s => getAdFormat(s.format)?.plateBucket === bucket)
  if (!match || match.plateAssetId == null) return null
  const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, match.plateAssetId)).limit(1)
  if (!asset || isPlaceholderUrl(asset.blobUrl)) return null
  return {
    assetId: asset.id,
    url: asset.blobUrl,
    gates: isGatesJson(match.gates) ? match.gates : null,
    model: asset.sourceModel ?? null,
    requestId: asset.providerRequestId ?? null,
    costUsd: 0,
  }
}

/**
 * Render one creative. Idempotent per id: a finished image is returned as is
 * unless `force`, a render started in the last 10 minutes is left alone, and a
 * blocked or failed row is re-rendered. Never throws for an expected refusal;
 * a gate block or a provider failure comes back in the outcome.
 */
export async function renderCreative(creativeId: number, opts: RenderOptions = {}, deps?: RenderDeps): Promise<RenderOutcome> {
  const d = deps ?? await defaultDeps()
  const [row] = await db.select().from(adCreatives).where(eq(adCreatives.id, creativeId)).limit(1)
  if (!row) return { creativeId, status: 'skipped', skipped: 'not_found' }
  if (row.ideaId == null || !row.lane) return { creativeId, status: 'skipped', skipped: 'not_a_v2_creative' }
  const [idea] = await db.select().from(adIdeas).where(eq(adIdeas.id, row.ideaId)).limit(1)
  if (!idea) return { creativeId, status: 'skipped', skipped: 'idea_not_found' }

  const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, row.assetId)).limit(1)
  const text = isTextFormat(row.format)
  const finished = text
    ? isGatesJson(row.gatesJson)
    : !!asset && !isPlaceholderUrl(asset.blobUrl)
  const ledger = (row.renderJson ?? {}) as Record<string, unknown>
  if (row.status === 'rendering') {
    const started = typeof ledger['startedAt'] === 'string' ? Date.parse(ledger['startedAt'] as string) : 0
    if (Date.now() - started < STALE_RENDERING_MS) return { creativeId, status: 'skipped', skipped: 'in_progress' }
  }
  // A blocked row is not retried by a pass: a gate block after a paid plate would otherwise
  // regenerate (and bill) the same plate every pass. Only an explicit force re-renders it.
  if (row.status === 'blocked' && !opts.force) {
    return { creativeId, status: 'blocked', skipped: 'already_blocked', assetUrl: asset && !isPlaceholderUrl(asset.blobUrl) ? asset.blobUrl : null, ...(isGatesJson(row.gatesJson) ? { gates: row.gatesJson } : {}) }
  }
  if (finished && !opts.force && (row.status === 'draft' || row.status === 'approved')) {
    return { creativeId, status: 'draft', skipped: 'already_rendered', assetUrl: asset?.blobUrl ?? null, ...(isGatesJson(row.gatesJson) ? { gates: row.gatesJson } : {}) }
  }

  const format = text ? null : getAdFormat(row.format)
  if (!text && !format) return fail(creativeId, ledger, `Unknown format ${row.format}`)
  const headlines = idea.headlines ?? []
  const slogan = row.slogan ?? null
  const concept = getConcept(idea.conceptSlug)
  const handle = (idea.products as AdIdeaProduct[] | null)?.[0]?.handle ?? null
  const usesPlate = !text && conceptUsesPlate(concept, idea.registerTier)

  // Budget, before any spend. Text rows cost nothing.
  if (usesPlate) {
    const remaining = await d.budgetRemainingCents()
    const needs = d.estimatePlateCents()
    if (remaining < needs) {
      await patchCreative(creativeId, { renderJson: renderLedger(ledger, { state: 'skipped', skipped: 'budget', remainingCents: remaining, at: new Date().toISOString() }) })
      return { creativeId, status: 'skipped', skipped: `budget: ${remaining}c left today, a plate needs about ${needs}c` }
    }
  }

  await patchCreative(creativeId, { status: 'rendering', renderJson: renderLedger(ledger, { state: 'rendering', startedAt: new Date().toISOString() }) })

  const gates: GatesJson = emptyGates()
  let plan: PlatePlan | null = null
  try {
    // Plan first: the lane ceiling throws before a cent is spent.
    if (usesPlate) {
      try {
        plan = planPlate({ lane: row.lane, registerTier: idea.registerTier, conceptSlug: idea.conceptSlug, ideaId: idea.id })
      } catch (err) {
        if (err instanceof AdLaneCeilingError) {
          gates.policy = { state: 'block', reason: err.message }
          gates.voice = voiceGate({ lane: row.lane, strings: [slogan ?? '', ...headlines] })
          return await finish(creativeId, row, idea, ledger, gates, { error: err.message, costUsd: 0 })
        }
        throw err
      }
    }

    // Text-only lane (Search): no image, headlines only.
    if (text) {
      gates.voice = voiceGate({ lane: row.lane, strings: headlines })
      gates.policy = policyGate({ lane: row.lane, registerTier: idea.registerTier, slogan: null, headlines, body: idea.body ?? [], destinationUrl: idea.destinationUrl ?? null, plan: null, vision: null, format: row.format })
      gates.vision = notRun('Search text ad, no image.')
      gates.product = notRun('Search text ad, no image.')
      gates.text = notRun('Search text ad, no image.')
      return await finish(creativeId, row, idea, ledger, gates, { costUsd: 0 })
    }

    if (!slogan) return fail(creativeId, ledger, 'Creative has no slogan')
    const fmt = format!
    const layout: LayoutTemplate = chooseLayout(concept, fmt, usesPlate)

    // Copy-only gates first. A slogan the voice or policy gate will block is blocked before
    // a plate is paid for, so nothing is spent on a creative that cannot ship.
    const preVoice = voiceGate({ lane: row.lane, strings: [slogan, ...headlines] })
    const prePolicy = policyGate({
      lane: row.lane, registerTier: idea.registerTier, slogan, headlines, body: idea.body ?? [],
      destinationUrl: idea.destinationUrl ?? null, plan, vision: null, format: row.format,
    })
    if (preVoice.state === 'block' || prePolicy.state === 'block') {
      gates.voice = preVoice
      gates.policy = prePolicy
      gates.vision = notRun('Blocked on copy before any image was generated.')
      gates.product = notRun('Blocked on copy before any image was generated.')
      gates.text = notRun('Blocked on copy before any image was generated.')
      return await finish(creativeId, row, idea, ledger, gates, { error: 'blocked before spend', costUsd: 0 })
    }

    let plateBuf: Buffer | null = null
    let plateAssetId: number | null = null
    let plateVision: VisionVerdict | null = null
    let plateFidelity: ProductFidelityVerdict | null = null
    let plateRequestId: string | null = null
    let plateModel: string | null = null
    let plateNote: string | undefined
    let costUsd = 0
    let productTitle = 'the product'

    if (usesPlate) {
      if (!handle) {
        gates.policy = { state: 'block', reason: 'The idea names no product, so there is nothing real to put in the frame.' }
        return await finish(creativeId, row, idea, ledger, gates, { error: 'no product on the idea', costUsd: 0 })
      }
      const product = await d.getProduct(handle)
      if (!product || product.sellable !== true) {
        gates.policy = { state: 'block', reason: product ? `Product "${handle}" is not sellable right now.` : `Product "${handle}" is not in the catalog (archived or draft).` }
        return await finish(creativeId, row, idea, ledger, gates, { error: 'product not sellable', costUsd: 0 })
      }
      if (!product.referenceImageUrl) return fail(creativeId, ledger, `Product "${handle}" has no reference image (real photography is a hard gate)`)
      productTitle = product.title
      const refUrl = product.referenceImageUrl

      const shared = await findSharedPlate(idea.id, fmt.plateBucket, creativeId)
      if (shared) {
        const res = await fetch(shared.url)
        if (!res.ok) throw new Error(`could not fetch the shared plate: HTTP ${res.status}`)
        plateBuf = Buffer.from(await res.arrayBuffer())
        plateAssetId = shared.assetId
        plateModel = shared.model
        plateRequestId = shared.requestId
        plateNote = 'plate shared with a sibling size'
        if (shared.gates) {
          gates.vision = shared.gates.vision
          gates.product = shared.gates.product
        }
      } else {
        const prompt = buildPlatePrompt({ plan: plan!, conceptSlug: idea.conceptSlug, ideaId: idea.id, productTitle, format: fmt })
        const gen = await d.generatePlate({ plan: plan!, prompt, format: fmt, refImageUrl: refUrl, handle, conceptSlug: idea.conceptSlug, ideaId: idea.id })
        costUsd += gen.costUsd
        plateNote = gen.note
        if (!gen.buffer) return fail(creativeId, ledger, 'The image provider returned no plate (blocked or unavailable)', costUsd)
        plateBuf = gen.buffer
        plateModel = gen.model
        plateRequestId = gen.requestId
        const plateUp = await d.upload(`ads/${row.adCampaignId}/plate-i${idea.id}-${fmt.plateBucket}-${Date.now()}.jpg`, gen.buffer, 'image/jpeg')
        const [pa] = await db.insert(mediaAssets).values({
          kind: 'image',
          purpose: 'ad_static',
          blobUrl: plateUp.url,
          contentType: 'image/jpeg',
          sourceModel: gen.model,
          costUsd: String(gen.costUsd),
          providerRequestId: gen.requestId,
          provenance: { kind: 'plate', ideaId: idea.id, concept: idea.conceptSlug, bucket: fmt.plateBucket, prompt, providerRequestId: gen.requestId, archetype: plan!.archetype },
        }).returning({ id: mediaAssets.id })
        plateAssetId = pa?.id ?? null
        // Gates judge the plate once, text-free, before the slogan exists.
        plateVision = await d.gateVision(gen.buffer)
        plateFidelity = await d.gateFidelity(gen.buffer, refUrl)
        gates.vision = { ...visionGateResult(plateVision), requestId: gen.requestId }
        gates.product = fidelityGateResult(plateFidelity)
      }
    } else {
      gates.vision = notRun('Typographic card, no generated image.')
      gates.product = notRun('Typographic card, no product in frame.')
    }

    const composed = await d.compose({
      template: layout,
      width: fmt.width,
      height: fmt.height,
      slogan,
      kicker: concept.kicker,
      ground: plan?.ground ?? (idea.id % 2 === 0 ? 'coral-soft' : 'plum-soft'),
      plate: plateBuf,
      specLines: (idea.body ?? []).slice(0, 3),
    })

    gates.voice = voiceGate({ lane: row.lane, strings: [slogan, ...headlines] })
    gates.policy = policyGate({
      lane: row.lane, registerTier: idea.registerTier, slogan, headlines, body: idea.body ?? [],
      destinationUrl: idea.destinationUrl ?? null, plan, vision: plateVision, format: row.format,
    })
    // A shared plate was judged once already, so its text verdict is carried by the vision pass.
    gates.text = textGateResult({
      plateLegibleText: plateVision?.legibleText ?? '',
      hasPlate: usesPlate,
      fit: composed.metrics,
    })

    const finalUp = await d.upload(`ads/${row.adCampaignId}/c${creativeId}-${fmt.id.replace(':', 'x')}-${Date.now()}.png`, composed.png, 'image/png')
    // The placeholder row becomes the creative's own asset, with provenance.
    await db.update(mediaAssets).set({
      blobUrl: finalUp.url,
      contentType: 'image/png',
      width: fmt.width,
      height: fmt.height,
      sourceModel: plateModel,
      costUsd: String(costUsd),
      providerRequestId: plateRequestId,
      provenance: {
        kind: 'creative', ideaId: idea.id, concept: idea.conceptSlug, format: fmt.id, layout,
        plateAssetId, providerRequestId: plateRequestId, lane: row.lane, slogan,
      },
    }).where(eq(mediaAssets.id, row.assetId))

    return await finish(creativeId, row, idea, ledger, gates, {
      costUsd, layout, plateAssetId, plateModel, plateRequestId, plateNote, assetUrl: finalUp.url,
      fit: composed.metrics,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[ad-render] creative ${creativeId} failed`, err)
    return fail(creativeId, ledger, message)
  }
}

async function fail(creativeId: number, prev: Record<string, unknown>, error: string, costUsd = 0): Promise<RenderOutcome> {
  await patchCreative(creativeId, { status: 'failed', renderJson: renderLedger(prev, { state: 'failed', error, failedAt: new Date().toISOString(), costUsd }) })
  return { creativeId, status: 'failed', error, costUsd }
}

interface FinishExtra {
  error?: string
  costUsd: number
  layout?: LayoutTemplate
  plateAssetId?: number | null
  plateModel?: string | null
  plateRequestId?: string | null
  plateNote?: string | undefined
  assetUrl?: string
  fit?: unknown
}

async function finish(
  creativeId: number,
  row: typeof adCreatives.$inferSelect,
  idea: typeof adIdeas.$inferSelect,
  prev: Record<string, unknown>,
  gates: GatesJson,
  extra: FinishExtra,
): Promise<RenderOutcome> {
  const status = aggregateGates(gates)
  await patchCreative(creativeId, {
    status,
    gatesJson: gates as unknown as Record<string, unknown>,
    ...(extra.layout ? { layoutTemplate: extra.layout } : {}),
    ...(extra.plateAssetId != null ? { plateAssetId: extra.plateAssetId } : {}),
    exportPayload: buildExportPayload({
      lane: row.lane ?? idea.lane, format: row.format, slogan: row.slogan ?? null,
      headlines: idea.headlines ?? [], destinationUrl: idea.destinationUrl ?? null,
    }),
    renderJson: renderLedger(prev, {
      state: status === 'blocked' ? 'blocked' : 'rendered',
      renderedAt: new Date().toISOString(),
      costUsd: extra.costUsd,
      model: extra.plateModel ?? null,
      providerRequestId: extra.plateRequestId ?? null,
      ...(extra.error ? { error: extra.error } : {}),
      ...(extra.plateNote ? { note: extra.plateNote } : {}),
      ...(extra.fit ? { fit: extra.fit } : {}),
    }),
  })
  await markIdeaRenderedIfComplete(idea.id)
  return { creativeId, status, gates, assetUrl: extra.assetUrl ?? null, costUsd: extra.costUsd, ...(extra.error ? { error: extra.error } : {}) }
}

/**
 * Move a hearted idea to rendered once every creative row has settled (draft
 * or blocked, none queued, rendering or failed) and at least one is usable.
 * Only ever moves hearted to rendered, so it never overrides an owner decision.
 */
export async function markIdeaRenderedIfComplete(ideaId: number): Promise<boolean> {
  const rows = await db
    .select({ status: adCreatives.status, render: adCreatives.renderJson })
    .from(adCreatives)
    .where(eq(adCreatives.ideaId, ideaId))
  if (rows.length === 0) return false
  const settled = rows.every(r => {
    const state = (r.render as Record<string, unknown> | null)?.['state']
    return (r.status === 'draft' || r.status === 'blocked') && (state === 'rendered' || state === 'blocked')
  })
  if (!settled || !rows.some(r => r.status === 'draft')) return false
  const updated = await db
    .update(adIdeas)
    .set({ status: 'rendered', updatedAt: new Date() })
    .where(and(eq(adIdeas.id, ideaId), eq(adIdeas.status, 'hearted')))
    .returning({ id: adIdeas.id })
  return updated.length > 0
}

// ---------------------------------------------------------------------------
// Convenience for the admin "Render now" button and the team route
// ---------------------------------------------------------------------------

export const RENDER_CALL_CAP = 12

export interface RenderBatchResult {
  outcomes: RenderOutcome[]
  /** Creatives not started because the wall-clock budget ran out. They stay queued. */
  deferred: number[]
}

/** Render sequentially, stopping to start new ones once `budgetMs` has passed. */
export async function renderCreatives(ids: readonly number[], opts: { budgetMs?: number; force?: boolean } = {}, deps?: RenderDeps): Promise<RenderBatchResult> {
  const started = Date.now()
  const out: RenderBatchResult = { outcomes: [], deferred: [] }
  const capped = ids.slice(0, RENDER_CALL_CAP)
  const d = deps ?? await defaultDeps()
  for (const id of capped) {
    if (opts.budgetMs != null && Date.now() - started > opts.budgetMs) { out.deferred.push(id); continue }
    out.outcomes.push(await renderCreative(id, { ...(opts.force ? { force: true } : {}) }, d))
  }
  out.deferred.push(...ids.slice(RENDER_CALL_CAP))
  return out
}

export interface RenderIdeaResult extends RenderBatchResult { enqueue: EnqueueResult }

/** Enqueue a hearted idea and render its creatives. The "Render now" path. */
export async function renderIdeaNow(ideaId: number, actor: string, opts: { budgetMs?: number } = {}): Promise<RenderIdeaResult> {
  const enqueue = await enqueueRenders([ideaId], actor)
  const ids = enqueue.created.map(c => c.creativeId)
  const rows = ids.length
    ? await db.select({ id: adCreatives.id, status: adCreatives.status }).from(adCreatives).where(inArray(adCreatives.id, ids))
    : []
  // Skip rows that are already finished drafts; renderCreative also guards, this just saves a read per row.
  const todo = rows.map(r => r.id)
  const batch = await renderCreatives(todo, opts.budgetMs != null ? { budgetMs: opts.budgetMs } : {})
  return { enqueue, ...batch }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface CreativeStatusRow {
  creativeId: number
  ideaId: number | null
  format: string
  lane: string | null
  status: string
  slogan: string | null
  assetUrl: string | null
  gates: GatesJson | null
  render: Record<string, unknown> | null
}

export async function getCreativeStatus(q: { creativeIds?: number[]; ideaId?: number }): Promise<CreativeStatusRow[]> {
  const cond = q.creativeIds?.length
    ? inArray(adCreatives.id, q.creativeIds.slice(0, 100))
    : q.ideaId != null ? eq(adCreatives.ideaId, q.ideaId) : null
  if (!cond) return []
  const rows = await db
    .select({ c: adCreatives, url: mediaAssets.blobUrl })
    .from(adCreatives)
    .leftJoin(mediaAssets, eq(mediaAssets.id, adCreatives.assetId))
    .where(cond)
    .orderBy(asc(adCreatives.id))
  return rows.map(r => ({
    creativeId: r.c.id,
    ideaId: r.c.ideaId ?? null,
    format: r.c.format,
    lane: r.c.lane ?? null,
    status: r.c.status,
    slogan: r.c.slogan ?? null,
    assetUrl: isPlaceholderUrl(r.url) ? null : r.url,
    gates: isGatesJson(r.c.gatesJson) ? r.c.gatesJson : null,
    render: (r.c.renderJson as Record<string, unknown> | null) ?? null,
  }))
}

export { GATE_ORDER, TEXT_FORMAT_ID }
export type { GateResult }
