/**
 * Entity sync for the Ads Control Plane (plan §3.4, phase 1c, ticket #16405).
 *
 * Pulls every campaign, ad set and ad a channel's adapter reports and upserts
 * them into ad_platform_entities on (platform, external_id). The adapter only
 * reads the platform; this module only writes our own database. Nothing here
 * calls a platform write endpoint.
 *
 * Rules the upsert keeps:
 * - first_seen_at is set on insert and never touched again; last_synced_at
 *   moves on every sync that returns the row.
 * - An ad row links to its Ad Studio creative through ad_creatives.external_ad_id.
 *   A link found once is kept when a later sync finds none, so a creative row
 *   that loses its external_ad_id does not orphan the mirror.
 * - A row the platform stopped returning is marked status 'MISSING', and only
 *   after a full sync (no `since`) finished cleanly. A partial or failed pull
 *   never marks anything missing, because absence there means nothing. Neither
 *   does a full pull that came back empty.
 *
 * Callers: GET /cron/ads-sync-entities every 6 hours, and syncAfterWrite for
 * phase 5's read-after-write once mutations exist.
 */
import { and, asc, eq, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm'

import { db as defaultDb, type DB } from '~/lib/db.server'
import { adCreatives, adPlatformEntities } from '../../../db/schema'
import { getChannel, listChannels } from './channels/registry.server'
import type { ChannelAdapter, ChannelId, EntityLevel, NormalizedEntity, TokenHealth } from './channels/types'

export const MISSING_STATUS = 'MISSING'

const LEVELS: readonly EntityLevel[] = ['campaign', 'adset', 'ad', 'creative']

/** One row ready for the upsert: the normalized entity plus the resolved creative link. */
export interface EntityUpsertRow extends NormalizedEntity {
  creativeId: number | null
}

export interface UpsertOutcome {
  externalId: string
  level: EntityLevel
  inserted: boolean
}

/**
 * The database half of the sync, behind an interface so the planning logic
 * is testable without a database. drizzleEntityStore is the only real one.
 */
export interface EntityStore {
  /** ad_creatives.id keyed by external_ad_id, for the ids asked about. */
  creativeIdsByExternalAdId(externalAdIds: string[]): Promise<Map<string, number>>
  upsert(rows: EntityUpsertRow[], now: Date): Promise<UpsertOutcome[]>
  /** Marks every row on the platform outside seenExternalIds as MISSING. Returns the levels it changed. */
  markMissing(platform: string, seenExternalIds: string[]): Promise<EntityLevel[]>
}

export interface LevelCounts {
  seen: number
  inserted: number
  updated: number
  missing: number
}

export type SyncCounts = Record<EntityLevel, LevelCounts>

export interface SyncResult {
  channel: ChannelId
  /** True when this pass marked rows MISSING: a full pull that returned at least one row. */
  full: boolean
  counts: SyncCounts
  /** Ad rows linked to an ad_creatives row on this pass. */
  creativeMatches: number
  syncedAt: string
}

export interface SyncDeps {
  store?: EntityStore
  /** Resolves a channel's adapter. Defaults to the registry. */
  adapterFor?: (channel: ChannelId) => ChannelAdapter | null
  now?: () => Date
}

export class SyncError extends Error {
  constructor(readonly channel: string, message: string) {
    super(message)
    this.name = 'SyncError'
  }
}

function emptyCounts(): SyncCounts {
  const out = {} as SyncCounts
  for (const l of LEVELS) out[l] = { seen: 0, inserted: 0, updated: 0, missing: 0 }
  return out
}

const registryAdapter = (channel: ChannelId): ChannelAdapter | null => getChannel(channel)?.adapter ?? null

function resolveAdapter(channel: ChannelId, deps: SyncDeps): ChannelAdapter {
  const adapter = (deps.adapterFor ?? registryAdapter)(channel)
  if (!adapter) throw new SyncError(channel, `Channel ${channel} has no adapter.`)
  if (!adapter.capabilities.read) throw new SyncError(channel, `Channel ${channel} cannot read entities.`)
  return adapter
}

/** The same external id twice in one pull keeps the last copy, so one upsert never hits a row twice. */
function dedupe(entities: NormalizedEntity[]): NormalizedEntity[] {
  const byId = new Map<string, NormalizedEntity>()
  for (const e of entities) byId.set(e.externalId, e)
  return [...byId.values()]
}

async function upsertEntities(
  channel: ChannelId,
  entities: NormalizedEntity[],
  opts: { full: boolean },
  deps: SyncDeps,
): Promise<SyncResult> {
  const store = deps.store ?? drizzleEntityStore()
  const now = (deps.now ?? (() => new Date()))()
  const rows = dedupe(entities)
  const counts = emptyCounts()

  const adIds = rows.filter(r => r.level === 'ad').map(r => r.externalId)
  const creativeByAd = adIds.length > 0 ? await store.creativeIdsByExternalAdId(adIds) : new Map<string, number>()

  const upsertRows: EntityUpsertRow[] = rows.map(r => ({
    ...r,
    creativeId: r.level === 'ad' ? creativeByAd.get(r.externalId) ?? null : null,
  }))
  const creativeMatches = upsertRows.filter(r => r.creativeId !== null).length

  for (const r of rows) counts[r.level].seen++
  const outcomes = rows.length > 0 ? await store.upsert(upsertRows, now) : []
  for (const o of outcomes) counts[o.level][o.inserted ? 'inserted' : 'updated']++

  // An empty pull marks nothing. A real account that lost every entity at once
  // is far less likely than a wrong account id or a token that sees nothing.
  const full = opts.full && rows.length > 0
  if (full) {
    const changed = await store.markMissing(channel, rows.map(r => r.externalId))
    for (const level of changed) counts[level].missing++
  }

  return { channel, full, counts, creativeMatches, syncedAt: now.toISOString() }
}

/**
 * Full sync for one channel. Throws when the channel has no readable adapter
 * or the pull fails; in either case nothing is marked MISSING.
 */
export async function syncChannelEntities(channel: ChannelId, deps: SyncDeps = {}): Promise<SyncResult> {
  const adapter = resolveAdapter(channel, deps)
  const entities = await adapter.syncEntities({})
  return upsertEntities(channel, entities, { full: true }, deps)
}

/**
 * Read-after-write for phase 5: re-pull the channel and upsert only the
 * entities a mutation touched. The adapter interface has no per-id fetch, so
 * this pulls the account and filters, which is a few dozen rows today. Never
 * marks anything MISSING. notFound lists the ids the platform did not return.
 */
export async function syncAfterWrite(
  platform: ChannelId,
  externalIds: string[],
  deps: SyncDeps = {},
): Promise<SyncResult & { notFound: string[] }> {
  const wanted = new Set(externalIds)
  if (wanted.size === 0) {
    const now = (deps.now ?? (() => new Date()))()
    return { channel: platform, full: false, counts: emptyCounts(), creativeMatches: 0, syncedAt: now.toISOString(), notFound: [] }
  }
  const adapter = resolveAdapter(platform, deps)
  const entities = (await adapter.syncEntities({})).filter(e => wanted.has(e.externalId))
  const result = await upsertEntities(platform, entities, { full: false }, deps)
  const found = new Set(entities.map(e => e.externalId))
  return { ...result, notFound: [...wanted].filter(id => !found.has(id)) }
}

export interface ChannelSyncReport {
  channel: ChannelId
  outcome: 'synced' | 'skipped' | 'failed'
  result?: SyncResult
  /** Why a channel was skipped or failed. */
  reason?: string
  health?: Pick<TokenHealth, 'valid' | 'expiresAt' | 'error'>
}

/**
 * The cron's body: sync every channel that has a readable adapter and a
 * valid token. One channel failing does not stop the others. Token problems
 * skip the channel here; the daily token health probe (phase 1d) is what
 * files a blocker for them.
 */
export async function syncAllChannels(
  deps: SyncDeps & { channels?: () => ChannelId[] } = {},
): Promise<ChannelSyncReport[]> {
  const ids = deps.channels
    ? deps.channels()
    : listChannels().filter(c => c.hasAdapter && c.capabilities?.read).map(c => c.id)
  const adapterFor = deps.adapterFor ?? registryAdapter
  const reports: ChannelSyncReport[] = []
  for (const channel of ids) {
    const adapter = adapterFor(channel)
    if (!adapter || !adapter.capabilities.read) {
      reports.push({ channel, outcome: 'skipped', reason: 'no readable adapter' })
      continue
    }
    let health: TokenHealth
    try {
      health = await adapter.auth.health()
    } catch (e) {
      reports.push({ channel, outcome: 'skipped', reason: `health check threw: ${(e as Error).message}` })
      continue
    }
    const healthSummary: ChannelSyncReport['health'] = {
      valid: health.valid,
      expiresAt: health.expiresAt,
      ...(health.error !== undefined ? { error: health.error } : {}),
    }
    if (!health.valid) {
      reports.push({ channel, outcome: 'skipped', reason: `token not valid: ${health.error ?? 'invalid'}`, health: healthSummary })
      continue
    }
    try {
      const result = await syncChannelEntities(channel, { ...deps, adapterFor: () => adapter })
      reports.push({ channel, outcome: 'synced', result, health: healthSummary })
    } catch (e) {
      reports.push({ channel, outcome: 'failed', reason: (e as Error).message, health: healthSummary })
    }
  }
  return reports
}

// ---------------------------------------------------------------------------
// The Drizzle store.
// ---------------------------------------------------------------------------

const UPSERT_CHUNK = 200

/** The INSERT ... ON CONFLICT for one chunk. Exported so a test can read its SQL without a database. */
export function buildUpsertQuery(database: DB, rows: EntityUpsertRow[], now: Date) {
  const t = adPlatformEntities
  return database
    .insert(t)
    .values(rows.map(r => ({
      platform: r.platform,
      accountId: r.accountId,
      level: r.level,
      externalId: r.externalId,
      parentExternalId: r.parentExternalId,
      name: r.name,
      status: r.status,
      effectiveStatus: r.effectiveStatus,
      objective: r.objective,
      dailyBudgetCents: r.dailyBudgetCents,
      lifetimeBudgetCents: r.lifetimeBudgetCents,
      bidStrategy: r.bidStrategy,
      creativeId: r.creativeId,
      reviewFeedback: r.reviewFeedback,
      raw: r.raw,
      firstSeenAt: now,
      lastSyncedAt: now,
    })))
    .onConflictDoUpdate({
      target: [t.platform, t.externalId],
      // first_seen_at is left out on purpose: it belongs to the insert.
      set: {
        accountId: sql`excluded.account_id`,
        level: sql`excluded.level`,
        parentExternalId: sql`excluded.parent_external_id`,
        name: sql`excluded.name`,
        status: sql`excluded.status`,
        effectiveStatus: sql`excluded.effective_status`,
        objective: sql`excluded.objective`,
        dailyBudgetCents: sql`excluded.daily_budget_cents`,
        lifetimeBudgetCents: sql`excluded.lifetime_budget_cents`,
        bidStrategy: sql`excluded.bid_strategy`,
        creativeId: sql`coalesce(excluded.creative_id, ${t.creativeId})`,
        reviewFeedback: sql`excluded.review_feedback`,
        raw: sql`excluded.raw`,
        lastSyncedAt: sql`excluded.last_synced_at`,
      },
    })
    .returning({
      externalId: t.externalId,
      level: t.level,
      // xmax is 0 on a freshly inserted tuple and non-zero on one the conflict branch updated.
      inserted: sql<boolean>`(xmax = 0)`,
    })
}

export function drizzleEntityStore(database: DB = defaultDb): EntityStore {
  const t = adPlatformEntities
  return {
    async creativeIdsByExternalAdId(externalAdIds) {
      const out = new Map<string, number>()
      if (externalAdIds.length === 0) return out
      const rows = await database
        .select({ id: adCreatives.id, externalAdId: adCreatives.externalAdId })
        .from(adCreatives)
        .where(inArray(adCreatives.externalAdId, externalAdIds))
        .orderBy(asc(adCreatives.id))
      // Lowest id wins when two creatives claim the same ad, so the link is stable run to run.
      for (const r of rows) if (r.externalAdId && !out.has(r.externalAdId)) out.set(r.externalAdId, r.id)
      return out
    },

    async upsert(rows, now) {
      const out: UpsertOutcome[] = []
      for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        const got = await buildUpsertQuery(database, rows.slice(i, i + UPSERT_CHUNK), now)
        for (const r of got) out.push({ externalId: r.externalId, level: r.level, inserted: r.inserted === true })
      }
      return out
    },

    async markMissing(platform, seenExternalIds) {
      const notAlready = or(isNull(t.status), ne(t.status, MISSING_STATUS))
      const where = seenExternalIds.length > 0
        ? and(eq(t.platform, platform), notInArray(t.externalId, seenExternalIds), notAlready)
        : and(eq(t.platform, platform), notAlready)
      const changed = await database
        .update(t)
        .set({ status: MISSING_STATUS })
        .where(where)
        .returning({ level: t.level })
      return changed.map(r => r.level)
    },
  }
}
