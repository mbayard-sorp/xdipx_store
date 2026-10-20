/**
 * Meta mutations for the ads control plane (plan §3.1, §5, §9.4, phase 5a,
 * ticket #16431). PROTECTED PATH: the owner merges every change to this file.
 *
 * This is the only code that writes to a live Meta ad, ad set or campaign.
 * It is reached from one place, the ledger dispatcher in
 * channels/apply.server.ts, and only after the row has passed the valves,
 * the tier and the caps there. The checks below are the second line: they
 * hold even if a caller skips the dispatcher.
 *
 * Verbs:
 * - pause: POST /<id> status=PAUSED on an ad, ad set or campaign.
 * - resume: POST /<id> status=ACTIVE, and only for an entity the ledger shows
 *   the machine paused while it was ACTIVE. docs/ads-policy.md M4 says only
 *   the owner takes a Meta ad live, so a resume may undo our own pause and
 *   nothing else. Anything else is refused with m4_resume_refused.
 * - set_budget: POST /<id> daily_budget=<minor units> on a campaign or ad set.
 *   Refused when the sum of daily budgets across live campaigns and ad sets
 *   would pass ads_media_daily_cap_cents, when it raises spend without an
 *   approved approve-tier row, and when the step is past
 *   ads_budget_max_step_pct without one.
 * - halt_all: pause every ACTIVE campaign in the account. One ledger row,
 *   one POST per campaign.
 * - update_creative stays ChannelNotEnabledError.
 *
 * metaCreatePaused (phase 6a, ticket #16434) creates a paused draft: image,
 * campaign, ad set, ad creative and ad, every object PAUSED. It is the only
 * Graph writer for drafts and is reached through dispatchCreatePaused.
 *
 * Every real write is followed by syncAfterWrite for the ids it touched, so
 * the mirror shows the change before the request ends. dryRun builds the
 * exact Graph requests and returns them without sending anything.
 */
import { destinationOkForMeta } from '~/lib/ad-copy-gates.server'
import { MetaPushError, isMetaDraftPayload, type MetaDraftPayload } from '~/lib/ad-export/meta-payload'
import { budgetWithinStep, type MirrorBudgetRow } from '../apply-core'
import { ChannelNotEnabledError, MutationRefusedError, type MutationRefusalCode } from '../errors'
import type { ChannelId, CreatedRefs, EntityLevel, MutationRequest, MutationResult, PolicyMirrorRow, PolicyVerdict } from '../types'
import { metaCredentialsFromEnv, type MetaCredentials } from './credentials'
import { GraphError, createGraphClient, type GraphClient, type GraphJson } from './graph.server'

/** One Graph write, exactly as it would be sent. */
export interface GraphWrite {
  method: 'POST'
  path: string
  body: Record<string, string | number>
}

export interface MetaMutateResult extends MutationResult {
  dryRun: boolean
  /** The writes this call sent, or would send under dryRun. */
  requests: GraphWrite[]
  touchedIds: string[]
}

export interface MetaMutateOptions {
  /** Build the Graph requests and return them. Reads still run; nothing is written. */
  dryRun?: boolean
}

/** What metaMutate reads from our own database. */
export interface MetaMutateStore {
  /** The mirrored ad_platform_entities row for one Meta id, or null. */
  entity(externalId: string): Promise<MirrorBudgetRow | null>
  /** Every Meta campaign and ad set the mirror shows with status ACTIVE. */
  liveBudgetRows(): Promise<MirrorBudgetRow[]>
  /**
   * True when ad_actions holds an applied automatic pause of this id taken
   * while it was ACTIVE: a pause row whose before.status was ACTIVE, or a
   * halt_all row whose after.pausedIds lists it.
   */
  hadAutomatedPause(externalId: string): Promise<boolean>
}

export interface MetaMutateSettings {
  dailyCapCents: number
  budgetMaxStepPct: number
}

export interface MetaMutateDeps {
  graph?: GraphClient
  accountId?: () => string | null
  store?: MetaMutateStore
  settings?: () => Promise<MetaMutateSettings>
  syncAfterWrite?: (platform: ChannelId, externalIds: string[]) => Promise<unknown>
}

const CHANNEL: ChannelId = 'meta'
const STATUS_LEVELS = new Set<EntityLevel>(['ad', 'adset', 'campaign'])
const BUDGET_LEVELS = new Set<EntityLevel>(['adset', 'campaign'])

// ---------------------------------------------------------------------------
// Default dependencies, loaded lazily so tests never touch the database.
// ---------------------------------------------------------------------------

async function drizzleEntity(externalId: string): Promise<MirrorBudgetRow | null> {
  const [{ db }, { adPlatformEntities }, { and, eq }] = await Promise.all([
    import('~/lib/db.server'), import('../../../../../db/schema'), import('drizzle-orm'),
  ])
  const rows = await db.select({
    platform: adPlatformEntities.platform,
    level: adPlatformEntities.level,
    externalId: adPlatformEntities.externalId,
    parentExternalId: adPlatformEntities.parentExternalId,
    status: adPlatformEntities.status,
    effectiveStatus: adPlatformEntities.effectiveStatus,
    dailyBudgetCents: adPlatformEntities.dailyBudgetCents,
    lifetimeBudgetCents: adPlatformEntities.lifetimeBudgetCents,
  }).from(adPlatformEntities)
    .where(and(eq(adPlatformEntities.platform, CHANNEL), eq(adPlatformEntities.externalId, externalId)))
    .limit(1)
  const row = (rows as MirrorBudgetRow[])[0]
  return row && row.externalId === externalId ? row : null
}

async function drizzleLiveBudgetRows(): Promise<MirrorBudgetRow[]> {
  const [{ db }, { adPlatformEntities }, { and, eq, inArray }] = await Promise.all([
    import('~/lib/db.server'), import('../../../../../db/schema'), import('drizzle-orm'),
  ])
  const rows = await db.select({
    platform: adPlatformEntities.platform,
    level: adPlatformEntities.level,
    externalId: adPlatformEntities.externalId,
    parentExternalId: adPlatformEntities.parentExternalId,
    status: adPlatformEntities.status,
    effectiveStatus: adPlatformEntities.effectiveStatus,
    dailyBudgetCents: adPlatformEntities.dailyBudgetCents,
    lifetimeBudgetCents: adPlatformEntities.lifetimeBudgetCents,
  }).from(adPlatformEntities).where(and(
    eq(adPlatformEntities.platform, CHANNEL),
    inArray(adPlatformEntities.level, ['campaign', 'adset']),
    eq(adPlatformEntities.status, 'ACTIVE'),
  ))
  return (rows as MirrorBudgetRow[]).filter(r => r.platform === CHANNEL && r.status === 'ACTIVE')
}

/** The ledger rule behind every resume. Pure, so the tests can hold it to the letter. */
export function isAutomatedPauseOf(
  row: { verb: string; status: string; approvedBy: string | null; tier: string; targetExternalId: string; before: unknown; after: unknown },
  externalId: string,
): boolean {
  if (row.status !== 'applied' || row.approvedBy !== 'auto' || row.tier !== 'auto') return false
  if (row.verb === 'pause') {
    const before = (row.before ?? {}) as Record<string, unknown>
    return row.targetExternalId === externalId && before['status'] === 'ACTIVE'
  }
  if (row.verb === 'halt_all') {
    const after = (row.after ?? {}) as Record<string, unknown>
    const ids = after['pausedIds']
    return Array.isArray(ids) && ids.includes(externalId)
  }
  return false
}

async function drizzleHadAutomatedPause(externalId: string): Promise<boolean> {
  const [{ db }, { adActions }, { and, desc, eq, inArray, or }] = await Promise.all([
    import('~/lib/db.server'), import('../../../../../db/schema'), import('drizzle-orm'),
  ])
  const rows = await db.select({
    verb: adActions.verb, status: adActions.status, approvedBy: adActions.approvedBy, tier: adActions.tier,
    targetExternalId: adActions.targetExternalId, before: adActions.before, after: adActions.after,
  }).from(adActions).where(and(
    eq(adActions.platform, CHANNEL),
    eq(adActions.status, 'applied'),
    eq(adActions.approvedBy, 'auto'),
    inArray(adActions.verb, ['pause', 'halt_all']),
    or(eq(adActions.targetExternalId, externalId), eq(adActions.verb, 'halt_all')),
  )).orderBy(desc(adActions.id)).limit(500)
  return rows.some(r => isAutomatedPauseOf(r, externalId))
}

const defaultStore: MetaMutateStore = {
  entity: drizzleEntity,
  liveBudgetRows: drizzleLiveBudgetRows,
  hadAutomatedPause: drizzleHadAutomatedPause,
}

async function defaultSettings(): Promise<MetaMutateSettings> {
  const { getAdsMediaDailyCapCents, getAdsBudgetMaxStepPct } = await import('~/lib/ad-settings.server')
  const [dailyCapCents, budgetMaxStepPct] = await Promise.all([getAdsMediaDailyCapCents(), getAdsBudgetMaxStepPct()])
  return { dailyCapCents, budgetMaxStepPct }
}

async function defaultSyncAfterWrite(platform: ChannelId, externalIds: string[]): Promise<unknown> {
  const { syncAfterWrite } = await import('../../sync.server')
  return syncAfterWrite(platform, externalIds)
}

// ---------------------------------------------------------------------------
// metaMutate
// ---------------------------------------------------------------------------

function refuse(code: MutationRefusalCode, message: string): never {
  throw new MutationRefusedError(CHANNEL, code, message)
}

function intCents(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0 ? v : null
}

const statusOf = (row: MirrorBudgetRow | null) =>
  row ? { status: row.status ?? null, effectiveStatus: row.effectiveStatus ?? null } : null

export function createMetaMutate(deps: MetaMutateDeps = {}) {
  const graph = deps.graph ?? createGraphClient()
  const accountId = deps.accountId ?? (() => metaCredentialsFromEnv().accountId)
  const store = deps.store ?? defaultStore
  const settings = deps.settings ?? defaultSettings
  const sync = deps.syncAfterWrite ?? defaultSyncAfterWrite

  /** Sends the writes in order, or returns them untouched under dryRun. */
  async function send(writes: GraphWrite[], dryRun: boolean): Promise<GraphJson[]> {
    if (dryRun) return []
    const out: GraphJson[] = []
    for (const w of writes) out.push(await graph.post(w.path, w.body))
    return out
  }

  /** Read-after-write. A failed sync never undoes a write that landed; the dispatcher retries it. */
  async function readBack(ids: string[], dryRun: boolean): Promise<boolean> {
    if (dryRun || ids.length === 0) return false
    try {
      await sync(CHANNEL, ids)
      return true
    } catch (err) {
      console.error('[ads/meta/mutate] read-after-write sync failed', ids, err)
      return false
    }
  }

  async function statusChange(m: MutationRequest, to: 'PAUSED' | 'ACTIVE', dryRun: boolean): Promise<MetaMutateResult> {
    const { level, externalId } = m.target
    if (!STATUS_LEVELS.has(level)) refuse('bad_target', `Meta has no status on a ${level}; pause and resume act on an ad, ad set or campaign.`)
    if (!externalId) refuse('bad_target', 'No Meta id to change.')
    if (to === 'ACTIVE' && !(await store.hadAutomatedPause(externalId))) {
      refuse(
        'm4_resume_refused',
        `Resume refused for Meta ${level} ${externalId}: the ledger has no automatic pause of it taken while it was ACTIVE. `
        + 'docs/ads-policy.md M4: only the owner takes a Meta ad live, so a resume may only undo the machine\'s own pause.',
      )
    }
    const before = statusOf(await store.entity(externalId))
    const writes: GraphWrite[] = [{ method: 'POST', path: externalId, body: { status: to } }]
    const [response] = await send(writes, dryRun)
    const synced = await readBack([externalId], dryRun)
    return {
      applied: !dryRun, dryRun, requests: writes, touchedIds: dryRun ? [] : [externalId], synced,
      before, after: { status: to }, platformResponse: dryRun ? { dryRun: true, requests: writes } : response ?? null,
    }
  }

  async function setBudget(m: MutationRequest, dryRun: boolean): Promise<MetaMutateResult> {
    const { level, externalId } = m.target
    if (!BUDGET_LEVELS.has(level)) refuse('bad_target', `A Meta budget lives on a campaign or ad set, not a ${level}.`)
    const p = (m.params ?? {}) as Record<string, unknown>
    const proposed = intCents(p['dailyBudgetCents'])
    if (proposed == null) {
      refuse('bad_params', p['lifetimeBudgetCents'] != null
        ? 'set_budget writes daily_budget only; a lifetime budget is an owner change in Ads Manager.'
        : 'set_budget needs dailyBudgetCents as a whole number of cents.')
    }
    const newBudget = proposed as number
    const s = await settings()
    const row = await store.entity(externalId)
    const current = row?.dailyBudgetCents ?? null
    const approved = m.ledger?.tier === 'approve' && m.ledger.status === 'approved'
    const raises = current == null || newBudget > current

    if (raises && !approved) {
      refuse('approval_required', `Daily budget ${current ?? 'unknown'} to ${newBudget} cents raises spend, which needs an approved approve-tier row.`)
    }
    if (!approved && !budgetWithinStep(current, newBudget, s.budgetMaxStepPct)) {
      refuse('budget_step_exceeded', `Daily budget ${current ?? 'unknown'} to ${newBudget} cents is past ads_budget_max_step_pct (${s.budgetMaxStepPct}%) and the row is not an approved approve-tier action.`)
    }
    // The cap guards growth. A cut is never refused, even on an account already over the cap.
    if (raises) {
      const live = await store.liveBudgetRows()
      const others = live
        .filter(r => r.externalId !== externalId)
        .reduce((sum, r) => sum + (r.dailyBudgetCents ?? 0), 0)
      const total = others + newBudget
      if (total > s.dailyCapCents) {
        refuse('daily_cap_exceeded', `Live daily budgets would sum to ${total} cents, past ads_media_daily_cap_cents (${s.dailyCapCents}).`)
      }
    }

    const writes: GraphWrite[] = [{ method: 'POST', path: externalId, body: { daily_budget: newBudget } }]
    const [response] = await send(writes, dryRun)
    const synced = await readBack([externalId], dryRun)
    return {
      applied: !dryRun, dryRun, requests: writes, touchedIds: dryRun ? [] : [externalId], synced,
      before: { dailyBudgetCents: current, lifetimeBudgetCents: row?.lifetimeBudgetCents ?? null },
      after: { dailyBudgetCents: newBudget, lifetimeBudgetCents: row?.lifetimeBudgetCents ?? null },
      platformResponse: dryRun ? { dryRun: true, requests: writes } : response ?? null,
    }
  }

  async function haltAll(dryRun: boolean): Promise<MetaMutateResult> {
    const account = accountId()
    if (!account) refuse('not_configured', 'META_AD_ACCOUNT_ID is not set, so there is no account to halt.')
    // Read live, not from the mirror: a halt must not miss a campaign the last sync did not see.
    const campaigns = await graph.getAll(`${account}/campaigns`, { fields: 'id,name,status,effective_status', limit: 200 })
    const active = campaigns.filter(c => c['status'] === 'ACTIVE').map(c => String(c['id']))
    const writes: GraphWrite[] = active.map(id => ({ method: 'POST', path: id, body: { status: 'PAUSED' } }))

    const responses: Record<string, unknown> = {}
    const failures: Record<string, string> = {}
    const paused: string[] = []
    if (!dryRun) {
      // One campaign refusing must not stop the rest from pausing.
      for (const w of writes) {
        try {
          responses[w.path] = await graph.post(w.path, w.body)
          paused.push(w.path)
        } catch (err) {
          failures[w.path] = err instanceof Error ? err.message : String(err)
        }
      }
      if (writes.length > 0 && paused.length === 0) {
        throw new Error(`halt_all paused nothing: every campaign refused. ${Object.entries(failures).map(([id, e]) => `${id}: ${e}`).join('; ')}`.slice(0, 1000))
      }
    }
    const synced = await readBack(paused, dryRun)
    const failed = Object.keys(failures)
    return {
      applied: !dryRun, dryRun, requests: writes, touchedIds: paused, synced,
      before: { activeCampaignIds: active },
      after: { status: 'PAUSED', pausedIds: paused, failedIds: failed },
      platformResponse: dryRun ? { dryRun: true, requests: writes } : { responses, failures, activeBefore: active.length },
      warning: failed.length ? `halt_all could not pause ${failed.length} of ${active.length} campaigns: ${failed.join(', ')}` : null,
    }
  }

  return async function metaMutate(m: MutationRequest, opts: MetaMutateOptions = {}): Promise<MetaMutateResult> {
    const dryRun = opts.dryRun === true
    switch (m.verb) {
      case 'pause': return statusChange(m, 'PAUSED', dryRun)
      case 'resume': return statusChange(m, 'ACTIVE', dryRun)
      case 'set_budget': return setBudget(m, dryRun)
      case 'halt_all': return haltAll(dryRun)
      default: throw new ChannelNotEnabledError(CHANNEL, `mutate:${m.verb}`)
    }
  }
}

let defaultMutate: ReturnType<typeof createMetaMutate> | null = null

/** The production entry point. The adapter's mutate calls this. */
export function metaMutate(m: MutationRequest, opts?: MetaMutateOptions): Promise<MetaMutateResult> {
  return (defaultMutate ??= createMetaMutate())(m, opts)
}

// ---------------------------------------------------------------------------
// metaCreatePaused (phase 6a, ticket #16434)
// ---------------------------------------------------------------------------

/** What the adapter's createPaused takes for Meta: one ad of a built payload set. */
export interface MetaCreatePausedInput {
  /** The meta-paused-draft payload stored on ad_creatives.export_payload.meta.payload. */
  payload: unknown
  /** Our ad_creatives id. Picks the ad out of the payload and names the row the ids land on. */
  adCreativeId: number
  /** Campaign and ad set a sibling size already made, reused so three sizes make one campaign. */
  existing?: { campaignId?: string | null | undefined; adSetId?: string | null | undefined } | undefined
  /** The admin who pressed the button. Written as pushedBy. */
  actor?: string | undefined
}

export interface MetaCreatePausedResult extends CreatedRefs {
  externalAdId: string
  adId: string
  campaignId: string
  adSetId: string
  creativeId: string
  imageHash: string
  pushedAt: string
  reused: { campaign: boolean; adSet: boolean }
  /** True when the mirror read the created ids back before this returned. */
  synced: boolean
}

/** Where the created ids are recorded. The default writes ad_creatives. */
export interface MetaCreatePausedStore {
  /** external_ad_id and export_payload.push on success. launched_at stays null: a paused draft is not live. */
  recordPushed(adCreativeId: number, res: MetaCreatePausedResult, actor: string): Promise<void>
  /** export_payload.push.partial on a Graph failure part way, so a retry reuses what exists. */
  recordPartial(adCreativeId: number, err: MetaPushError): Promise<void>
}

export interface MetaCreatePausedDeps {
  graph?: GraphClient
  credentials?: () => MetaCredentials
  fetchBytes?: (url: string) => Promise<Buffer>
  /** The adapter's policyCheck over the Meta mirror. Runs before any Graph call. */
  policyCheck?: () => Promise<PolicyVerdict>
  store?: MetaCreatePausedStore
  syncAfterWrite?: (platform: ChannelId, externalIds: string[]) => Promise<unknown>
  now?: () => Date
}

function exportPayloadOf(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {}
}

async function writeCreativePush(adCreativeId: number, patch: (p: Record<string, unknown>) => Record<string, unknown>, externalAdId?: string): Promise<void> {
  const [{ db }, { adCreatives }, { eq }] = await Promise.all([
    import('~/lib/db.server'), import('../../../../../db/schema'), import('drizzle-orm'),
  ])
  const [row] = await db.select({ p: adCreatives.exportPayload }).from(adCreatives).where(eq(adCreatives.id, adCreativeId)).limit(1)
  await db.update(adCreatives).set({
    ...(externalAdId ? { externalAdId } : {}),
    exportPayload: patch(exportPayloadOf(row?.p)),
    updatedAt: new Date(),
  }).where(eq(adCreatives.id, adCreativeId))
}

const defaultCreateStore: MetaCreatePausedStore = {
  recordPushed: (adCreativeId, res, actor) => {
    const { synced: _synced, ...push } = res
    return writeCreativePush(adCreativeId, p => ({ ...p, push: { ...push, pushedBy: actor }, pushError: undefined }), res.externalAdId)
  },
  recordPartial: (adCreativeId, err) =>
    writeCreativePush(adCreativeId, p => ({ ...p, push: { partial: err.partial, error: err.message, at: new Date().toISOString() } })),
}

async function defaultFetchBytes(url: string): Promise<Buffer> {
  const { blobFetchToBuffer } = await import('~/lib/blob.server')
  return blobFetchToBuffer(url)
}

/** M7 from the mirror: the adapter's policyCheck over every mirrored Meta entity. */
async function defaultPolicyCheck(): Promise<PolicyVerdict> {
  const [{ db }, { adPlatformEntities }, { eq }, { metaPolicyCheck }] = await Promise.all([
    import('~/lib/db.server'), import('../../../../../db/schema'), import('drizzle-orm'), import('./adapter.server'),
  ])
  const rows = await db.select({
    platform: adPlatformEntities.platform,
    level: adPlatformEntities.level,
    externalId: adPlatformEntities.externalId,
    name: adPlatformEntities.name,
    effectiveStatus: adPlatformEntities.effectiveStatus,
    reviewFeedback: adPlatformEntities.reviewFeedback,
  }).from(adPlatformEntities).where(eq(adPlatformEntities.platform, CHANNEL))
  return metaPolicyCheck({ mirror: rows as PolicyMirrorRow[] })
}

/**
 * Creates the paused draft for one ad of a payload set: adimages (hash),
 * campaign, ad set, ad creative, ad, in that order, every object PAUSED.
 * Moved here from ad-export/meta-push.server.ts so the Graph writes go
 * through the shared client.
 *
 * Refusals come before any Graph call, in this order: credentials missing;
 * the payload not a safe paused draft (every object PAUSED, age_min 25, US
 * only, no special categories, no Advantage+ audience); the ad missing from
 * the payload or without a rendered image; a destination that is not the
 * bridge host or a PDP (M1); a page id other than the one configured page;
 * and the policyCheck (M7: anything DISAPPROVED in the mirror stops the lane).
 *
 * Reached only through dispatchCreatePaused in channels/apply.server.ts,
 * which checks ads_spend_enabled and writes the ad_actions row.
 */
export function createMetaCreatePaused(deps: MetaCreatePausedDeps = {}) {
  const credentials = deps.credentials ?? (() => metaCredentialsFromEnv())
  const graph = deps.graph ?? createGraphClient({ token: () => credentials().token })
  const fetchBytes = deps.fetchBytes ?? defaultFetchBytes
  const policyCheck = deps.policyCheck ?? defaultPolicyCheck
  const store = deps.store ?? defaultCreateStore
  const sync = deps.syncAfterWrite ?? defaultSyncAfterWrite
  const now = deps.now ?? (() => new Date())

  return async function metaCreatePaused(input: MetaCreatePausedInput): Promise<MetaCreatePausedResult> {
    const cred = credentials()
    const missing = [!cred.token && 'META_ADS_ACCESS_TOKEN', !cred.accountId && 'META_AD_ACCOUNT_ID', !cred.pageId && 'META_PAGE_ID'].filter(Boolean)
    if (missing.length) throw new MetaPushError('not_configured', `Meta is not configured: ${missing.join(', ')} not set. Nothing was sent.`)
    if (!isMetaDraftPayload(input.payload)) throw new MetaPushError('not_exportable', 'No ready Meta payload on this creative. Build it first.')
    MetaPushError.assertSafe(input.payload)
    const p: MetaDraftPayload = input.payload
    const ad = p.ads.find(a => a.creativeId === input.adCreativeId)
    if (!ad) throw new MetaPushError('not_exportable', `Creative #${input.adCreativeId} is not in this payload.`)
    if (!ad.image.assetUrl) throw new MetaPushError('not_exportable', 'The creative has no rendered image to upload.')
    const link = ad.adCreative.object_story_spec.link_data
    if (!destinationOkForMeta(link.link) || !destinationOkForMeta(link.call_to_action.value.link)) {
      throw new MetaPushError('not_exportable', 'Refusing: the destination must be the bridge host (curious.xdipx.com) or a /products/ page (M1).')
    }
    const payloadPage = ad.adCreative.object_story_spec.page_id
    if (payloadPage && !payloadPage.startsWith('{{') && payloadPage !== cred.pageId) {
      throw new MetaPushError('not_exportable', `Refusing: the payload names page ${payloadPage}, not the one configured page (META_PAGE_ID).`)
    }
    const verdict = await policyCheck()
    if (!verdict.ok) {
      throw new MetaPushError('not_exportable', `Meta policy check refused: ${verdict.refusals.map(r => r.message).join(' ')}`.slice(0, 1000))
    }

    const acct = cred.accountId!
    const partial: MetaPushError['partial'] = {}
    const fail = async (err: MetaPushError): Promise<never> => {
      try {
        await store.recordPartial(input.adCreativeId, err)
      } catch (e) {
        console.error('[ads/meta/createPaused] could not record the partial push', input.adCreativeId, e)
      }
      throw err
    }
    const post = async (path: string, body: Record<string, unknown>, step: string): Promise<GraphJson> => {
      try {
        return await graph.post(path, body as Record<string, string | number | boolean | object>)
      } catch (err) {
        if (err instanceof GraphError && err.kind === 'not_configured') throw new MetaPushError('not_configured', err.message, partial)
        return fail(new MetaPushError('api_error', `Meta ${step} refused: ${err instanceof Error ? err.message : String(err)}`, partial))
      }
    }
    const idOf = async (r: GraphJson, step: string): Promise<string> => {
      const id = String(r['id'] ?? '')
      return id || fail(new MetaPushError('api_error', `Meta ${step} create returned no id.`, partial))
    }

    // 1. image hash
    let bytes: Buffer
    try { bytes = await fetchBytes(ad.image.assetUrl) } catch (err) {
      throw new MetaPushError('api_error', `Could not read the rendered PNG: ${err instanceof Error ? err.message : String(err)}`, partial)
    }
    const up = await post(`${acct}/adimages`, { bytes: bytes.toString('base64'), name: ad.image.filename }, 'image upload')
    const images = (up['images'] ?? {}) as Record<string, { hash?: string }>
    const hash = Object.values(images)[0]?.hash
    if (!hash) return fail(new MetaPushError('api_error', 'Meta image upload returned no hash.', partial))
    partial.imageHash = hash

    // 2. campaign, PAUSED (reused when a sibling size already made it)
    let campaignId = input.existing?.campaignId ?? null
    const reusedCampaign = !!campaignId
    if (!campaignId) campaignId = await idOf(await post(`${acct}/campaigns`, { ...p.campaign }, 'campaign'), 'campaign')
    partial.campaignId = campaignId

    // 3. ad set, PAUSED
    let adSetId = input.existing?.adSetId ?? null
    const reusedAdSet = !!adSetId
    if (!adSetId) adSetId = await idOf(await post(`${acct}/adsets`, { ...p.adSet, campaign_id: campaignId }, 'ad set'), 'ad set')
    partial.adSetId = adSetId

    // 4. ad creative, on the one configured page
    const creativeId = await idOf(await post(`${acct}/adcreatives`, {
      name: ad.adCreative.name,
      object_story_spec: { page_id: cred.pageId, link_data: { ...link, image_hash: hash } },
    }, 'ad creative'), 'ad creative')
    partial.creativeId = creativeId

    // 5. ad, PAUSED
    const adId = await idOf(await post(`${acct}/ads`, {
      name: ad.ad.name, status: 'PAUSED', adset_id: adSetId, creative: { creative_id: creativeId },
    }, 'ad'), 'ad')
    partial.adId = adId

    const res: MetaCreatePausedResult = {
      externalAdId: adId, adId, campaignId, adSetId, creativeId, imageHash: hash,
      pushedAt: now().toISOString(), reused: { campaign: reusedCampaign, adSet: reusedAdSet }, synced: false,
    }
    try {
      await store.recordPushed(input.adCreativeId, res, input.actor ?? 'owner')
    } catch (err) {
      // Everything exists in Meta, paused. Say so with every id, so the ledger row keeps them.
      throw new MetaPushError('api_error', `Created in Meta (paused) but could not record it on creative #${input.adCreativeId}: ${err instanceof Error ? err.message : String(err)}`, partial)
    }
    try {
      await sync(CHANNEL, [campaignId, adSetId, adId])
      res.synced = true
    } catch (err) {
      console.error('[ads/meta/createPaused] read-after-write sync failed', err)
    }
    return res
  }
}

let defaultCreatePaused: ReturnType<typeof createMetaCreatePaused> | null = null

/** The production entry point. The adapter's createPaused calls this. */
export function metaCreatePaused(input: MetaCreatePausedInput, deps?: MetaCreatePausedDeps): Promise<MetaCreatePausedResult> {
  if (deps) return createMetaCreatePaused(deps)(input)
  return (defaultCreatePaused ??= createMetaCreatePaused())(input)
}
