/**
 * The ads console's actions view (ticket #16430, plan §4, §5, §9.4 and §7
 * phase 4d). Reads the ad_actions ledger for /admin/ads/actions and records
 * the owner's approve and reject taps.
 *
 * Approving here applies nothing to a platform. It moves a proposed row to
 * approved, and Phase 5b's hourly applier picks approved rows up. The only
 * legal decisions are proposed -> approved and proposed -> rejected; every
 * other request comes back as a typed refusal instead of a thrown error.
 *
 * Reads and writes go through an ActionsViewStore so the tests run against
 * an in-memory fake. drizzleActionsViewStore is the production store.
 */
import { desc, eq, inArray, sql } from 'drizzle-orm'
import { db as defaultDb, type DB } from '~/lib/db.server'
import { adActions, adPlatformEntities } from '../../../db/schema'
import { transitionAction, type AdActionRow, type TransitionExtra } from './ledger.server'
import {
  IllegalAdActionTransitionError,
  type AdActionStatus,
  type AdActionTier,
  type AdActionVerb,
} from './ledger-core'

// ─── Tabs ────────────────────────────────────────────────────────────────────

export type ActionsTab = 'pending' | 'dry_run' | 'applied' | 'failed'

export const ACTIONS_TABS: readonly ActionsTab[] = ['pending', 'dry_run', 'applied', 'failed']

/**
 * Which ledger statuses each tab shows. Applied also carries approved rows,
 * the ones waiting for the applier, so a tap never makes a row vanish from
 * every tab. Failed carries everything that ended without reaching the
 * platform: failed, rejected and expired, each labelled.
 */
export const TAB_STATUSES: Readonly<Record<ActionsTab, readonly AdActionStatus[]>> = {
  pending: ['proposed'],
  dry_run: ['dry_run'],
  applied: ['applied', 'approved'],
  failed: ['failed', 'rejected', 'expired'],
}

export const TAB_LABELS: Readonly<Record<ActionsTab, string>> = {
  pending: 'Pending',
  dry_run: 'Dry run',
  applied: 'Applied',
  failed: 'Failed',
}

export function parseTab(value: string | null | undefined): ActionsTab {
  return ACTIONS_TABS.includes(value as ActionsTab) ? (value as ActionsTab) : 'pending'
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export const STATUS_LABELS: Readonly<Record<AdActionStatus, string>> = {
  proposed: 'Waiting for you',
  dry_run: 'Dry run',
  approved: 'Approved, waiting for the applier',
  applied: 'Applied',
  failed: 'Failed',
  rejected: 'Rejected',
  expired: 'Expired',
}

/** Plan §9.4 names the tiers A, B and C; the ledger stores auto, approve, owner. */
export const TIER_LABELS: Readonly<Record<AdActionTier, string>> = {
  auto: 'A: machine alone',
  approve: 'B: one tap',
  owner: 'C: owner only',
}

export const VERB_LABELS: Readonly<Record<AdActionVerb, string>> = {
  pause: 'Pause',
  resume: 'Resume',
  set_budget: 'Set budget',
  update_creative: 'Swap creative',
  halt_all: 'Halt everything',
}

const LEVEL_LABELS: Readonly<Record<string, string>> = {
  campaign: 'campaign',
  adset: 'ad set',
  ad: 'ad',
  creative: 'creative',
}

// ─── Store ───────────────────────────────────────────────────────────────────

/** The slice of an ad_platform_entities row the view reads. */
export interface MirrorEntity {
  platform: string
  level: string
  externalId: string
  parentExternalId: string | null
  name: string | null
  creativeId: number | null
}

/** The slice of a row a decision needs before it calls transition. */
export interface ActionHead {
  id: number
  status: AdActionStatus
  expiresAt: Date | null
}

export interface ActionsViewStore {
  /** Rows in any of `statuses`, newest first, at most `limit`. */
  list(statuses: readonly AdActionStatus[], limit: number): Promise<AdActionRow[]>
  /** Row count per status across the whole ledger. */
  counts(): Promise<Partial<Record<AdActionStatus, number>>>
  /** Mirror rows whose external id is in `externalIds`, any platform. */
  entities(externalIds: readonly string[]): Promise<MirrorEntity[]>
  head(id: number): Promise<ActionHead | null>
  transition(id: number, to: AdActionStatus, actor: string, extra?: TransitionExtra): Promise<AdActionRow>
}

export function drizzleActionsViewStore(database: DB = defaultDb): ActionsViewStore {
  return {
    async list(statuses, limit) {
      return database
        .select()
        .from(adActions)
        .where(inArray(adActions.status, [...statuses]))
        .orderBy(desc(adActions.createdAt), desc(adActions.id))
        .limit(limit)
    },
    async counts() {
      const rows = await database
        .select({ status: adActions.status, n: sql<number>`count(*)::int` })
        .from(adActions)
        .groupBy(adActions.status)
      const out: Partial<Record<AdActionStatus, number>> = {}
      for (const r of rows) out[r.status] = Number(r.n)
      return out
    },
    async entities(externalIds) {
      if (externalIds.length === 0) return []
      return database
        .select({
          platform: adPlatformEntities.platform,
          level: adPlatformEntities.level,
          externalId: adPlatformEntities.externalId,
          parentExternalId: adPlatformEntities.parentExternalId,
          name: adPlatformEntities.name,
          creativeId: adPlatformEntities.creativeId,
        })
        .from(adPlatformEntities)
        .where(inArray(adPlatformEntities.externalId, [...externalIds]))
    },
    async head(id) {
      const [row] = await database
        .select({ id: adActions.id, status: adActions.status, expiresAt: adActions.expiresAt })
        .from(adActions)
        .where(eq(adActions.id, id))
        .limit(1)
      return row ?? null
    },
    transition: (id, to, actor, extra) => transitionAction(id, to, actor, extra),
  }
}

// ─── Target naming ───────────────────────────────────────────────────────────

const key = (platform: string, externalId: string) => `${platform}|${externalId}`

/**
 * Loads every target plus its ancestors from the mirror. Campaign > ad set >
 * ad is at most three hops, so this asks the store at most three times.
 */
async function loadMirror(store: ActionsViewStore, rows: readonly AdActionRow[]): Promise<Map<string, MirrorEntity>> {
  const byKey = new Map<string, MirrorEntity>()
  let wanted = new Set(rows.map(r => r.targetExternalId))
  const asked = new Set<string>()
  for (let hop = 0; hop < 3 && wanted.size > 0; hop++) {
    const ids = [...wanted].filter(id => !asked.has(id))
    if (ids.length === 0) break
    ids.forEach(id => asked.add(id))
    const found = await store.entities(ids)
    const next = new Set<string>()
    for (const e of found) {
      byKey.set(key(e.platform, e.externalId), e)
      if (e.parentExternalId && !asked.has(e.parentExternalId)) next.add(e.parentExternalId)
    }
    wanted = next
  }
  return byKey
}

export interface ActionTarget {
  level: string
  externalId: string
  /** Campaign first, the target last. A name falls back to its external id. */
  path: string[]
  /** The path joined with " > ", or "ad 123" when the mirror lacks the target. */
  label: string
  inMirror: boolean
}

export function describeTarget(
  platform: string,
  level: string,
  externalId: string,
  mirror: ReadonlyMap<string, MirrorEntity>,
): { target: ActionTarget; creativeId: number | null } {
  const self = mirror.get(key(platform, externalId))
  if (!self) {
    const label = `${LEVEL_LABELS[level] ?? level} ${externalId}`
    return { target: { level, externalId, path: [label], label, inMirror: false }, creativeId: null }
  }
  const chain: MirrorEntity[] = [self]
  let cursor = self
  while (cursor.parentExternalId && chain.length < 4) {
    const parent = mirror.get(key(platform, cursor.parentExternalId))
    if (!parent) break
    chain.unshift(parent)
    cursor = parent
  }
  const path = chain.map(e => e.name?.trim() || e.externalId)
  const creativeId = self.level === 'ad' ? self.creativeId ?? null : null
  return { target: { level, externalId, path, label: path.join(' > '), inMirror: true }, creativeId }
}

// ─── Before and after ────────────────────────────────────────────────────────

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/**
 * One short line for a before or after value: a daily or lifetime budget in
 * dollars, a status, or the JSON when it is neither. Null stays null.
 */
export function describeValue(v: Record<string, unknown> | null | undefined): string | null {
  if (!v || typeof v !== 'object') return null
  const parts: string[] = []
  const daily = v['dailyBudgetCents']
  const lifetime = v['lifetimeBudgetCents']
  const status = v['status']
  if (typeof daily === 'number') parts.push(`${usd.format(daily / 100)} a day`)
  if (typeof lifetime === 'number') parts.push(`${usd.format(lifetime / 100)} lifetime`)
  if (typeof status === 'string') parts.push(status)
  if (parts.length > 0) return parts.join(', ')
  const json = JSON.stringify(v)
  return json === '{}' ? null : clip(json, 120)
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** The error when there is one, otherwise a short form of the platform response. */
export function describeOutcome(row: Pick<AdActionRow, 'error' | 'platformResponse'>): string | null {
  if (row.error) return row.error
  if (row.platformResponse == null) return null
  const text = typeof row.platformResponse === 'string' ? row.platformResponse : JSON.stringify(row.platformResponse)
  return clip(text, 200)
}

// ─── Rows ────────────────────────────────────────────────────────────────────

export type RefusalCode = 'not_found' | 'rejected' | 'dry_run' | 'expired' | 'not_pending' | 'raced'

export interface ActionView {
  id: number
  platform: string
  verb: AdActionVerb
  verbLabel: string
  status: AdActionStatus
  statusLabel: string
  tier: AdActionTier
  tierLabel: string
  target: ActionTarget
  creativeId: number | null
  /** rule:R5, agent:paid-media-buyer, owner, or an admin email. */
  proposedBy: string
  reason: string | null
  before: string | null
  after: string | null
  createdAt: string
  decidedBy: string | null
  decidedAt: string | null
  appliedAt: string | null
  expiresAt: string | null
  /** platform_response or error. On a rejected row, the owner's note. */
  outcome: string | null
  /** True only for a proposed row that has not passed its expiry. */
  decidable: boolean
  /** Why a row cannot be decided, in one plain sentence. Null when it can. */
  lockedReason: string | null
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

function lockReason(status: AdActionStatus, expiresAt: Date | null, now: Date): { code: RefusalCode; message: string } | null {
  switch (status) {
    case 'proposed':
      return expiresAt && expiresAt.getTime() <= now.getTime()
        ? { code: 'expired', message: 'This action passed its expiry, so it can no longer be approved.' }
        : null
    case 'rejected':
      return { code: 'rejected', message: 'This action was rejected, so it cannot be approved.' }
    case 'dry_run':
      return { code: 'dry_run', message: 'Dry-run rows are a record of what would have happened, so there is nothing to approve.' }
    case 'expired':
      return { code: 'expired', message: 'This action expired, so it can no longer be approved.' }
    default:
      return { code: 'not_pending', message: `This action is ${STATUS_LABELS[status].toLowerCase()}, so there is nothing left to decide.` }
  }
}

export function toActionView(row: AdActionRow, mirror: ReadonlyMap<string, MirrorEntity>, now: Date): ActionView {
  const { target, creativeId } = describeTarget(row.platform, row.targetLevel, row.targetExternalId, mirror)
  const lock = lockReason(row.status, row.expiresAt, now)
  return {
    id: row.id,
    platform: row.platform,
    verb: row.verb,
    verbLabel: VERB_LABELS[row.verb] ?? row.verb,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] ?? row.status,
    tier: row.tier,
    tierLabel: TIER_LABELS[row.tier] ?? row.tier,
    target,
    creativeId,
    proposedBy: row.proposedBy,
    reason: row.reason,
    before: describeValue(row.before),
    after: describeValue(row.after),
    createdAt: row.createdAt.toISOString(),
    decidedBy: row.approvedBy,
    decidedAt: iso(row.approvedAt),
    appliedAt: iso(row.appliedAt),
    expiresAt: iso(row.expiresAt),
    outcome: describeOutcome(row),
    decidable: lock === null,
    lockedReason: lock?.message ?? null,
  }
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export interface LoadActionsOptions {
  tab?: ActionsTab
  /** Default 100, at most 500. */
  limit?: number
  store?: ActionsViewStore
  now?: Date
}

export interface ActionsPage {
  tab: ActionsTab
  rows: ActionView[]
  counts: Record<ActionsTab, number>
  /** Proposed rows, the count on the sticky bar. */
  pendingCount: number
  limit: number
}

export async function loadActions(opts: LoadActionsOptions = {}): Promise<ActionsPage> {
  const tab = opts.tab ?? 'pending'
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 100), 1), 500)
  const store = opts.store ?? drizzleActionsViewStore()
  const now = opts.now ?? new Date()
  const [rows, byStatus] = await Promise.all([store.list(TAB_STATUSES[tab], limit), store.counts()])
  const mirror = await loadMirror(store, rows)
  const counts = Object.fromEntries(
    ACTIONS_TABS.map(t => [t, TAB_STATUSES[t].reduce((n, s) => n + (byStatus[s] ?? 0), 0)]),
  ) as Record<ActionsTab, number>
  return {
    tab,
    rows: rows.map(r => toActionView(r, mirror, now)),
    counts,
    pendingCount: byStatus.proposed ?? 0,
    limit,
  }
}

// ─── Decisions ───────────────────────────────────────────────────────────────

export type DecisionResult =
  | { ok: true; id: number; status: 'approved' | 'rejected' }
  | { ok: false; id: number; code: RefusalCode; error: string }

async function decide(
  id: number,
  to: 'approved' | 'rejected',
  actor: string,
  extra: TransitionExtra,
  store: ActionsViewStore,
  now: Date,
): Promise<DecisionResult> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, id, code: 'not_found', error: 'That action id is not valid.' }
  const head = await store.head(id)
  if (!head) return { ok: false, id, code: 'not_found', error: `Action #${id} is not in the ledger.` }
  const lock = lockReason(head.status, head.expiresAt, now)
  if (lock) return { ok: false, id, code: lock.code, error: lock.message }
  try {
    await store.transition(id, to, actor, extra)
    return { ok: true, id, status: to }
  } catch (err) {
    if (err instanceof IllegalAdActionTransitionError) {
      return { ok: false, id, code: 'raced', error: 'Someone else decided this action first. Reload to see where it stands.' }
    }
    throw err
  }
}

/** proposed -> approved, stamping approved_by and approved_at. Nothing reaches a platform. */
export function approveAction(
  id: number,
  adminEmail: string,
  opts: { store?: ActionsViewStore; now?: Date } = {},
): Promise<DecisionResult> {
  return decide(id, 'approved', adminEmail || 'owner', {}, opts.store ?? drizzleActionsViewStore(), opts.now ?? new Date())
}

/**
 * proposed -> rejected, stamping approved_by and approved_at with the decider.
 * The optional note is kept in the row's error column, which the Failed tab
 * shows as the outcome; one line, at most 280 characters.
 */
export function rejectAction(
  id: number,
  adminEmail: string,
  note?: string | null,
  opts: { store?: ActionsViewStore; now?: Date } = {},
): Promise<DecisionResult> {
  const line = (note ?? '').replace(/\s+/g, ' ').trim().slice(0, 280)
  const extra: TransitionExtra = line ? { error: `Rejected: ${line}` } : {}
  return decide(id, 'rejected', adminEmail || 'owner', extra, opts.store ?? drizzleActionsViewStore(), opts.now ?? new Date())
}
