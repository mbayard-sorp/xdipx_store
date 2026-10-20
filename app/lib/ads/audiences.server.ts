/**
 * Audience mirror and the M8 exclusions check for the Ads Control Plane
 * (plan §3.3 and §7 phase 6b, ticket #16435).
 *
 * syncChannelAudiences pulls a channel's audiences through its adapter and
 * upserts them into ad_audiences on (platform, external_id). The adapter only
 * reads the platform; this module only writes our own database.
 *
 * Role is not something Meta stores on an audience. It is derived here from
 * the ad sets already in ad_platform_entities: an audience that any ad set
 * lists under targeting.excluded_custom_audiences is 'exclusion', one listed
 * under targeting.custom_audiences is 'targeting', anything else 'unknown'.
 * Exclusion wins a tie, because M8 is the question this mirror answers.
 *
 * auditExclusions reads the mirror only and answers docs/ads-policy.md M8:
 * every Meta ad set carries two exclusion audiences, the Shopify customer
 * list and the Klaviyo subscriber lists. An ad set without both is not
 * launch-ready.
 *
 * Caller: syncAllChannels in sync.server.ts, right after the entity pull, so
 * roles come from fresh targeting. The console's /admin/ads/audiences loader
 * reads loadAudiencesPage.
 */
import { and, desc, eq, ne, or, isNull, sql } from 'drizzle-orm'

import { db as defaultDb, type DB } from '~/lib/db.server'
import { adAudiences, adPlatformEntities, type AdAudienceKind, type AdAudienceRole } from '../../../db/schema'
import { audienceSyncKeyOfName } from './audience-sync-core'
import { getChannel } from './channels/registry.server'
import type { ChannelAdapter, ChannelId, NormalizedAudience } from './channels/types'

/** An ad set as the mirror holds it, with its last platform payload. */
export interface AdsetMirrorRow {
  platform: string
  externalId: string
  name: string | null
  status: string | null
  effectiveStatus: string | null
  raw: Record<string, unknown> | null
}

export interface AudienceUpsertRow {
  platform: string
  externalId: string
  name: string | null
  kind: AdAudienceKind
  role: AdAudienceRole
  approxSize: number | null
  status: string | null
  raw: Record<string, unknown> | null
}

export interface AudienceRow extends AudienceUpsertRow {
  syncedAt: Date
}

/** The database half, behind an interface so the logic is testable without a database. */
export interface AudienceStore {
  /** Every ad set on the platform the mirror has not marked MISSING. */
  adsets(platform: string): Promise<AdsetMirrorRow[]>
  upsert(rows: AudienceUpsertRow[], now: Date): Promise<Array<{ externalId: string; inserted: boolean }>>
  list(platform?: string): Promise<AudienceRow[]>
}

export interface AudienceDeps {
  store?: AudienceStore
  adapterFor?: (channel: ChannelId) => ChannelAdapter | null
  now?: () => Date
}

export interface AudienceSyncResult {
  channel: ChannelId
  seen: number
  inserted: number
  updated: number
  byRole: Record<AdAudienceRole, number>
  syncedAt: string
}

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------

export interface TargetedAudience {
  id: string
  name: string | null
}

function audienceList(v: unknown): TargetedAudience[] {
  if (!Array.isArray(v)) return []
  const out: TargetedAudience[] = []
  for (const a of v) {
    if (!a || typeof a !== 'object') continue
    const o = a as Record<string, unknown>
    const id = o['id']
    if (typeof id !== 'string' && typeof id !== 'number') continue
    const name = typeof o['name'] === 'string' && o['name'] !== '' ? (o['name'] as string) : null
    out.push({ id: String(id), name })
  }
  return out
}

/** The custom audiences an ad set targets and excludes, read from its raw targeting spec. */
export function targetingAudiences(raw: Record<string, unknown> | null): { included: TargetedAudience[]; excluded: TargetedAudience[] } {
  const t = raw?.['targeting']
  if (!t || typeof t !== 'object') return { included: [], excluded: [] }
  const spec = t as Record<string, unknown>
  return { included: audienceList(spec['custom_audiences']), excluded: audienceList(spec['excluded_custom_audiences']) }
}

/** Audience id to role, from every ad set's targeting. Exclusion wins a tie. */
export function deriveRoles(adsets: AdsetMirrorRow[]): Map<string, AdAudienceRole> {
  const roles = new Map<string, AdAudienceRole>()
  for (const a of adsets) {
    const { included, excluded } = targetingAudiences(a.raw)
    for (const x of included) if (!roles.has(x.id)) roles.set(x.id, 'targeting')
    for (const x of excluded) roles.set(x.id, 'exclusion')
  }
  return roles
}

export function planAudienceUpsert(audiences: NormalizedAudience[], adsets: AdsetMirrorRow[]): AudienceUpsertRow[] {
  const roles = deriveRoles(adsets)
  // The same id twice in one pull keeps the last copy, so one upsert never hits a row twice.
  const byId = new Map<string, NormalizedAudience>()
  for (const a of audiences) byId.set(a.externalId, a)
  return [...byId.values()].map(a => ({
    platform: a.platform,
    externalId: a.externalId,
    name: a.name,
    kind: a.kind,
    role: roles.get(a.externalId) ?? 'unknown',
    approxSize: a.approxSize,
    status: a.status ?? null,
    raw: a.raw ?? null,
  }))
}

/** Ad sets that still exist on the platform. Paused ones count: M8 is about launch readiness. */
const GONE = new Set(['DELETED', 'ARCHIVED'])
export function isLiveAdset(a: AdsetMirrorRow): boolean {
  return a.status !== 'MISSING' && !GONE.has(a.effectiveStatus ?? '') && !GONE.has(a.status ?? '')
}

const CUSTOMER_RE = /customer/i
const SUBSCRIBER_RE = /subscriber|klaviyo|email list/i

/**
 * The M8 pair by name: the audiences the weekly sync owns (ticket #16687,
 * "xdipx buyers (exclude)" and "xdipx leads (exclude)") count first, then any
 * audience whose name says customer or subscriber.
 */
export function isCustomerExclusion(name: string | null): boolean {
  return name !== null && (audienceSyncKeyOfName(name) === 'buyers' || CUSTOMER_RE.test(name))
}
export function isSubscriberExclusion(name: string | null): boolean {
  return name !== null && (audienceSyncKeyOfName(name) === 'leads' || SUBSCRIBER_RE.test(name))
}

export interface ExclusionAudit {
  externalId: string
  name: string | null
  effectiveStatus: string | null
  /** True when the ad set excludes at least two custom audiences. */
  ok: boolean
  excluded: TargetedAudience[]
  /** The M8 pair, matched by audience name when the names say so. */
  customer: TargetedAudience | null
  subscriber: TargetedAudience | null
}

/**
 * One verdict per live Meta ad set. Names come from the audience mirror
 * first and the targeting spec second, so a renamed audience reads current.
 */
export function auditExclusionsFrom(adsets: AdsetMirrorRow[], audiences: Pick<AudienceRow, 'externalId' | 'name'>[]): ExclusionAudit[] {
  const names = new Map(audiences.map(a => [a.externalId, a.name]))
  return adsets
    .filter(a => a.platform === 'meta' && isLiveAdset(a))
    .map(a => {
      const excluded = targetingAudiences(a.raw).excluded.map(x => ({ id: x.id, name: names.get(x.id) ?? x.name }))
      const customer = excluded.find(x => isCustomerExclusion(x.name)) ?? null
      const subscriber = excluded.find(x => x !== customer && isSubscriberExclusion(x.name)) ?? null
      return {
        externalId: a.externalId,
        name: a.name,
        effectiveStatus: a.effectiveStatus,
        ok: excluded.length >= 2,
        excluded,
        customer,
        subscriber,
      }
    })
    .sort((x, y) => Number(x.ok) - Number(y.ok) || (x.name ?? '').localeCompare(y.name ?? ''))
}

// ---------------------------------------------------------------------------
// Entry points.
// ---------------------------------------------------------------------------

const registryAdapter = (channel: ChannelId): ChannelAdapter | null => getChannel(channel)?.adapter ?? null

export class AudienceSyncError extends Error {
  constructor(readonly channel: string, message: string) {
    super(message)
    this.name = 'AudienceSyncError'
  }
}

/** Pull one channel's audiences and upsert them. Throws when the channel cannot list audiences or the pull fails. */
export async function syncChannelAudiences(channel: ChannelId, deps: AudienceDeps = {}): Promise<AudienceSyncResult> {
  const adapter = (deps.adapterFor ?? registryAdapter)(channel)
  if (!adapter?.audiences || adapter.capabilities.audiences === 'none') {
    throw new AudienceSyncError(channel, `Channel ${channel} cannot list audiences.`)
  }
  const store = deps.store ?? drizzleAudienceStore()
  const now = (deps.now ?? (() => new Date()))()
  const [audiences, adsets] = await Promise.all([adapter.audiences.list(), store.adsets(channel)])
  const rows = planAudienceUpsert(audiences, adsets)
  const outcomes = rows.length > 0 ? await store.upsert(rows, now) : []
  const byRole: Record<AdAudienceRole, number> = { targeting: 0, exclusion: 0, unknown: 0 }
  for (const r of rows) byRole[r.role]++
  const inserted = outcomes.filter(o => o.inserted).length
  return { channel, seen: rows.length, inserted, updated: outcomes.length - inserted, byRole, syncedAt: now.toISOString() }
}

/** The M8 check over the mirror. Reads our database only, never the platform. */
export async function auditExclusions(deps: Pick<AudienceDeps, 'store'> = {}): Promise<ExclusionAudit[]> {
  const store = deps.store ?? drizzleAudienceStore()
  const [adsets, audiences] = await Promise.all([store.adsets('meta'), store.list('meta')])
  return auditExclusionsFrom(adsets, audiences)
}

export interface AudienceView {
  platform: string
  externalId: string
  name: string | null
  kind: AdAudienceKind
  role: AdAudienceRole
  sizeLower: number | null
  sizeUpper: number | null
  status: string | null
  syncedAt: string
}

function bound(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

/** Everything /admin/ads/audiences renders, from the mirror. */
export async function loadAudiencesPage(store: AudienceStore = drizzleAudienceStore()) {
  const [adsets, audiences] = await Promise.all([store.adsets('meta'), store.list()])
  const rows: AudienceView[] = audiences.map(a => ({
    platform: a.platform,
    externalId: a.externalId,
    name: a.name,
    kind: a.kind,
    role: a.role,
    sizeLower: a.approxSize,
    sizeUpper: bound(a.raw?.['approximate_count_upper_bound']),
    status: a.status,
    syncedAt: a.syncedAt.toISOString(),
  }))
  const exclusions = auditExclusionsFrom(adsets, audiences.filter(a => a.platform === 'meta'))
  const lastSyncedAt = rows.reduce<string | null>((m, r) => (m === null || r.syncedAt > m ? r.syncedAt : m), null)
  return { audiences: rows, exclusions, lastSyncedAt }
}

// ---------------------------------------------------------------------------
// The Drizzle store.
// ---------------------------------------------------------------------------

/** The INSERT ... ON CONFLICT for one batch. Exported so a test can read its SQL without a database. */
export function buildAudienceUpsertQuery(database: DB, rows: AudienceUpsertRow[], now: Date) {
  const t = adAudiences
  return database
    .insert(t)
    .values(rows.map(r => ({ ...r, syncedAt: now })))
    .onConflictDoUpdate({
      target: [t.platform, t.externalId],
      set: {
        name: sql`excluded.name`,
        kind: sql`excluded.kind`,
        role: sql`excluded.role`,
        approxSize: sql`excluded.approx_size`,
        status: sql`excluded.status`,
        raw: sql`excluded.raw`,
        syncedAt: sql`excluded.synced_at`,
      },
    })
    .returning({
      externalId: t.externalId,
      // xmax is 0 on a freshly inserted tuple and non-zero on one the conflict branch updated.
      inserted: sql<boolean>`(xmax = 0)`,
    })
}

const UPSERT_CHUNK = 200

export function drizzleAudienceStore(database: DB = defaultDb): AudienceStore {
  return {
    async adsets(platform) {
      const e = adPlatformEntities
      const rows = await database
        .select({
          platform: e.platform, externalId: e.externalId, name: e.name,
          status: e.status, effectiveStatus: e.effectiveStatus, raw: e.raw,
        })
        .from(e)
        .where(and(eq(e.platform, platform), eq(e.level, 'adset'), or(isNull(e.status), ne(e.status, 'MISSING'))))
      return rows
    },

    async upsert(rows, now) {
      const out: Array<{ externalId: string; inserted: boolean }> = []
      for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        const got = await buildAudienceUpsertQuery(database, rows.slice(i, i + UPSERT_CHUNK), now)
        for (const r of got) out.push({ externalId: r.externalId, inserted: r.inserted === true })
      }
      return out
    },

    async list(platform) {
      const t = adAudiences
      const rows = await database
        .select()
        .from(t)
        .where(platform ? eq(t.platform, platform) : undefined)
        .orderBy(t.role, desc(t.approxSize), t.name)
      return rows.map(r => ({
        platform: r.platform,
        externalId: r.externalId,
        name: r.name,
        kind: r.kind ?? 'custom',
        role: r.role ?? 'unknown',
        approxSize: r.approxSize,
        status: r.status,
        raw: r.raw,
        syncedAt: r.syncedAt,
      }))
    },
  }
}
