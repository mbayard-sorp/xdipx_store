/**
 * Ads Control Plane experiment log, database half (migration 133, ticket
 * #16436, plan sections 3.3, 9.2 and 9.5). CRUD on ad_experiments plus the
 * per-arm metric sums the console compares. It never talks to a platform
 * and never decides: start, decide and abandon are owner clicks, and the
 * route checks the owner session before it calls any write here.
 *
 * Every function takes its store or source as an argument with a Neon
 * default, so tests run against in-memory fakes.
 */
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import {
  adCreativeDailyMetrics,
  adExperiments,
  adPlatformEntities,
  adPlatformInsightsDaily,
} from '../../../db/schema'
import {
  assertExperimentTransition,
  compareArms,
  type AdExperimentArm,
  type AdExperimentStatus,
  type ArmComparison,
  type ArmMetrics,
  type NewExperimentInput,
} from './experiments-core'

export type AdExperimentRow = typeof adExperiments.$inferSelect

// ─── Store ───────────────────────────────────────────────────────────────────

export interface ExperimentPatch {
  status: AdExperimentStatus
  startsAt?: Date | null
  endsAt?: Date | null
  verdict?: string | null
  decidedBy?: string | null
  notes?: string | null
}

export interface ExperimentStore {
  list(status: AdExperimentStatus | null, limit: number): Promise<AdExperimentRow[]>
  get(id: number): Promise<AdExperimentRow | null>
  insert(input: NewExperimentInput): Promise<AdExperimentRow>
  /** Writes only when the row is still in fromStatus. Returns null when another click won. */
  update(id: number, fromStatus: AdExperimentStatus, patch: ExperimentPatch): Promise<AdExperimentRow | null>
}

export const dbExperimentStore: ExperimentStore = {
  async list(status, limit) {
    const q = db.select().from(adExperiments)
    const rows = status
      ? await q.where(eq(adExperiments.status, status)).orderBy(desc(adExperiments.createdAt)).limit(limit)
      : await q.orderBy(desc(adExperiments.createdAt)).limit(limit)
    return rows
  },
  async get(id) {
    const rows = await db.select().from(adExperiments).where(eq(adExperiments.id, id)).limit(1)
    return rows[0] ?? null
  },
  async insert(input) {
    const rows = await db
      .insert(adExperiments)
      .values({
        hypothesis: input.hypothesis,
        variable: input.variable,
        arms: input.arms,
        primaryMetric: input.primaryMetric,
        minSpendCents: input.minSpendCents,
        notes: input.notes,
        status: 'planned',
      })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('The experiment insert returned no row.')
    return row
  },
  async update(id, fromStatus, patch) {
    const rows = await db
      .update(adExperiments)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(adExperiments.id, id), eq(adExperiments.status, fromStatus)))
      .returning()
    return rows[0] ?? null
  },
}

export class ExperimentNotFoundError extends Error {
  constructor(id: number) {
    super(`Experiment ${id} does not exist.`)
    this.name = 'ExperimentNotFoundError'
  }
}

export class ExperimentConflictError extends Error {
  constructor(id: number) {
    super(`Experiment ${id} changed while you were looking at it. Reload and try again.`)
    this.name = 'ExperimentConflictError'
  }
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export function listExperiments(status: AdExperimentStatus | null, store: ExperimentStore = dbExperimentStore, limit = 50) {
  return store.list(status, limit)
}

/** New experiments always start life as planned. */
export function createExperiment(input: NewExperimentInput, store: ExperimentStore = dbExperimentStore) {
  return store.insert(input)
}

async function move(
  id: number,
  to: AdExperimentStatus,
  patch: Omit<ExperimentPatch, 'status'>,
  store: ExperimentStore,
): Promise<AdExperimentRow> {
  const row = await store.get(id)
  if (!row) throw new ExperimentNotFoundError(id)
  assertExperimentTransition(row.status, to)
  const updated = await store.update(id, row.status, { ...patch, status: to })
  if (!updated) throw new ExperimentConflictError(id)
  return updated
}

/** planned to running. starts_at is the click, so metrics sum from then. */
export function startExperiment(id: number, store: ExperimentStore = dbExperimentStore, now = new Date()) {
  return move(id, 'running', { startsAt: now }, store)
}

/** running to decided, with the owner's verdict in their own words. */
export async function decideExperiment(
  id: number,
  verdict: string,
  decidedBy: string,
  store: ExperimentStore = dbExperimentStore,
  now = new Date(),
) {
  const text = verdict.trim()
  if (!text) throw new Error('Write the verdict before you decide.')
  return move(id, 'decided', { verdict: text.slice(0, 2000), decidedBy, endsAt: now }, store)
}

/** planned or running to abandoned. A running experiment's window closes now. */
export async function abandonExperiment(
  id: number,
  decidedBy: string,
  store: ExperimentStore = dbExperimentStore,
  now = new Date(),
) {
  const row = await store.get(id)
  if (!row) throw new ExperimentNotFoundError(id)
  const endsAt = row.status === 'running' ? now : row.endsAt
  return move(id, 'abandoned', { decidedBy, endsAt }, store)
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export interface ExperimentMetricsSource {
  /** Ad external ids under an arm: the ad itself, or every ad below an ad set or campaign. */
  adsUnder(arm: AdExperimentArm): Promise<string[]>
  /** Sums of ad-level ad_platform_insights_daily rows for those ads between two days (inclusive). */
  insightTotals(platform: string, adIds: string[], fromDay: string, toDay: string): Promise<{ spendCents: number; impressions: number; leads: number }>
  /** Ad Studio creative ids linked to those ads in the entity mirror. */
  creativeIdsFor(platform: string, adIds: string[]): Promise<number[]>
  /** Sums of ad_creative_daily_metrics orders and net revenue for those creatives between two days. */
  creativeTotals(creativeIds: number[], fromDay: string, toDay: string): Promise<{ orders: number; netRevenueCents: number }>
}

const num = (v: unknown) => (v == null ? 0 : Number(v) || 0)

export const dbMetricsSource: ExperimentMetricsSource = {
  async adsUnder(arm) {
    if (arm.level === 'ad') return [arm.externalId]
    const e = adPlatformEntities
    let parents = [arm.externalId]
    if (arm.level === 'campaign') {
      const sets = await db.select({ id: e.externalId }).from(e)
        .where(and(eq(e.platform, arm.platform), eq(e.level, 'adset'), eq(e.parentExternalId, arm.externalId)))
      parents = sets.map(s => s.id)
      if (parents.length === 0) return []
    }
    const ads = await db.select({ id: e.externalId }).from(e)
      .where(and(eq(e.platform, arm.platform), eq(e.level, 'ad'), inArray(e.parentExternalId, parents)))
    return ads.map(a => a.id)
  },
  async insightTotals(platform, adIds, fromDay, toDay) {
    if (adIds.length === 0) return { spendCents: 0, impressions: 0, leads: 0 }
    const t = adPlatformInsightsDaily
    const rows = await db
      .select({
        spend: sql<string>`coalesce(sum(${t.spendCents}), 0)`,
        impressions: sql<string>`coalesce(sum(${t.impressions}), 0)`,
        leads: sql<string>`coalesce(sum(${t.leads}), 0)`,
      })
      .from(t)
      .where(and(eq(t.platform, platform), eq(t.level, 'ad'), inArray(t.externalId, adIds), gte(t.day, fromDay), lte(t.day, toDay)))
    const r = rows[0]
    return { spendCents: num(r?.spend), impressions: num(r?.impressions), leads: num(r?.leads) }
  },
  async creativeIdsFor(platform, adIds) {
    if (adIds.length === 0) return []
    const e = adPlatformEntities
    const rows = await db.select({ creativeId: e.creativeId }).from(e)
      .where(and(eq(e.platform, platform), inArray(e.externalId, adIds), isNotNull(e.creativeId)))
    return [...new Set(rows.map(r => r.creativeId).filter((v): v is number => v != null))]
  },
  async creativeTotals(creativeIds, fromDay, toDay) {
    if (creativeIds.length === 0) return { orders: 0, netRevenueCents: 0 }
    const t = adCreativeDailyMetrics
    const rows = await db
      .select({
        orders: sql<string>`coalesce(sum(${t.orders}), 0)`,
        revenue: sql<string>`coalesce(sum(${t.netRevenueCents}), 0)`,
      })
      .from(t)
      .where(and(inArray(t.creativeId, creativeIds), gte(t.day, fromDay), lte(t.day, toDay)))
    const r = rows[0]
    return { orders: num(r?.orders), netRevenueCents: num(r?.revenue) }
  },
}

const ZERO: ArmMetrics = { spendCents: 0, impressions: 0, leads: 0, orders: 0, netRevenueCents: 0 }
const isoDay = (d: Date) => d.toISOString().slice(0, 10)

export interface ArmMetricsRow {
  arm: AdExperimentArm
  metrics: ArmMetrics
}

/**
 * Per-arm totals between starts_at and ends_at (or now). A planned
 * experiment has no window yet and gets zeros for every arm.
 */
export async function loadExperimentMetrics(
  experiment: Pick<AdExperimentRow, 'arms' | 'startsAt' | 'endsAt'>,
  source: ExperimentMetricsSource = dbMetricsSource,
  now = new Date(),
): Promise<ArmMetricsRow[]> {
  const arms = experiment.arms ?? []
  if (!experiment.startsAt) return arms.map(arm => ({ arm, metrics: { ...ZERO } }))
  const fromDay = isoDay(new Date(experiment.startsAt))
  const end = experiment.endsAt ? new Date(experiment.endsAt) : now
  const toDay = isoDay(end.getTime() < now.getTime() ? end : now)
  return Promise.all(arms.map(async arm => {
    const adIds = await source.adsUnder(arm)
    const [ins, creativeIds] = await Promise.all([
      source.insightTotals(arm.platform, adIds, fromDay, toDay),
      source.creativeIdsFor(arm.platform, adIds),
    ])
    const cr = await source.creativeTotals(creativeIds, fromDay, toDay)
    return { arm, metrics: { ...ins, ...cr } }
  }))
}

// ─── Page assembly ───────────────────────────────────────────────────────────

export interface EntityOption {
  value: string
  label: string
  level: AdExperimentArm['level']
}

export interface EntityOptionSource {
  options(limit: number): Promise<EntityOption[]>
}

export const dbEntityOptions: EntityOptionSource = {
  async options(limit) {
    const e = adPlatformEntities
    const rows = await db
      .select({ platform: e.platform, level: e.level, externalId: e.externalId, name: e.name, effectiveStatus: e.effectiveStatus })
      .from(e)
      .where(inArray(e.level, ['campaign', 'adset', 'ad']))
      .orderBy(e.level, e.name)
      .limit(limit)
    return rows.map(r => toOption(r))
  },
}

const LEVEL_WORD: Record<AdExperimentArm['level'], string> = { campaign: 'Campaign', adset: 'Ad set', ad: 'Ad' }

export function toOption(r: { platform: string; level: string; externalId: string; name: string | null; effectiveStatus?: string | null }): EntityOption {
  const level = r.level as AdExperimentArm['level']
  const status = r.effectiveStatus ? `, ${r.effectiveStatus.toLowerCase()}` : ''
  return {
    value: `${r.platform}|${level}|${r.externalId}`,
    label: `${LEVEL_WORD[level] ?? level}: ${r.name || r.externalId} (${r.platform}${status})`,
    level,
  }
}

export interface ExperimentCard {
  experiment: AdExperimentRow
  comparison: ArmComparison
}

export interface ExperimentsPageDeps {
  store: ExperimentStore
  metrics: ExperimentMetricsSource
  entities: EntityOptionSource
}

export const defaultPageDeps: ExperimentsPageDeps = {
  store: dbExperimentStore,
  metrics: dbMetricsSource,
  entities: dbEntityOptions,
}

/** Everything the experiments page renders, in one call the loader makes. */
export async function loadExperimentsPage(
  status: AdExperimentStatus | null,
  deps: ExperimentsPageDeps = defaultPageDeps,
  now = new Date(),
): Promise<{ cards: ExperimentCard[]; options: EntityOption[] }> {
  const [rows, options] = await Promise.all([deps.store.list(status, 50), deps.entities.options(400)])
  const cards = await Promise.all(rows.map(async experiment => {
    const arms = await loadExperimentMetrics(experiment, deps.metrics, now)
    const comparison = compareArms(arms, {
      metric: experiment.primaryMetric,
      minSpendCents: experiment.minSpendCents,
      startsAt: experiment.startsAt ? new Date(experiment.startsAt) : null,
      endsAt: experiment.endsAt ? new Date(experiment.endsAt) : null,
      now,
    })
    return { experiment, comparison }
  }))
  return { cards, options }
}
