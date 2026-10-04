/**
 * Ad Studio v2 Spend tab, the pure half (PR-H): planned versus actual, month
 * projection, the simulation exit streak, and the cap and rule input checks.
 * Client-safe: no database, no server-only imports.
 */
import { netRoas } from '~/lib/ad-metrics-core'

export interface PlanMetricRow {
  creativeId: number | null
  day: string
  platform: string
  spendCents: number
  orders: number
  netRevenueCents: number
}

export interface PlanCreative {
  id: number
  campaignId: number
  lane: string | null
  registerTier: string | null
  ideaId: number | null
}

export interface PlanCampaign {
  id: number
  name: string
  plannedDailyCents: number
}

export interface PlanRow {
  key: string
  campaignName: string
  lane: string
  tier: string | null
  /** Null for account-level rows: spend with no creative has no plan. */
  plannedCents: number | null
  /** Where the plan came from: the campaign's own number or the lane's share of the daily cap. */
  plannedSource: 'campaign' | 'lane-share' | 'none'
  actualCents: number
  orders: number
  netRoas: number | null
  deltaCents: number | null
}

function dayMinus(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/**
 * Per campaign and lane over the last `windowDays` days ending `today`.
 *
 * Planned: `ad_campaigns.planned_daily_cents` x days for a campaign whose
 * creatives are linked to ideas and that carries a plan, else the lane's share
 * of the daily media cap (the cap split evenly across the lanes in play) x days.
 * Account-level spend (Shop Campaigns history, no creative) has no plan and
 * shows as its own row so it is never folded into a creative's number.
 */
export function buildPlanVsActual(args: {
  today: string
  windowDays: number
  dailyCapCents: number
  metrics: readonly PlanMetricRow[]
  creatives: readonly PlanCreative[]
  campaigns: readonly PlanCampaign[]
}): PlanRow[] {
  const from = dayMinus(args.today, args.windowDays - 1)
  const creativeById = new Map(args.creatives.map(c => [c.id, c]))
  const campaignById = new Map(args.campaigns.map(c => [c.id, c]))

  interface Group { key: string; campaignName: string; lane: string; tier: string | null; campaignId: number | null; creativeIds: Set<number>; spend: number; orders: number; net: number }
  const groups = new Map<string, Group>()
  const ensure = (key: string, init: () => Group): Group => {
    let g = groups.get(key)
    if (!g) { g = init(); groups.set(key, g) }
    return g
  }

  // Every creative's campaign and lane shows up, even with no spend in the window.
  for (const c of args.creatives) {
    const camp = campaignById.get(c.campaignId)
    const lane = c.lane ?? 'unassigned'
    const g = ensure(`${c.campaignId}|${lane}`, () => ({
      key: `${c.campaignId}|${lane}`, campaignName: camp?.name ?? `Campaign ${c.campaignId}`, lane, tier: c.registerTier,
      campaignId: c.campaignId, creativeIds: new Set<number>(), spend: 0, orders: 0, net: 0,
    }))
    g.creativeIds.add(c.id)
  }

  for (const m of args.metrics) {
    if (m.day < from || m.day > args.today) continue
    const c = m.creativeId != null ? creativeById.get(m.creativeId) : undefined
    if (c) {
      const lane = c.lane ?? 'unassigned'
      const g = groups.get(`${c.campaignId}|${lane}`)
      if (!g) continue
      g.spend += m.spendCents; g.orders += m.orders; g.net += m.netRevenueCents
    } else {
      // Spend with no creative: its own row per platform. Orders without a creative are not shown here.
      const g = ensure(`account|${m.platform}`, () => ({
        key: `account|${m.platform}`, campaignName: 'Account level', lane: m.platform, tier: null,
        campaignId: null, creativeIds: new Set<number>(), spend: 0, orders: 0, net: 0,
      }))
      g.spend += m.spendCents; g.orders += m.orders; g.net += m.netRevenueCents
    }
  }

  const creativeLanes = new Set([...groups.values()].filter(g => g.campaignId != null).map(g => g.lane))
  const laneShare = Math.round(args.dailyCapCents / Math.max(1, creativeLanes.size))

  const rows: PlanRow[] = []
  for (const g of groups.values()) {
    if (g.campaignId == null) {
      if (g.spend === 0 && g.orders === 0) continue
      rows.push({
        key: g.key, campaignName: g.campaignName, lane: g.lane, tier: g.tier, plannedCents: null, plannedSource: 'none',
        actualCents: g.spend, orders: g.orders, netRoas: netRoas(g.net, g.spend), deltaCents: null,
      })
      continue
    }
    const camp = campaignById.get(g.campaignId)
    const linked = [...g.creativeIds].some(id => (creativeById.get(id)?.ideaId ?? null) != null)
    const own = camp && linked && camp.plannedDailyCents > 0
    const plannedCents = (own ? camp!.plannedDailyCents : laneShare) * args.windowDays
    rows.push({
      key: g.key, campaignName: g.campaignName, lane: g.lane, tier: g.tier,
      plannedCents, plannedSource: own ? 'campaign' : 'lane-share',
      actualCents: g.spend, orders: g.orders, netRoas: netRoas(g.net, g.spend), deltaCents: g.spend - plannedCents,
    })
  }
  return rows.sort((a, b) => b.actualCents - a.actualCents || a.campaignName.localeCompare(b.campaignName))
}

export interface MonthProjection {
  /** YYYY-MM */
  month: string
  daysInMonth: number
  daysElapsed: number
  spentCents: number
  projectedCents: number
  /** 0 to 1, spend over cap. 0 when the cap is 0. */
  ratio: number
}

/** Month-to-date spend against the monthly cap, and the straight-line projection to month end. */
export function monthProjection(today: string, spentCents: number, capCents: number): MonthProjection {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number]
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const daysElapsed = Math.max(1, d)
  return {
    month: today.slice(0, 7), daysInMonth, daysElapsed, spentCents,
    projectedCents: Math.round((spentCents / daysElapsed) * daysInMonth),
    ratio: capCents > 0 ? Math.min(1, spentCents / capCents) : 0,
  }
}

/**
 * The routine streak for the simulation exit criteria: consecutive UTC days of
 * at least one successful ads run, counted back from today, or from yesterday
 * when today's run has not happened yet.
 */
export function routineStreak(successDays: readonly string[], today: string): number {
  const set = new Set(successDays)
  let cursor = set.has(today) ? today : dayMinus(today, 1)
  let n = 0
  while (set.has(cursor)) { n += 1; cursor = dayMinus(cursor, 1) }
  return n
}

export const EXIT_TARGETS = { streakDays: 10, heartedCreatives: 30, lanesWithHearts: 3 } as const

export interface SimulationExit {
  streakDays: number | null
  heartedCreatives: number | null
  lanesWithHearts: number | null
  /** true, false, or null when the Sanity read is not available. */
  bridgeLive: boolean | null
  ownerSaysGo: boolean
}

/** Parse dollars typed by the owner ("600", "$1,200", "7.5") into cents. Null when it is not usable money. */
export function parseDollarsToCents(raw: unknown): number | null {
  const cleaned = String(raw ?? '').replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  return Math.round(Number(cleaned) * 100)
}

export const MAX_MONTHLY_CAP_CENTS = 10_000_000
