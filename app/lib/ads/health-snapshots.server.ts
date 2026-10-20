/**
 * Ads signal snapshots, the database and cron half (ticket #16686, plan §9.2,
 * §9.8 and §12).
 *
 *   recordSnapshot / latestSnapshots   POST /api/team/ad-health-snapshot
 *   runSignalPulls                     a step in the hourly /cron/ads-insights run
 *
 * runSignalPulls does three Graph reads for Meta, all GET, through
 * createMetaSignalReads in the Meta adapter:
 *
 * 1. Every run: the ad account's account_status and disable_reason, stored
 *    as an `account` snapshot. Anything but ACTIVE pages the owner through
 *    pageOwner (key ads-meta-account-status), so a failed payment or a
 *    restriction reaches the blocker list within the hour. The next ACTIVE
 *    reading clears that blocker. This closes the plan §12 gap "the pager
 *    skips ad-account payment failure".
 * 2. Every run: /act_{id}/activities for the last 24 hours, stored as an
 *    `activity` snapshot. Each change is judged against our system user (the
 *    token's own user) and the applied rows of the ad_actions ledger; the rest
 *    are flagged out of band. Flagging is display only: nothing pages on it.
 * 3. Sunday's 09:00 UTC restatement run: ad-set insights for the last 7
 *    complete days broken down by placement, age and gender, one `breakdown`
 *    snapshot per dimension.
 *
 * No token or no account id: the step records nothing and says so. Each read
 * fails on its own and is reported in the summary; none of them fails the
 * pull. Nothing here calls a platform write endpoint.
 */
import { and, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm'

import { adActions, adHealthSnapshots } from '../../../db/schema'
import { createMetaSignalReads, type MetaSignalReads } from './channels/meta/adapter.server'
import {
  BREAKDOWN_DIMENSIONS, BREAKDOWN_DIMENSION_KEYS, accountProblem, flagActivities, latestPerDimension, latestPerKind,
  readAccount, readActivityRows,
  type LedgerApplied, type SnapshotKind, type SnapshotRecordInput, type SnapshotRow,
} from './health-snapshots-core'
import { pageOwner, type FileBlockerFn, type PageOutcome } from './pager.server'

export const ACCOUNT_PAGE_KEY = 'ads-meta-account-status'
export const ACTIVITY_WINDOW_HOURS = 24
export const BREAKDOWN_DAYS = 7
/** Restatement run on this UTC weekday also pulls the breakdowns. 0 is Sunday. */
export const BREAKDOWN_WEEKDAY_UTC = 0
const GRAPH_SOURCE = 'graph'

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export interface SnapshotStore {
  insert(rows: SnapshotRecordInput[]): Promise<SnapshotRow[]>
  /** Rows newer than `since`, every kind, optionally one channel. */
  since(since: Date, channel: string | null, kinds?: SnapshotKind[]): Promise<SnapshotRow[]>
  /** The newest row of one kind on one channel. */
  latest(channel: string, kind: SnapshotKind): Promise<SnapshotRow | null>
}

type DbRow = typeof adHealthSnapshots.$inferSelect

function toRow(r: DbRow): SnapshotRow {
  return {
    id: r.id,
    channel: r.channel,
    kind: r.kind as SnapshotKind,
    observedAt: r.observedAt.toISOString(),
    payload: r.payload,
    source: r.source,
    createdAt: r.createdAt.toISOString(),
  }
}

export async function drizzleSnapshotStore(): Promise<SnapshotStore> {
  const { db } = await import('~/lib/db.server')
  const t = adHealthSnapshots
  return {
    async insert(rows) {
      if (rows.length === 0) return []
      const out = await db.insert(t).values(rows.map(r => ({
        channel: r.channel, kind: r.kind, observedAt: r.observedAt, payload: r.payload, source: r.source,
      }))).returning()
      return out.map(toRow)
    },
    async since(since, channel, kinds) {
      const conds = [gte(t.observedAt, since)]
      if (channel) conds.push(eq(t.channel, channel))
      if (kinds && kinds.length > 0) conds.push(inArray(t.kind, kinds))
      const rows = await db.select().from(t).where(and(...conds)).orderBy(desc(t.observedAt)).limit(500)
      return rows.map(toRow)
    },
    async latest(channel, kind) {
      const [row] = await db.select().from(t)
        .where(and(eq(t.channel, channel), eq(t.kind, kind)))
        .orderBy(desc(t.observedAt)).limit(1)
      return row ? toRow(row) : null
    },
  }
}

// ---------------------------------------------------------------------------
// The endpoint ops
// ---------------------------------------------------------------------------

export async function recordSnapshot(input: SnapshotRecordInput, deps: { store?: SnapshotStore } = {}): Promise<SnapshotRow> {
  const store = deps.store ?? await drizzleSnapshotStore()
  const [row] = await store.insert([input])
  if (!row) throw new Error('snapshot insert returned no row')
  return row
}

/** How far back `latest` looks. Breakdowns are weekly, so this covers two of them. */
export const LATEST_LOOKBACK_DAYS = 15

export interface LatestSnapshots {
  /** Newest row per (channel, kind). */
  snapshots: SnapshotRow[]
  /** Newest breakdown row per (channel, dimension). */
  breakdowns: SnapshotRow[]
}

export async function latestSnapshots(
  channel: string | null,
  deps: { store?: SnapshotStore; now?: () => Date } = {},
): Promise<LatestSnapshots> {
  const store = deps.store ?? await drizzleSnapshotStore()
  const now = (deps.now ?? (() => new Date()))()
  const rows = await store.since(new Date(now.getTime() - LATEST_LOOKBACK_DAYS * 86_400_000), channel)
  return { snapshots: latestPerKind(rows), breakdowns: latestPerDimension(rows) }
}

// ---------------------------------------------------------------------------
// The cron step
// ---------------------------------------------------------------------------

export interface SignalPullDeps {
  store?: SnapshotStore
  reads?: MetaSignalReads
  /** Applied ledger rows on this platform since the given time. */
  ledgerApplied?: (platform: string, since: Date) => Promise<LedgerApplied[]>
  fileBlocker?: FileBlockerFn
  clearBlocker?: (dedupeKey: string, note: string) => Promise<boolean>
  now?: () => Date
  /** True on the 09:00 UTC restatement run. Breakdowns pull only then, and only on BREAKDOWN_WEEKDAY_UTC. */
  restatement?: boolean
  /** Pull the breakdowns whatever the day. */
  forceBreakdowns?: boolean
}

type ReadOutcome = { ok: true; detail: unknown } | { ok: false; error: string } | { ok: 'skipped'; reason: string }

export interface SignalPullResult {
  channel: 'meta'
  configured: boolean
  account: ReadOutcome
  activity: ReadOutcome
  breakdowns: ReadOutcome
  page?: PageOutcome | { cleared: boolean }
}

async function defaultLedgerApplied(platform: string, since: Date): Promise<LedgerApplied[]> {
  const { db } = await import('~/lib/db.server')
  const rows = await db.select({ id: adActions.id, externalId: adActions.targetExternalId, appliedAt: adActions.appliedAt })
    .from(adActions)
    .where(and(eq(adActions.platform, platform), eq(adActions.status, 'applied'), isNotNull(adActions.appliedAt), gte(adActions.appliedAt, since)))
    .limit(500)
  return rows.map(r => ({ id: r.id, externalId: r.externalId, appliedAt: (r.appliedAt as Date).toISOString() }))
}

async function defaultClearBlocker(dedupeKey: string, note: string): Promise<boolean> {
  const { clearBlockerByKey } = await import('~/lib/owner-blockers.server')
  return clearBlockerByKey(dedupeKey, 'auto', note)
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300)

function ymd(d: Date): string { return d.toISOString().slice(0, 10) }
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return ymd(d)
}

/** The last BREAKDOWN_DAYS complete UTC days before `now`. */
export function breakdownRange(now: Date): { since: string; until: string } {
  const today = ymd(now)
  return { since: addDays(today, -BREAKDOWN_DAYS), until: addDays(today, -1) }
}

export function isBreakdownRun(now: Date, restatement: boolean): boolean {
  return restatement && now.getUTCDay() === BREAKDOWN_WEEKDAY_UTC
}

export async function runSignalPulls(deps: SignalPullDeps = {}): Promise<SignalPullResult> {
  const now = (deps.now ?? (() => new Date()))()
  const reads = deps.reads ?? createMetaSignalReads()
  const skipped = (reason: string): ReadOutcome => ({ ok: 'skipped', reason })

  if (!reads.configured()) {
    const reason = 'META_ADS_ACCESS_TOKEN or META_AD_ACCOUNT_ID is not set'
    return { channel: 'meta', configured: false, account: skipped(reason), activity: skipped(reason), breakdowns: skipped(reason) }
  }
  const store = deps.store ?? await drizzleSnapshotStore()
  const result: SignalPullResult = {
    channel: 'meta', configured: true,
    account: skipped('not run'), activity: skipped('not run'), breakdowns: skipped('not run'),
  }

  // 1. account_status, and the page.
  try {
    const acct = await reads.account()
    const payload = { ...acct } as unknown as Record<string, unknown>
    await store.insert([{ channel: 'meta', kind: 'account', observedAt: now, payload, source: GRAPH_SOURCE }])
    const reading = readAccount(payload)
    const problem = accountProblem(reading)
    if (problem) {
      result.page = await pageOwner('meta-account-status', {
        dedupeKey: ACCOUNT_PAGE_KEY,
        title: `Ads: ${problem.title}`,
        detail: [
          problem.sentence,
          `Graph reported account_status ${reading.accountStatus} (${reading.statusName})`
          + `${reading.disableReason != null ? ` and disable_reason ${reading.disableReason} (${reading.disableReasonName})` : ''}`
          + ` for ${reading.accountId ?? 'the ad account'} at ${now.toISOString()}.`,
          'This row clears itself on the first hourly reading that says ACTIVE.',
        ].join('\n\n'),
        whereToGo: 'Meta Business Settings, then Billing and payments for ad account 920738511029316. /admin/ads/signals shows the latest reading.',
        unblocks: 'Every ad on the account: none of them deliver while it is not ACTIVE.',
        priority: 1,
        sourceRef: 'cron:ads-insights:account_status',
      }, { fileBlocker: deps.fileBlocker })
    } else if (reading.accountStatus != null) {
      const cleared = await (deps.clearBlocker ?? defaultClearBlocker)(ACCOUNT_PAGE_KEY, `account_status read ${reading.statusName} at ${now.toISOString()}`)
        .catch(() => false)
      result.page = { cleared }
    }
    result.account = { ok: true, detail: { accountStatus: reading.accountStatus, statusName: reading.statusName, disableReason: reading.disableReason } }
  } catch (e) {
    console.error('[ads-signals] account read failed', e)
    result.account = { ok: false, error: errText(e) }
  }

  // 2. The activity log.
  try {
    const since = new Date(now.getTime() - ACTIVITY_WINDOW_HOURS * 3_600_000)
    const [raw, me, ledger] = await Promise.all([
      reads.activities(since, now),
      reads.whoAmI(),
      (deps.ledgerApplied ?? defaultLedgerApplied)('meta', new Date(since.getTime() - 3_600_000)).catch((): LedgerApplied[] => []),
    ])
    const items = flagActivities(readActivityRows(raw), { systemUserIds: me ? [me.id] : [], ledger })
    const outOfBandCount = items.filter(i => i.outOfBand).length
    await store.insert([{
      channel: 'meta', kind: 'activity', observedAt: now, source: GRAPH_SOURCE,
      payload: {
        windowHours: ACTIVITY_WINDOW_HOURS,
        since: since.toISOString(),
        until: now.toISOString(),
        systemUser: me,
        items,
        outOfBandCount,
      },
    }])
    result.activity = { ok: true, detail: { items: items.length, outOfBand: outOfBandCount, systemUserKnown: me != null } }
  } catch (e) {
    console.error('[ads-signals] activity read failed', e)
    result.activity = { ok: false, error: errText(e) }
  }

  // 3. Weekly breakdowns.
  if (deps.forceBreakdowns || isBreakdownRun(now, deps.restatement === true)) {
    const range = breakdownRange(now)
    const stored: Record<string, number> = {}
    const failed: Record<string, string> = {}
    for (const dimension of BREAKDOWN_DIMENSION_KEYS) {
      const breakdowns = BREAKDOWN_DIMENSIONS[dimension]
      try {
        const rows = await reads.breakdown(range, breakdowns)
        await store.insert([{
          channel: 'meta', kind: 'breakdown', observedAt: now, source: GRAPH_SOURCE,
          payload: { dimension, breakdowns: [...breakdowns], level: 'adset', since: range.since, until: range.until, rows },
        }])
        stored[dimension] = rows.length
      } catch (e) {
        console.error(`[ads-signals] ${dimension} breakdown failed`, e)
        failed[dimension] = errText(e)
      }
    }
    result.breakdowns = Object.keys(failed).length > 0 && Object.keys(stored).length === 0
      ? { ok: false, error: Object.entries(failed).map(([k, v]) => `${k}: ${v}`).join('; ') }
      : { ok: true, detail: { range, rows: stored, ...(Object.keys(failed).length ? { failed } : {}) } }
  } else {
    result.breakdowns = skipped('weekly: Sunday 09:00 UTC restatement run only')
  }

  return result
}
