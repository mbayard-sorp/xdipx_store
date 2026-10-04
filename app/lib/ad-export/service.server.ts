/**
 * Export service: loads subjects from the database, runs the lane's exporter,
 * stores the file, and writes the result onto ad_creatives.export_payload.
 *
 *   buildExport({ creativeIds } | { ideaId }, actor)   the build(creativeIds | ideaId) facade
 *   getExportStatus(target)
 *   pushCreativeToMeta(creativeId, actor)              admin route only, valve gated
 *
 * What lives in export_payload after a build (PR-G reads destination_url and
 * utm_content from it, PR-C wrote the skeleton keys):
 *   status 'ready', exportedAt, exportError (absent on success),
 *   destination_url (UTM'd), utm_content,
 *   export  { exporter, filename, contentType, url, bytes, summary, builtAt, builtBy, variant }
 *   meta    { payload, preview }           Meta lane only
 *   push    { adId, campaignId, adSetId, creativeId, imageHash, pushedAt }   after a real push
 *
 * Storage choice: Vercel Blob, same store and helper as the rendered PNGs
 * (blob.server.ts), URL recorded in export_payload.export.url. No new table and
 * no migration: a Search CSV is a few KB, a banner zip a few hundred KB, the
 * Meta payload JSON is stored inline (it is the payload, not a file).
 */
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { adCampaigns, adCreativeFeedback, adCreatives, adIdeas, mediaAssets } from '../../../db/schema'
import { isGatesJson } from '~/lib/ad-render-rules'
import { isPlaceholderUrl } from '~/lib/ad-render.server'
import { getAdsMediaDailyCapCents, getAdsSpendEnabled } from '~/lib/ad-settings.server'
import { isTextFormat } from '~/lib/ad-formats'
import { ExportRefusal, type ExportBuild, type ExportCreative, type ExportIdea } from './common'
import { getExporter, type ExportContext, type LoadedSubjects } from './registry.server'
import { exporterForLane, type StoredExportFile } from './types'
import { MetaPushError, isMetaDraftPayload } from './meta-payload'
import { metaCredentialsFromEnv, type MetaPushDeps, type MetaPushResult } from './meta-push.server'

export type ExportTarget = { creativeIds: number[]; ideaId?: undefined } | { ideaId: number; creativeIds?: undefined }

export interface ServiceDeps {
  store(pathname: string, bytes: Buffer, contentType: string): Promise<{ url: string }>
  fetchBytes(url: string): Promise<Buffer>
  dailyCapCents(): Promise<number>
  inSubset?: ((handle: string) => boolean) | null
  pageIdConfigured(): boolean
  now?(): Date
}

async function defaultDeps(): Promise<ServiceDeps> {
  const blob = await import('~/lib/blob.server')
  return {
    async store(pathname, bytes, contentType) {
      if (!blob.blobConfigured()) throw new ExportRefusal('blob_not_configured', 'Blob storage is not configured, so the export file cannot be stored.')
      return blob.blobPut(pathname, bytes, { contentType })
    },
    fetchBytes: blob.blobFetchToBuffer,
    dailyCapCents: getAdsMediaDailyCapCents,
    inSubset: null,
    pageIdConfigured: () => metaCredentialsFromEnv().pageId != null,
  }
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

type CreativeRow = {
  c: typeof adCreatives.$inferSelect
  url: string | null
  verdict: string | null
  idea: typeof adIdeas.$inferSelect
}

function toIdea(i: typeof adIdeas.$inferSelect): ExportIdea {
  return {
    id: i.id, lane: i.lane, registerTier: i.registerTier, conceptSlug: i.conceptSlug, title: i.title, oneLiner: i.oneLiner ?? null,
    products: i.products ?? [], headlines: i.headlines ?? [], body: i.body ?? [], audience: i.audience ?? null,
    destinationUrl: i.destinationUrl ?? null, breakEven: i.breakEvenJson ?? null, policyCheck: i.policyCheck, status: i.status,
  }
}

async function plateOnSkin(plateIds: number[]): Promise<Set<number>> {
  if (plateIds.length === 0) return new Set()
  const rows = await db.select({ id: mediaAssets.id, p: mediaAssets.provenance }).from(mediaAssets).where(inArray(mediaAssets.id, plateIds))
  return new Set(rows.filter(r => (r.p as Record<string, unknown> | null)?.['archetype'] === 'on-skin').map(r => r.id))
}

function toCreative(r: CreativeRow, onSkinPlates: Set<number>): ExportCreative {
  return {
    id: r.c.id,
    ideaId: r.c.ideaId!,
    lane: r.c.lane ?? r.idea.lane,
    registerTier: r.c.registerTier ?? r.idea.registerTier,
    format: r.c.format,
    width: r.c.width ?? null,
    height: r.c.height ?? null,
    slogan: r.c.slogan ?? null,
    status: r.c.status,
    gates: isGatesJson(r.c.gatesJson) ? r.c.gatesJson : null,
    assetUrl: isPlaceholderUrl(r.url) ? null : r.url,
    onSkin: r.c.plateAssetId != null && onSkinPlates.has(r.c.plateAssetId),
  }
}

async function selectCreatives(where: ReturnType<typeof inArray> | ReturnType<typeof eq>): Promise<CreativeRow[]> {
  const rows = await db
    .select({ c: adCreatives, url: mediaAssets.blobUrl, verdict: adCreativeFeedback.verdict, idea: adIdeas })
    .from(adCreatives)
    .innerJoin(mediaAssets, eq(mediaAssets.id, adCreatives.assetId))
    .innerJoin(adIdeas, eq(adIdeas.id, adCreatives.ideaId))
    .leftJoin(adCreativeFeedback, eq(adCreativeFeedback.creativeId, adCreatives.id))
    .where(where)
    .orderBy(asc(adCreatives.id))
  return rows
}

const IDEA_OK_FOR_TEXT = new Set(['hearted', 'rendered'])

export async function loadSubjects(target: ExportTarget): Promise<LoadedSubjects> {
  let rows: CreativeRow[]
  let ideaRows: Array<typeof adIdeas.$inferSelect> = []

  if (target.ideaId != null) {
    const [idea] = await db.select().from(adIdeas).where(eq(adIdeas.id, target.ideaId)).limit(1)
    if (!idea) throw new ExportRefusal('not_found', `Idea #${target.ideaId} was not found.`)
    ideaRows = [idea]
    rows = await selectCreatives(eq(adCreatives.ideaId, idea.id))
  } else {
    const ids = [...new Set(target.creativeIds)]
    if (ids.length === 0) throw new ExportRefusal('no_subjects', 'Pass creativeIds or ideaId.')
    rows = await selectCreatives(inArray(adCreatives.id, ids))
    const missing = ids.filter(id => !rows.some(r => r.c.id === id))
    if (missing.length) throw new ExportRefusal('not_found', `Creative${missing.length === 1 ? '' : 's'} not found: ${missing.map(m => `#${m}`).join(', ')}.`)
    const ideaIds = [...new Set(rows.map(r => r.idea.id))]
    ideaRows = ideaIds.map(id => rows.find(r => r.idea.id === id)!.idea)
  }

  const lanes = [...new Set(ideaRows.map(i => i.lane))]
  if (lanes.length !== 1) throw new ExportRefusal('mixed_lanes', `Export one lane at a time (got ${lanes.join(', ') || 'none'}).`)
  const lane = lanes[0]!
  if (!exporterForLane(lane)) throw new ExportRefusal('policy', `Lane ${lane} has no exporter.`)

  const text = lane === 'google' || lane === 'microsoft'
  let chosen: CreativeRow[]
  if (text) {
    for (const i of ideaRows) {
      const heartedCreative = rows.some(r => r.idea.id === i.id && r.verdict === 'up')
      if (!IDEA_OK_FOR_TEXT.has(i.status) && !heartedCreative) {
        throw new ExportRefusal('not_hearted', `Idea #${i.id} is ${i.status}. Heart it first, then export.`)
      }
    }
    chosen = rows.filter(r => isTextFormat(r.c.format))
  } else {
    const candidates = target.ideaId != null ? rows.filter(r => r.verdict === 'up') : rows
    const notHearted = candidates.filter(r => r.verdict !== 'up')
    if (notHearted.length) throw new ExportRefusal('not_hearted', `Creative${notHearted.length === 1 ? '' : 's'} ${notHearted.map(r => `#${r.c.id}`).join(', ')} not hearted. Heart ${notHearted.length === 1 ? 'it' : 'them'} first.`)
    if (candidates.length === 0) throw new ExportRefusal('not_hearted', 'No hearted creatives on this idea yet.')
    chosen = candidates
  }
  const skin = await plateOnSkin(chosen.map(r => r.c.plateAssetId).filter((x): x is number => x != null))
  return { lane, ideas: ideaRows.map(toIdea), creatives: chosen.map(r => toCreative(r, skin)) }
}

// ---------------------------------------------------------------------------
// Build and store
// ---------------------------------------------------------------------------

export interface BuiltExport {
  lane: string
  exporter: string
  filename: string
  contentType: string
  url: string | null
  bytes: number
  summary: ExportBuild['summary']
  payload?: unknown
  creativeIds: number[]
  variant?: string
}

function payloadObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {}
}

async function writeResult(ids: number[], patch: (existing: Record<string, unknown>, id: number) => Record<string, unknown>): Promise<void> {
  if (ids.length === 0) return
  const rows = await db.select({ id: adCreatives.id, p: adCreatives.exportPayload }).from(adCreatives).where(inArray(adCreatives.id, ids))
  for (const r of rows) {
    await db.update(adCreatives).set({ exportPayload: patch(payloadObject(r.p), r.id), updatedAt: new Date() }).where(eq(adCreatives.id, r.id))
  }
}

/** The build(creativeIds | ideaId) facade the admin route, the team route and the Ideas tab call. */
export async function buildExport(target: ExportTarget, actor: string, depsIn?: Partial<ServiceDeps>): Promise<BuiltExport> {
  const deps: ServiceDeps = { ...(await defaultDeps()), ...depsIn }
  let subjects: LoadedSubjects | null = null
  try {
    subjects = await loadSubjects(target)
    const exporter = getExporter(subjects.lane)!
    const ctx: ExportContext = {
      dailyCapCents: await deps.dailyCapCents(),
      fetchBytes: deps.fetchBytes,
      inSubset: deps.inSubset ?? null,
      pageIdConfigured: deps.pageIdConfigured(),
      ...(deps.now ? { now: deps.now() } : {}),
    }
    const built = await exporter.build(subjects, ctx)
    const builtAt = (deps.now ? deps.now() : new Date()).toISOString()

    let url: string | null = null
    let size = 0
    if (built.bytes) {
      const stored = await deps.store(`ad-exports/${subjects.lane}/${built.filename}`, built.bytes, built.contentType)
      url = stored.url
      size = built.bytes.length
    } else if (built.payloadJson !== undefined) {
      size = Buffer.byteLength(JSON.stringify(built.payloadJson))
    }
    const file: StoredExportFile = {
      exporter: built.exporter, filename: built.filename, contentType: built.contentType, url, bytes: size,
      summary: built.summary, builtAt, builtBy: actor, ...(built.variant ? { variant: built.variant } : {}),
    }
    const ids = subjects.creatives.map(c => c.id)
    await writeResult(ids, (existing, id) => {
      const { exportError: _drop, ...rest } = existing
      const dest = built.destinations?.[id]
      return {
        ...rest,
        status: 'ready',
        exportedAt: builtAt,
        ...(dest ? { destination_url: dest, utm_content: new URL(dest).searchParams.get('utm_content') } : {}),
        export: file,
        ...(built.payloadJson !== undefined ? { meta: { payload: built.payloadJson } } : {}),
      }
    })
    return {
      lane: subjects.lane, exporter: built.exporter, filename: built.filename, contentType: built.contentType, url, bytes: size,
      summary: built.summary, creativeIds: ids, ...(built.payloadJson !== undefined ? { payload: built.payloadJson } : {}),
      ...(built.variant ? { variant: built.variant } : {}),
    }
  } catch (err) {
    const message = err instanceof ExportRefusal ? err.issues.slice(0, 4).join(' ') : err instanceof Error ? err.message : String(err)
    const known = subjects?.creatives.map(c => c.id) ?? (target.creativeIds ?? [])
    if (known.length) {
      await writeResult(known, existing => ({ ...existing, exportError: message.slice(0, 600) })).catch(() => {})
    }
    throw err
  }
}

export interface ExportStatusRow {
  creativeId: number
  ideaId: number | null
  lane: string | null
  state: 'not_built' | 'ready' | 'failed' | 'in_platform'
  filename: string | null
  url: string | null
  error: string | null
  externalAdId: string | null
  builtAt: string | null
}

export async function getExportStatus(target: ExportTarget): Promise<ExportStatusRow[]> {
  const where = target.ideaId != null ? eq(adCreatives.ideaId, target.ideaId) : inArray(adCreatives.id, [...new Set(target.creativeIds)])
  const rows = await db.select({ id: adCreatives.id, ideaId: adCreatives.ideaId, lane: adCreatives.lane, p: adCreatives.exportPayload, ext: adCreatives.externalAdId }).from(adCreatives).where(where).orderBy(asc(adCreatives.id))
  return rows.map(r => {
    const p = payloadObject(r.p)
    const file = p['export'] as StoredExportFile | undefined
    const err = typeof p['exportError'] === 'string' ? (p['exportError'] as string) : null
    return {
      creativeId: r.id, ideaId: r.ideaId ?? null, lane: r.lane ?? null,
      state: r.ext ? 'in_platform' : err ? 'failed' : file && p['status'] === 'ready' ? 'ready' : 'not_built',
      filename: file?.filename ?? null, url: file?.url ?? null, error: err, externalAdId: r.ext ?? null, builtAt: file?.builtAt ?? null,
    }
  })
}

/** The stored Meta payload for the "View payload" sheet. */
export async function getMetaPayload(creativeId: number): Promise<{ payload: unknown; preview: string[]; warnings: string[] } | null> {
  const [row] = await db.select({ p: adCreatives.exportPayload }).from(adCreatives).where(eq(adCreatives.id, creativeId)).limit(1)
  const meta = payloadObject(payloadObject(row?.p)['meta'])
  const payload = meta['payload']
  if (!isMetaDraftPayload(payload)) return null
  return { payload, preview: payload.preview, warnings: payload.warnings }
}

// ---------------------------------------------------------------------------
// Push (admin route action only)
// ---------------------------------------------------------------------------

export async function defaultPushDeps(): Promise<MetaPushDeps> {
  const { blobFetchToBuffer } = await import('~/lib/blob.server')
  return { spendEnabled: getAdsSpendEnabled, credentials: () => metaCredentialsFromEnv(), fetchBytes: blobFetchToBuffer }
}

/**
 * Create the paused draft in Meta for one creative. The valve is checked before
 * the database is read. Never exposed to the team token.
 */
export async function pushCreativeToMeta(creativeId: number, actor: string, depsIn?: Partial<MetaPushDeps>): Promise<MetaPushResult> {
  const deps: MetaPushDeps = { ...(await defaultPushDeps()), ...depsIn }
  if (!(await deps.spendEnabled())) throw new MetaPushError('spend_disabled', 'Spend is off (ads_spend_enabled is false). Nothing was sent to Meta.')

  const [row] = await db.select({ c: adCreatives }).from(adCreatives).where(eq(adCreatives.id, creativeId)).limit(1)
  if (!row) throw new MetaPushError('not_exportable', `Creative #${creativeId} was not found.`)
  if (row.c.lane !== 'meta') throw new MetaPushError('not_exportable', 'Only Meta creatives have a paused draft push.')
  if (row.c.externalAdId) throw new MetaPushError('already_pushed', `Creative #${creativeId} is already in Meta as ad ${row.c.externalAdId}.`)
  const p = payloadObject(row.c.exportPayload)
  const payload = payloadObject(p['meta'])['payload']
  if (!isMetaDraftPayload(payload)) throw new MetaPushError('not_exportable', 'No ready Meta payload on this creative. Build it first.')

  // Reuse the campaign and ad set a sibling size already made.
  const siblings = row.c.ideaId != null
    ? await db.select({ p: adCreatives.exportPayload }).from(adCreatives).where(and(eq(adCreatives.ideaId, row.c.ideaId)))
    : []
  let campaignId: string | null = null
  let adSetId: string | null = null
  for (const s of siblings) {
    const push = payloadObject(payloadObject(s.p)['push'])
    const partial = payloadObject(push['partial'])
    campaignId ??= (typeof push['campaignId'] === 'string' ? push['campaignId'] : typeof partial['campaignId'] === 'string' ? (partial['campaignId'] as string) : null)
    adSetId ??= (typeof push['adSetId'] === 'string' ? push['adSetId'] : typeof partial['adSetId'] === 'string' ? (partial['adSetId'] as string) : null)
  }

  const push = getExporter('meta')!.push!
  try {
    const res = await push(payload, creativeId, { campaignId, adSetId }, deps)
    await db.update(adCreatives).set({
      externalAdId: res.externalAdId,
      exportPayload: { ...p, push: { ...res, pushedBy: actor }, pushError: undefined },
      updatedAt: new Date(),
    }).where(eq(adCreatives.id, creativeId))
    await db.update(adCampaigns).set({ externalCampaignId: res.campaignId.slice(0, 64), plannedDailyCents: payload.adSet.daily_budget, updatedAt: new Date() }).where(eq(adCampaigns.id, row.c.adCampaignId))
    return res
  } catch (err) {
    if (err instanceof MetaPushError && err.code === 'api_error') {
      await db.update(adCreatives).set({
        exportPayload: { ...p, push: { partial: err.partial, error: err.message, at: new Date().toISOString() } },
        updatedAt: new Date(),
      }).where(eq(adCreatives.id, creativeId))
    }
    throw err
  }
}
