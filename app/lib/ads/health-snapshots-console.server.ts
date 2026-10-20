/**
 * Console reads for the signal snapshots (ticket #16686).
 *
 *   loadSignalCards()     the Overview's Signal health and Burn to date cards
 *   loadSignalsPage()     /admin/ads/signals
 *   loadBreakdownsPage()  /admin/ads/breakdowns
 *
 * Neon only: no platform call happens while a page loads. Each read fails on
 * its own and the page says which one, so a missing table (migration 136 not
 * applied yet) or a failed query reads as "not reported", never as zero.
 */
import { and, eq, gte, sql } from 'drizzle-orm'

import { db } from '~/lib/db.server'
import { currentBreakEven } from '~/lib/ad-metrics.server'
import { adCreativeDailyMetrics, adHealthSamples, adPlatformInsightsDaily } from '../../../db/schema'
import { metaCredentialsFromEnv } from './channels/meta/credentials'
import { assembleBurn, shiftDay, ymdUtc, type Burn, type ChannelDay } from './console-core'
import {
  assembleSignalHealth, latestPerDimension, readAccount, readActivity, readAnomalies, readBreakdown, readErrors,
  readOpportunity, snapshotAge, summarizeBreakdown, accountProblem,
  type AccountProblem, type AccountReading, type ActivityReading, type AnomalyItem, type BreakdownReading,
  type ErrorItem, type OpportunityReading, type SignalHealth, type SliceSummary, type SnapshotAge, type SnapshotKind, type SnapshotRow,
} from './health-snapshots-core'
import { drizzleSnapshotStore, type SnapshotStore } from './health-snapshots.server'
import { LEAD_POST_EVENT_KEY } from './health.server'

const CHANNEL = 'meta'

async function attempt<T>(name: string, failed: string[], read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch (err) {
    console.error(`[ads-signals-console] ${name} read failed`, err)
    failed.push(name)
    return null
  }
}

async function countLeadPosts(since: Date): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(adHealthSamples)
    .where(and(eq(adHealthSamples.key, LEAD_POST_EVENT_KEY), gte(adHealthSamples.sampledAt, since)))
  return Number(row?.n ?? 0)
}

async function attributedLeadsSince(day: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`coalesce(sum(${adPlatformInsightsDaily.leads}), 0)::int` })
    .from(adPlatformInsightsDaily)
    .where(and(eq(adPlatformInsightsDaily.platform, CHANNEL), eq(adPlatformInsightsDaily.level, 'ad'), gte(adPlatformInsightsDaily.day, day)))
  return Number(row?.n ?? 0)
}

/** Every platform's ad-level spend and leads, and attributed orders, per day, all time. Both tables are small. */
async function channelDays(): Promise<ChannelDay[]> {
  const [spend, orders] = await Promise.all([
    db.select({
      platform: adPlatformInsightsDaily.platform,
      day: adPlatformInsightsDaily.day,
      spendCents: sql<number>`coalesce(sum(${adPlatformInsightsDaily.spendCents}), 0)::int`,
      leads: sql<number>`coalesce(sum(${adPlatformInsightsDaily.leads}), 0)::int`,
    }).from(adPlatformInsightsDaily)
      .where(eq(adPlatformInsightsDaily.level, 'ad'))
      .groupBy(adPlatformInsightsDaily.platform, adPlatformInsightsDaily.day),
    db.select({
      platform: adCreativeDailyMetrics.platform,
      day: adCreativeDailyMetrics.day,
      orders: sql<number>`coalesce(sum(${adCreativeDailyMetrics.orders}), 0)::int`,
      netRevenueCents: sql<number>`coalesce(sum(${adCreativeDailyMetrics.netRevenueCents}), 0)::int`,
    }).from(adCreativeDailyMetrics)
      .groupBy(adCreativeDailyMetrics.platform, adCreativeDailyMetrics.day),
  ])
  const byKey = new Map<string, ChannelDay>()
  const get = (platform: string, day: string) => {
    const k = `${platform}|${day}`
    let d = byKey.get(k)
    if (!d) { d = { platform, day, spendCents: 0, leads: 0, orders: 0, netRevenueCents: 0 }; byKey.set(k, d) }
    return d
  }
  for (const r of spend) {
    const d = get(r.platform, String(r.day))
    d.spendCents += Number(r.spendCents); d.leads += Number(r.leads)
  }
  for (const r of orders) {
    const d = get(r.platform, String(r.day))
    d.orders += Number(r.orders); d.netRevenueCents += Number(r.netRevenueCents)
  }
  return [...byKey.values()]
}

// ---------------------------------------------------------------------------
// Overview cards
// ---------------------------------------------------------------------------

export interface SignalCards {
  signalHealth: SignalHealth | null
  burn: Burn | null
  failed: string[]
}

export async function loadSignalCards(now: Date = new Date(), deps: { store?: SnapshotStore } = {}): Promise<SignalCards> {
  const failed: string[] = []
  const today = ymdUtc(now)
  const store = deps.store ?? await drizzleSnapshotStore()
  const [pixel, ours24, ours7, attributed7, days, breakEven] = await Promise.all([
    attempt('pixel snapshot', failed, () => store.latest(CHANNEL, 'pixel')),
    attempt('lead count', failed, () => countLeadPosts(new Date(now.getTime() - 86_400_000))),
    attempt('lead count', failed, () => countLeadPosts(new Date(now.getTime() - 7 * 86_400_000))),
    attempt('attributed leads', failed, () => attributedLeadsSince(shiftDay(today, -6))),
    attempt('burn', failed, channelDays),
    currentBreakEven(now),
  ])
  const pixelFailed = failed.includes('pixel snapshot')
  return {
    signalHealth: pixelFailed ? null : assembleSignalHealth({ pixel, ourLeads24h: ours24, ourLeads7d: ours7, attributedLeads7d: attributed7, now }),
    burn: days ? assembleBurn(days, breakEven, now) : null,
    failed: [...new Set(failed)],
  }
}

// ---------------------------------------------------------------------------
// Signals tab
// ---------------------------------------------------------------------------

export interface Reading<T> { age: SnapshotAge; source: string; data: T }

export interface SignalsPage {
  tokenConfigured: boolean
  account: Reading<AccountReading & { problem: AccountProblem | null }> | null
  activity: Reading<ActivityReading> | null
  errors: Reading<ErrorItem[]> | null
  opportunity: Reading<OpportunityReading> | null
  anomaly: Reading<AnomalyItem[]> | null
  failed: string[]
}

function reading<T>(row: SnapshotRow | null, now: Date, read: (p: Record<string, unknown>) => T): Reading<T> | null {
  return row ? { age: snapshotAge(row, now), source: row.source, data: read(row.payload) } : null
}

export async function loadSignalsPage(now: Date = new Date(), deps: { store?: SnapshotStore } = {}): Promise<SignalsPage> {
  const failed: string[] = []
  const store = deps.store ?? await drizzleSnapshotStore()
  const latest = (kind: SnapshotKind) => attempt(kind, failed, () => store.latest(CHANNEL, kind))
  const [account, activity, errors, opportunity, anomaly] = await Promise.all([
    latest('account'), latest('activity'), latest('errors'), latest('opportunity'), latest('anomaly'),
  ])
  const creds = metaCredentialsFromEnv()
  return {
    tokenConfigured: Boolean(creds.token && creds.accountId),
    account: reading(account, now, p => {
      const a = readAccount(p)
      return { ...a, problem: accountProblem(a) }
    }),
    activity: reading(activity, now, readActivity),
    errors: reading(errors, now, readErrors),
    opportunity: reading(opportunity, now, readOpportunity),
    anomaly: reading(anomaly, now, readAnomalies),
    failed,
  }
}

// ---------------------------------------------------------------------------
// Breakdowns tab
// ---------------------------------------------------------------------------

export const BREAKDOWN_LOOKBACK_DAYS = 60

export interface BreakdownPanel {
  dimension: string
  age: SnapshotAge
  source: string
  since: string | null
  until: string | null
  adsets: number
  totalSpendCents: number
  totalLeads: number
  slices: SliceSummary[]
}

export interface BreakdownsPage {
  tokenConfigured: boolean
  panels: BreakdownPanel[]
  failed: string[]
}

export function breakdownPanel(row: SnapshotRow, now: Date): BreakdownPanel {
  const b: BreakdownReading = readBreakdown(row.payload)
  const summary = summarizeBreakdown(b.rows)
  return {
    dimension: b.dimension,
    age: snapshotAge(row, now),
    source: row.source,
    since: b.since,
    until: b.until,
    adsets: new Set(b.rows.map(r => r.adsetId ?? r.adsetName ?? '')).size,
    ...summary,
  }
}

export async function loadBreakdownsPage(now: Date = new Date(), deps: { store?: SnapshotStore } = {}): Promise<BreakdownsPage> {
  const failed: string[] = []
  const store = deps.store ?? await drizzleSnapshotStore()
  const rows = await attempt('breakdown snapshots', failed, () =>
    store.since(new Date(now.getTime() - BREAKDOWN_LOOKBACK_DAYS * 86_400_000), CHANNEL, ['breakdown']))
  const creds = metaCredentialsFromEnv()
  return {
    tokenConfigured: Boolean(creds.token && creds.accountId),
    panels: latestPerDimension(rows ?? []).map(r => breakdownPanel(r, now)),
    failed,
  }
}
