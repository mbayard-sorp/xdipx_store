/**
 * The weekly M8 exclusion audience sync (ticket #16687, plan §9.4,
 * docs/ads-policy.md M8). Caller: /cron/ads-audience-sync, Sundays at 09:20
 * UTC, after the 09:05 insights restatement.
 *
 * One run:
 *   1. Reads the sources, all from Klaviyo: the profiles behind every
 *      "Placed Order" and "Cancelled Order" event (Klaviyo's Shopify
 *      integration records them; the Shopify Admin API refuses customer PII
 *      on the store's plan), and the members of the subscriber lists (paid
 *      leads, daily deal and Email List, or ADS_EXCLUDE_KLAVIYO_LIST_IDS).
 *   2. Applies the consent rule in audience-sync-core.ts and hashes what is
 *      left. Emails only. Counts are the only thing logged or stored.
 *   3. Valve ads_audience_sync_enabled off, or no Meta token or account:
 *      writes one dry_run ad_actions row with the counts, and sends nothing.
 *   4. Otherwise writes one audience_sync row (tier auto, proposed by
 *      rule:M8), approves it, finds or creates "xdipx buyers (exclude)" and
 *      "xdipx leads (exclude)", replaces their members through
 *      channels/meta/mutate.server.ts, and closes the row applied or failed.
 *   5. Re-reads Meta's audiences into the ad_audiences mirror, so the
 *      Audiences tab shows them before the next 6-hourly sync.
 *
 * A refresh cannot raise spend: it only narrows who sees an ad set that
 * already excludes these audiences. It never attaches an audience to an ad
 * set; that is an owner step in Ads Manager until the applier can edit
 * targeting.
 */
import {
  AUDIENCE_SYNC_DEFS, AUDIENCE_SYNC_TARGET_ID, AUDIENCE_SYNC_TARGET_LEVEL, buildAudienceLists, saleOptOutFromProperties,
  type AudienceLists, type AudienceSyncKey, type BuyerRow, type ConsentRow,
} from './audience-sync-core'
import { buildIdempotencyKey } from './ledger-core'
import type { AdActionRow, InsertActionResult, NewAdAction, TransitionExtra } from './ledger.server'
import type { AdActionStatus } from './ledger-core'
import type { EntityLevel } from './channels/types'
import type { AudienceMembersResult, EnsuredAudience } from './channels/meta/mutate.server'
import { ADS_AUDIENCE_SYNC_ENABLED_DEFAULT, ADS_SETTING_KEYS } from '~/lib/ad-settings-defaults'

export const AUDIENCE_SYNC_PROPOSED_BY = 'rule:M8'
/** Live attempts per UTC day. A failed run can be retried by hand; an applied one cannot. */
export const AUDIENCE_SYNC_MAX_ATTEMPTS = 5
const KLAVIYO_BASE = 'https://a.klaviyo.com/api'
const KLAVIYO_REVISION = '2024-10-15'
const PROFILE_PAGE_SIZE = 100
const EVENT_PAGE_SIZE = 200
const MAX_PAGES = 500
/** Klaviyo's any(id, [...]) filter, kept well under its URL limits. */
const PROFILE_ID_CHUNK = 100
const BUYER_METRIC = 'Placed Order'
const CANCEL_METRIC = 'Cancelled Order'
const PROFILE_FIELDS = 'fields[profile]=email,properties,subscriptions&additional-fields[profile]=subscriptions'

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface AudienceSources {
  buyers: BuyerRow[]
  leads: ConsentRow[]
  /** Which Klaviyo lists were read, by id. */
  klaviyoListIds: string[]
  /** Anything read only in part, named. */
  gaps: string[]
}

export interface AudienceSyncLedger {
  findByKey(key: string): Promise<AdActionRow | null>
  insert(input: NewAdAction): Promise<InsertActionResult>
  transition(id: number, to: AdActionStatus, actor: string, extra?: TransitionExtra): Promise<AdActionRow>
}

export interface AudienceSyncMeta {
  ensureCustomerListAudience(def: { name: string; description: string }, opts?: { dryRun?: boolean }): Promise<EnsuredAudience>
  loadCustomerListMembers(audienceId: string, hashes: readonly string[], opts: { fresh: boolean; dryRun?: boolean }): Promise<AudienceMembersResult>
}

export interface AudienceSyncDeps {
  enabled?: () => Promise<boolean>
  credentials?: () => { token: string | null; accountId: string | null }
  readSources?: () => Promise<AudienceSources>
  ledger?: AudienceSyncLedger
  meta?: () => Promise<AudienceSyncMeta>
  /** Re-reads Meta's audiences into ad_audiences. Best effort. */
  refreshMirror?: () => Promise<unknown>
  now?: () => Date
}

export interface AudienceSyncResult {
  status: 'dry_run' | 'applied' | 'failed' | 'skipped'
  actionId: number | null
  reason: string
  counts: AudienceLists['counts'] | null
  audiences: Partial<Record<AudienceSyncKey, AudienceOutcome>>
  gaps: string[]
  error: string | null
}

export interface AudienceOutcome {
  id: string | null
  name: string
  created: boolean
  mode: AudienceMembersResult['mode'] | 'would_send'
  rows: number
  batches: number
  numReceived?: number
  numInvalid?: number
}

// ---------------------------------------------------------------------------
// Defaults, loaded lazily so the tests never touch the database or a network
// ---------------------------------------------------------------------------

function parseBool(raw: string | null, fallback: boolean): boolean {
  if (raw == null) return fallback
  const v = raw.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'on') return true
  if (v === 'false' || v === '0' || v === 'off') return false
  return fallback
}

/** ads_audience_sync_enabled. A missing or unreadable row is off. */
export async function getAdsAudienceSyncEnabled(): Promise<boolean> {
  const { getPipelineSetting } = await import('~/lib/feed-processor.server')
  return parseBool(await getPipelineSetting(ADS_SETTING_KEYS.audienceSyncEnabled), ADS_AUDIENCE_SYNC_ENABLED_DEFAULT)
}

async function defaultCredentials() {
  const { metaCredentialsFromEnv } = await import('./channels/meta/credentials')
  const c = metaCredentialsFromEnv()
  return { token: c.token, accountId: c.accountId }
}

/**
 * The Klaviyo lists that count as M8 subscribers: paid leads, daily deal and,
 * when KLAVIYO_LIST_ID_EMAIL_LIST is set, Email List (M8 names all three).
 * ADS_EXCLUDE_KLAVIYO_LIST_IDS, comma separated, replaces the defaults.
 */
export function klaviyoExcludeListIds(env: NodeJS.ProcessEnv = process.env): string[] {
  const override = (env['ADS_EXCLUDE_KLAVIYO_LIST_IDS'] ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const ids = override.length
    ? override
    : [env['KLAVIYO_LIST_ID_PAID_LEADS'], env['KLAVIYO_LIST_ID_DAILY_DEAL'], env['KLAVIYO_LIST_ID_EMAIL_LIST']]
      .map(s => (s ?? '').trim()).filter(Boolean)
  return [...new Set(ids)]
}

interface KlaviyoMarketing {
  consent?: string | null
  can_receive_email_marketing?: boolean | null
  suppression?: unknown[] | null
  list_suppressions?: unknown[] | null
}

/** One Klaviyo profile, reduced to what the consent rule reads. */
export function consentRowFrom(attrs: Record<string, unknown> | null | undefined): ConsentRow {
  const subs = (attrs?.['subscriptions'] ?? null) as { email?: { marketing?: KlaviyoMarketing } } | null
  const m = subs?.email?.marketing ?? null
  const suppressed = (Array.isArray(m?.suppression) && m.suppression.length > 0)
    || (Array.isArray(m?.list_suppressions) && m.list_suppressions.length > 0)
  const props = attrs?.['properties']
  return {
    email: typeof attrs?.['email'] === 'string' ? (attrs['email'] as string) : null,
    consent: typeof m?.consent === 'string' ? m.consent : null,
    canReceiveEmailMarketing: typeof m?.can_receive_email_marketing === 'boolean' ? m.can_receive_email_marketing : null,
    suppressed,
    saleOptOut: saleOptOutFromProperties(props && typeof props === 'object' ? (props as Record<string, unknown>) : null),
  }
}

interface KlaviyoPage {
  data?: Array<{ id?: string; attributes?: Record<string, unknown>; relationships?: { profile?: { data?: { id?: string } } } }>
  links?: { next?: string | null }
}

async function klaviyoGet(pathOrUrl: string): Promise<KlaviyoPage> {
  const key = process.env['KLAVIYO_API_KEY']
  if (!key) throw new Error('KLAVIYO_API_KEY is not set')
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${KLAVIYO_BASE}${pathOrUrl}`
  const res = await fetch(url, { headers: { accept: 'application/json', revision: KLAVIYO_REVISION, Authorization: `Klaviyo-API-Key ${key}` } })
  // The status only: a Klaviyo error body can echo a filter, and a filter can carry ids.
  if (!res.ok) throw new Error(`Klaviyo GET ${url.replace(/\?.*$/, '')} failed: HTTP ${res.status}`)
  return res.json() as Promise<KlaviyoPage>
}

/** Follows links.next until it ends or the page cap; names a truncation in gaps. */
async function klaviyoAll(first: string, label: string, gaps: string[]): Promise<NonNullable<KlaviyoPage['data']>> {
  const out: NonNullable<KlaviyoPage['data']> = []
  let next: string | null = first
  for (let page = 0; page < MAX_PAGES && next; page++) {
    const res = await klaviyoGet(next)
    out.push(...(res.data ?? []))
    next = res.links?.next ?? null
  }
  if (next) gaps.push(`klaviyo: ${label} stopped at ${MAX_PAGES} pages`)
  return out
}

/** Every metric id with this exact name: the Shopify integration's and any API-sent twin. */
async function metricIds(names: string[], gaps: string[]): Promise<Map<string, string[]>> {
  const rows = await klaviyoAll('/metrics/?fields[metric]=name', 'metrics', gaps)
  const out = new Map<string, string[]>(names.map(n => [n, []]))
  for (const r of rows) {
    const name = r.attributes?.['name']
    if (typeof name === 'string' && out.has(name) && r.id) out.get(name)!.push(r.id)
  }
  return out
}

/** Profile id to event count, for every event of the given metrics. */
async function eventCountsByProfile(ids: string[], label: string, gaps: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  for (const id of ids) {
    const filter = encodeURIComponent(`equals(metric_id,"${id}")`)
    const rows = await klaviyoAll(`/events/?filter=${filter}&fields[event]=datetime&page[size]=${EVENT_PAGE_SIZE}`, `${label} events`, gaps)
    for (const e of rows) {
      const p = e.relationships?.profile?.data?.id
      if (p) counts.set(p, (counts.get(p) ?? 0) + 1)
    }
  }
  return counts
}

/** The buyers: one row per profile with a Placed Order event. */
export async function readBuyers(gaps: string[]): Promise<BuyerRow[]> {
  const metrics = await metricIds([BUYER_METRIC, CANCEL_METRIC], gaps)
  const placedIds = metrics.get(BUYER_METRIC) ?? []
  if (placedIds.length === 0) {
    gaps.push(`klaviyo: no "${BUYER_METRIC}" metric, so the buyers audience reads nothing`)
    return []
  }
  const [placed, cancelled] = await Promise.all([
    eventCountsByProfile(placedIds, 'placed order', gaps),
    eventCountsByProfile(metrics.get(CANCEL_METRIC) ?? [], 'cancelled order', gaps),
  ])
  const ids = [...placed.keys()]
  const out: BuyerRow[] = []
  for (let i = 0; i < ids.length; i += PROFILE_ID_CHUNK) {
    const slice = ids.slice(i, i + PROFILE_ID_CHUNK)
    const filter = encodeURIComponent(`any(id,[${slice.map(id => JSON.stringify(id)).join(',')}])`)
    const rows = await klaviyoAll(`/profiles/?filter=${filter}&${PROFILE_FIELDS}&page[size]=${PROFILE_PAGE_SIZE}`, 'buyer profiles', gaps)
    for (const p of rows) {
      if (!p.id) continue
      out.push({ ...consentRowFrom(p.attributes), placedOrders: placed.get(p.id) ?? 0, cancelledOrders: cancelled.get(p.id) ?? 0 })
    }
  }
  return out
}

/** The leads: every member of the configured subscriber lists. A person on two lists is two rows; the hash list de-duplicates. */
export async function readLeads(listIds: string[], gaps: string[]): Promise<ConsentRow[]> {
  const out: ConsentRow[] = []
  for (const id of listIds) {
    const rows = await klaviyoAll(`/lists/${encodeURIComponent(id)}/profiles/?${PROFILE_FIELDS}&page[size]=${PROFILE_PAGE_SIZE}`, `list ${id}`, gaps)
    for (const p of rows) out.push(consentRowFrom(p.attributes))
  }
  return out
}

async function defaultReadSources(): Promise<AudienceSources> {
  const gaps: string[] = []
  const listIds = klaviyoExcludeListIds()
  if (listIds.length === 0) gaps.push('klaviyo: no subscriber list ids configured, so the leads audience reads nothing')
  const [buyers, leads] = await Promise.all([readBuyers(gaps), readLeads(listIds, gaps)])
  return { buyers, leads, klaviyoListIds: listIds, gaps }
}

async function defaultLedger(): Promise<AudienceSyncLedger> {
  const [{ insertAction, transitionAction }, { db }, { adActions }, { eq }] = await Promise.all([
    import('./ledger.server'), import('~/lib/db.server'), import('../../../db/schema'), import('drizzle-orm'),
  ])
  return {
    async findByKey(key) {
      const [row] = await db.select().from(adActions).where(eq(adActions.idempotencyKey, key)).limit(1)
      return row ?? null
    },
    insert: insertAction,
    transition: transitionAction,
  }
}

async function defaultMeta(): Promise<AudienceSyncMeta> {
  const { createMetaAudienceSync } = await import('./channels/meta/mutate.server')
  return createMetaAudienceSync()
}

async function defaultRefreshMirror(): Promise<unknown> {
  const { syncChannelAudiences } = await import('./audiences.server')
  return syncChannelAudiences('meta')
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const dayOf = (d: Date) => d.toISOString().slice(0, 10)
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 1000)
// ad_actions.target_level is text with app-enforced values. The ledger's typed
// levels are ad entities; this row's target is the account's M8 audiences.
const TARGET_LEVEL = AUDIENCE_SYNC_TARGET_LEVEL as unknown as EntityLevel
const KEYS: AudienceSyncKey[] = ['buyers', 'leads']

function rowBase(key: string, extra: Partial<NewAdAction>): NewAdAction {
  return {
    idempotencyKey: key,
    platform: 'meta',
    targetLevel: TARGET_LEVEL,
    targetExternalId: AUDIENCE_SYNC_TARGET_ID,
    verb: 'audience_sync',
    proposedBy: AUDIENCE_SYNC_PROPOSED_BY,
    tier: 'auto',
    ...extra,
  }
}

function plannedOutcomes(lists: AudienceLists | null): Partial<Record<AudienceSyncKey, AudienceOutcome>> {
  if (!lists) return {}
  const out: Partial<Record<AudienceSyncKey, AudienceOutcome>> = {}
  for (const k of KEYS) {
    const rows = lists[k].length
    out[k] = { id: null, name: AUDIENCE_SYNC_DEFS[k].name, created: false, mode: 'would_send', rows, batches: Math.ceil(rows / 10_000) }
  }
  return out
}

export async function runAudienceSync(deps: AudienceSyncDeps = {}): Promise<AudienceSyncResult> {
  const now = (deps.now ?? (() => new Date()))()
  const day = dayOf(now)
  const ledger = deps.ledger ?? await defaultLedger()
  const [enabled, cred] = await Promise.all([
    (deps.enabled ?? getAdsAudienceSyncEnabled)(),
    deps.credentials ? Promise.resolve(deps.credentials()) : defaultCredentials(),
  ])

  // 1 and 2. Sources and the consent rule. A source failure is recorded, never thrown past here.
  let sources: AudienceSources | null = null
  let sourceError: string | null = null
  try {
    sources = await (deps.readSources ?? defaultReadSources)()
  } catch (err) {
    sourceError = errorText(err)
  }
  const lists = sources ? buildAudienceLists(sources.buyers, sources.leads) : null
  const counts = lists?.counts ?? null
  const gaps = sources?.gaps ?? []
  const summary = {
    counts,
    klaviyoListIds: sources?.klaviyoListIds ?? [],
    gaps,
    consentRule: 'email only; Klaviyo email marketing consent SUBSCRIBED; no suppression; no sale or sharing opt-out; a no in either source keeps the email out of both',
  }

  // 3. Valve off or not configured: one dry_run row, nothing sent.
  const missing = [!cred.token && 'Meta access token', !cred.accountId && 'META_AD_ACCOUNT_ID'].filter(Boolean)
  const dryReason = !enabled
    ? 'ads_audience_sync_enabled is off'
    : missing.length ? `${missing.join(' and ')} not set` : null
  if (dryReason) {
    const reason = `Dry run: ${dryReason}, so nothing was sent to Meta.${sourceError ? ` Sources could not be read: ${sourceError}` : ''}`
    const audiences = plannedOutcomes(lists)
    const key = buildIdempotencyKey({ platform: 'meta', level: AUDIENCE_SYNC_TARGET_LEVEL, externalId: AUDIENCE_SYNC_TARGET_ID, verb: 'audience_sync', day, params: { mode: 'dry_run' } })
    const ins = await ledger.insert(rowBase(key, {
      status: 'dry_run', params: { mode: 'dry_run' }, before: null,
      after: { ...summary, audiences }, reason: reason.slice(0, 1000),
    }))
    return {
      status: 'dry_run', actionId: ins.row?.id ?? null,
      reason: ins.inserted ? reason : `${reason} Today's dry_run row already exists.`,
      counts, audiences, gaps, error: sourceError,
    }
  }

  // 4. Live. One row per attempt; an applied row today stops a second upload.
  let key: string | null = null
  let params: Record<string, unknown> = {}
  for (let attempt = 0; attempt < AUDIENCE_SYNC_MAX_ATTEMPTS; attempt++) {
    params = { mode: 'live', attempt }
    const k = buildIdempotencyKey({ platform: 'meta', level: AUDIENCE_SYNC_TARGET_LEVEL, externalId: AUDIENCE_SYNC_TARGET_ID, verb: 'audience_sync', day, params })
    const existing = await ledger.findByKey(k)
    if (!existing) { key = k; break }
    if (existing.status === 'applied' || existing.status === 'proposed' || existing.status === 'approved') {
      return {
        status: 'skipped', actionId: existing.id,
        reason: `ad_actions #${existing.id} is already ${existing.status} today, so no second upload.`,
        counts, audiences: {}, gaps, error: null,
      }
    }
  }
  if (!key) {
    return {
      status: 'skipped', actionId: null,
      reason: `${AUDIENCE_SYNC_MAX_ATTEMPTS} live attempts failed today. Read the failed audience_sync rows first.`,
      counts, audiences: {}, gaps, error: null,
    }
  }

  const ins = await ledger.insert(rowBase(key, {
    status: 'proposed', params, before: null, after: summary,
    reason: 'Weekly M8 exclusion audience refresh (plan section 9.4, tier A standing rule).',
  }))
  if (!ins.inserted || !ins.row) {
    return { status: 'skipped', actionId: null, reason: 'Another run wrote this row first.', counts, audiences: {}, gaps, error: null }
  }
  const row = await ledger.transition(ins.row.id, 'approved', 'auto')

  const fail = async (msg: string, audiences: Partial<Record<AudienceSyncKey, AudienceOutcome>>): Promise<AudienceSyncResult> => {
    try {
      await ledger.transition(row.id, 'failed', 'auto', { error: msg, after: { ...summary, audiences }, platformResponse: { audiences } })
    } catch (err) {
      console.error('[ads/audience-sync] could not mark the row failed', row.id, errorText(err))
    }
    return { status: 'failed', actionId: row.id, reason: msg, counts, audiences, gaps, error: msg }
  }

  if (!lists) return fail(`Sources could not be read, so nothing was sent: ${sourceError ?? 'unknown error'}`, {})

  const audiences: Partial<Record<AudienceSyncKey, AudienceOutcome>> = {}
  try {
    const meta = await (deps.meta ?? defaultMeta)()
    for (const k of KEYS) {
      const def = AUDIENCE_SYNC_DEFS[k]
      const ensured = await meta.ensureCustomerListAudience({ name: def.name, description: def.description })
      if (!ensured.id) throw new Error(`Audience "${def.name}" has no id after create.`)
      audiences[k] = { id: ensured.id, name: def.name, created: ensured.created, mode: 'would_send', rows: lists[k].length, batches: 0 }
      const loaded = await meta.loadCustomerListMembers(ensured.id, lists[k], { fresh: ensured.created })
      audiences[k] = {
        id: ensured.id, name: def.name, created: ensured.created, mode: loaded.mode,
        rows: loaded.rows, batches: loaded.batches, numReceived: loaded.numReceived, numInvalid: loaded.numInvalid,
      }
    }
  } catch (err) {
    return fail(errorText(err), audiences)
  }

  try {
    await ledger.transition(row.id, 'applied', 'auto', { after: { ...summary, audiences }, platformResponse: { audiences } })
  } catch (err) {
    console.error('[ads/audience-sync] the applied transition failed', row.id, errorText(err))
  }

  // 5. Read back, so the Audiences tab shows the two audiences now.
  try {
    await (deps.refreshMirror ?? defaultRefreshMirror)()
  } catch (err) {
    gaps.push(`mirror refresh failed: ${errorText(err).slice(0, 200)}`)
  }

  const sent = KEYS.map(k => `${AUDIENCE_SYNC_DEFS[k].name}: ${audiences[k]?.rows ?? 0} (${audiences[k]?.mode})`).join('; ')
  return { status: 'applied', actionId: row.id, reason: `Refreshed the M8 exclusion audiences. ${sent}.`, counts, audiences, gaps, error: null }
}

// ---------------------------------------------------------------------------
// The settings card
// ---------------------------------------------------------------------------

export interface AudienceSyncStatus {
  enabled: boolean
  last: {
    id: number
    status: string
    at: string
    /** Hashed emails per audience: uploaded when applied, would-upload on a dry run. */
    buyers: number | null
    leads: number | null
    error: string | null
  } | null
}

function rowsOf(after: unknown, key: AudienceSyncKey): number | null {
  const a = (after ?? {}) as { audiences?: Record<string, { rows?: unknown }>; counts?: Record<string, { included?: unknown }> }
  const v = a.audiences?.[key]?.rows ?? a.counts?.[key]?.included
  return typeof v === 'number' ? v : null
}

/** The valve and the newest audience_sync row, for /admin/ads/settings. Counts only. */
export async function loadAudienceSyncStatus(): Promise<AudienceSyncStatus> {
  const [{ db }, { adActions }, { desc, eq }] = await Promise.all([
    import('~/lib/db.server'), import('../../../db/schema'), import('drizzle-orm'),
  ])
  const [enabled, rows] = await Promise.all([
    getAdsAudienceSyncEnabled(),
    db.select({
      id: adActions.id, status: adActions.status, createdAt: adActions.createdAt, after: adActions.after, error: adActions.error,
    }).from(adActions).where(eq(adActions.verb, 'audience_sync')).orderBy(desc(adActions.id)).limit(1),
  ])
  const r = rows[0]
  return {
    enabled,
    last: r ? {
      id: r.id, status: r.status, at: r.createdAt.toISOString(),
      buyers: rowsOf(r.after, 'buyers'), leads: rowsOf(r.after, 'leads'), error: r.error,
    } : null,
  }
}
