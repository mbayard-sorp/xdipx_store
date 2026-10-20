/**
 * Ads console tree, the pure half (ticket #16412, plan section 4, phase 3b).
 *
 * Builds campaign > ad set > ad from mirrored ad_platform_entities rows
 * (linked by parent_external_id) and hangs per-window figures on every node:
 *
 * - Spend, impressions, clicks and leads come from ad_platform_insights_daily.
 *   A node uses its own level's rows when it has any in the window. When it
 *   has none (the pull is ad level today), the figures are summed from its
 *   children, so a campaign always shows the money its ads spent.
 * - CPL is spend over leads, checked against ads_lead_cpl_ceiling_cents.
 * - Orders and net revenue come from ad_creative_daily_metrics, keyed by the
 *   ad's creative_id. A parent sums each distinct creative under it once, so
 *   two ads sharing a creative never count its orders twice. When several
 *   ads share a creative, each ad's ROAS divides the creative's revenue by
 *   the spend of every ad carrying it.
 *
 * Client-safe: no database, no env. tree.server.ts does the reads.
 */
import { computeBreakEven, ctrPct, netRoas, type BreakEven } from '~/lib/ad-metrics-core'
import { ratioCents, shiftDay } from './console-core'

export type TreeLevel = 'campaign' | 'adset' | 'ad'
export const TREE_LEVELS: readonly TreeLevel[] = ['campaign', 'adset', 'ad']

export const STATUS_FILTERS = ['all', 'active', 'paused', 'disapproved'] as const
export type StatusFilter = (typeof STATUS_FILTERS)[number]

/** The sync marks rows the platform stopped returning with this status. The tree hides them. */
export const REMOVED_STATUS = 'MISSING'

const PAUSED_STATUSES = new Set(['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED'])

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface TreeEntityRow {
  platform: string
  accountId: string
  level: string
  externalId: string
  parentExternalId: string | null
  name: string | null
  status: string | null
  effectiveStatus: string | null
  objective: string | null
  dailyBudgetCents: number | null
  lifetimeBudgetCents: number | null
  creativeId: number | null
}

export interface TreeInsightRow {
  level: string
  externalId: string
  day: string
  spendCents: number
  impressions: number
  clicks: number
  leads: number | null
}

export interface CreativeDayRow {
  creativeId: number
  day: string
  orders: number
  netRevenueCents: number
}

export interface CreativeRef {
  id: number
  ideaId: number | null
}

export interface TreeFilters {
  platform: string | null
  status: StatusFilter
  campaignId: string | null
}

export interface TreeInput {
  entities: TreeEntityRow[]
  insights: TreeInsightRow[]
  creativeDays: CreativeDayRow[]
  creatives: CreativeRef[]
  leadCplCeilingCents: number
  breakEven: BreakEven
  linkFor: (row: Pick<TreeEntityRow, 'platform' | 'accountId' | 'level' | 'externalId'>) => string | null
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface WindowMetrics {
  spendCents: number
  impressions: number
  clicks: number
  leads: number
  ctrPct: number | null
  cplCents: number | null
  /** True when CPL is above the owner's ceiling. */
  cplOver: boolean
}

export interface OrdersWindow {
  orders: number
  netRevenueCents: number
  cpaCents: number | null
  netRoas: number | null
  /** True when net ROAS is at or above break-even ROAS. */
  roasOk: boolean | null
}

export interface TreeBudget {
  kind: 'daily' | 'lifetime'
  cents: number
  /** The entity whose budget this is: the row itself, or the parent that owns it. */
  owner: 'self' | 'campaign' | 'adset'
}

/** own: the node's level has insight rows in the window. children: summed from below. none: no rows anywhere. */
export type MetricsSource = 'own' | 'children' | 'none'

export interface TreeNode {
  key: string
  level: TreeLevel
  externalId: string
  parentExternalId: string | null
  name: string
  effectiveStatus: string | null
  objective: string | null
  budget: TreeBudget | null
  d1: WindowMetrics
  d7: WindowMetrics
  d30: WindowMetrics
  source7: MetricsSource
  orders7: OrdersWindow | null
  orders30: OrdersWindow | null
  creativeId: number | null
  /** True when another ad in the account carries the same creative. */
  sharedCreative: boolean
  studioHref: string | null
  adsManagerHref: string | null
  /** True when the parent this row names is not in the mirror. */
  orphan: boolean
  /** Direct children plus every descendant, before filtering. */
  descendantCount: number
  children: TreeNode[]
}

export interface TreeTotals {
  campaigns: number
  adsets: number
  ads: number
  removedHidden: number
}

export interface Tree {
  roots: TreeNode[]
  /** Every campaign, unfiltered, for the campaign picker. */
  campaigns: Array<{ externalId: string; name: string }>
  totals: TreeTotals
  /** Shown rows, after filters. */
  shown: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function parseStatusFilter(v: string | null | undefined): StatusFilter {
  return (STATUS_FILTERS as readonly string[]).includes(v ?? '') ? (v as StatusFilter) : 'all'
}

export function matchesStatus(effectiveStatus: string | null, f: StatusFilter): boolean {
  const s = (effectiveStatus ?? '').toUpperCase()
  switch (f) {
    case 'all': return true
    case 'active': return s === 'ACTIVE'
    case 'paused': return PAUSED_STATUSES.has(s)
    case 'disapproved': return s === 'DISAPPROVED'
  }
}

export interface TreeWindows { d1: [string, string]; d7: [string, string]; d30: [string, string] }

/** Day ranges, inclusive, ending today (UTC). */
export function treeWindows(today: string): TreeWindows {
  return { d1: [today, today], d7: [shiftDay(today, -6), today], d30: [shiftDay(today, -29), today] }
}

interface Sums { spendCents: number; impressions: number; clicks: number; leads: number; rows: number }
const zero = (): Sums => ({ spendCents: 0, impressions: 0, clicks: 0, leads: 0, rows: 0 })

function add(a: Sums, b: Sums): Sums {
  return { spendCents: a.spendCents + b.spendCents, impressions: a.impressions + b.impressions, clicks: a.clicks + b.clicks, leads: a.leads + b.leads, rows: a.rows + b.rows }
}

function metricsOf(s: Sums, ceilingCents: number): WindowMetrics {
  const cplCents = ratioCents(s.spendCents, s.leads)
  return {
    spendCents: s.spendCents,
    impressions: s.impressions,
    clicks: s.clicks,
    leads: s.leads,
    ctrPct: ctrPct(s.clicks, s.impressions),
    cplCents,
    cplOver: cplCents != null && ceilingCents > 0 && cplCents > ceilingCents,
  }
}

function ordersOf(orders: number, netRevenueCents: number, spendCents: number, be: BreakEven): OrdersWindow {
  const roas = netRoas(netRevenueCents, spendCents)
  return {
    orders,
    netRevenueCents,
    cpaCents: ratioCents(spendCents, orders),
    netRoas: roas,
    roasOk: roas == null || orders === 0 ? null : roas >= be.roas,
  }
}

function budgetOf(e: TreeEntityRow): { kind: 'daily' | 'lifetime'; cents: number } | null {
  if (e.dailyBudgetCents != null && e.dailyBudgetCents > 0) return { kind: 'daily', cents: e.dailyBudgetCents }
  if (e.lifetimeBudgetCents != null && e.lifetimeBudgetCents > 0) return { kind: 'lifetime', cents: e.lifetimeBudgetCents }
  return null
}

/** Ad Studio link for a creative: its idea's creatives when known, else every creative. */
export function studioHrefFor(c: CreativeRef | undefined): string | null {
  if (!c) return null
  return c.ideaId != null ? `/admin/ad-studio/creatives?idea=${c.ideaId}&view=all` : '/admin/ad-studio/creatives?view=all'
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

type WindowName = 'd1' | 'd7' | 'd30'
const WINDOW_NAMES: readonly WindowName[] = ['d1', 'd7', 'd30']

interface Work {
  row: TreeEntityRow
  level: TreeLevel
  children: Work[]
  own: Record<WindowName, Sums>
  sums: Record<WindowName, Sums>
  source7: MetricsSource
  creatives: Set<number>
  orphan: boolean
}

export function buildTree(input: TreeInput, filters: TreeFilters, today: string): Tree {
  const windows = treeWindows(today)
  const be = input.breakEven ?? computeBreakEven(0, 0)
  let removedHidden = 0

  const work = new Map<string, Work>()
  for (const e of input.entities) {
    if (!(TREE_LEVELS as readonly string[]).includes(e.level)) continue
    if (filters.platform && e.platform !== filters.platform) continue
    if ((e.status ?? '').toUpperCase() === REMOVED_STATUS) { removedHidden++; continue }
    work.set(`${e.level}:${e.externalId}`, {
      row: e,
      level: e.level as TreeLevel,
      children: [],
      own: { d1: zero(), d7: zero(), d30: zero() },
      sums: { d1: zero(), d7: zero(), d30: zero() },
      source7: 'none',
      creatives: new Set(),
      orphan: false,
    })
  }

  // Own insight rows, bucketed by window.
  for (const r of input.insights) {
    const w = work.get(`${r.level}:${r.externalId}`)
    if (!w) continue
    const s: Sums = { spendCents: r.spendCents, impressions: r.impressions, clicks: r.clicks, leads: r.leads ?? 0, rows: 1 }
    for (const name of WINDOW_NAMES) {
      const [from, to] = windows[name]
      if (r.day >= from && r.day <= to) w.own[name] = add(w.own[name], s)
    }
  }

  // Parent links. A row whose parent is missing becomes a root and is marked orphan.
  const parentLevel: Record<TreeLevel, TreeLevel | null> = { campaign: null, adset: 'campaign', ad: 'adset' }
  const roots: Work[] = []
  for (const w of work.values()) {
    const pl = parentLevel[w.level]
    const parent = pl && w.row.parentExternalId ? work.get(`${pl}:${w.row.parentExternalId}`) : undefined
    if (parent) parent.children.push(w)
    else {
      w.orphan = w.level !== 'campaign'
      roots.push(w)
    }
  }

  // How many ads carry each creative, account wide, for the shared flag.
  const adsPerCreative = new Map<number, Work[]>()
  for (const w of work.values()) {
    if (w.level === 'ad' && w.row.creativeId != null) {
      const list = adsPerCreative.get(w.row.creativeId) ?? []
      list.push(w)
      adsPerCreative.set(w.row.creativeId, list)
    }
  }

  // Bottom-up roll-up: own rows when present, else the children's sums.
  const roll = (w: Work): void => {
    for (const c of w.children) roll(c)
    if (w.level === 'ad' && w.row.creativeId != null) w.creatives.add(w.row.creativeId)
    for (const c of w.children) for (const id of c.creatives) w.creatives.add(id)
    for (const name of WINDOW_NAMES) {
      if (w.own[name].rows > 0) {
        w.sums[name] = w.own[name]
      } else {
        w.sums[name] = w.children.reduce((acc, c) => add(acc, c.sums[name]), zero())
      }
    }
    w.source7 = w.own.d7.rows > 0 ? 'own' : w.sums.d7.rows > 0 ? 'children' : 'none'
  }
  for (const r of roots) roll(r)

  // Orders and revenue per creative per window.
  const creativeWin = new Map<number, Record<'d7' | 'd30', { orders: number; net: number }>>()
  for (const r of input.creativeDays) {
    const cur = creativeWin.get(r.creativeId) ?? { d7: { orders: 0, net: 0 }, d30: { orders: 0, net: 0 } }
    for (const name of ['d7', 'd30'] as const) {
      const [from, to] = windows[name]
      if (r.day >= from && r.day <= to) { cur[name].orders += r.orders; cur[name].net += r.netRevenueCents }
    }
    creativeWin.set(r.creativeId, cur)
  }
  const creativeRefs = new Map(input.creatives.map(c => [c.id, c]))

  const ordersFor = (w: Work, name: 'd7' | 'd30'): OrdersWindow | null => {
    if (w.creatives.size === 0) return null
    let orders = 0, net = 0
    for (const id of w.creatives) {
      const c = creativeWin.get(id)
      if (c) { orders += c[name].orders; net += c[name].net }
    }
    let spend = w.sums[name].spendCents
    if (w.level === 'ad' && w.row.creativeId != null) {
      const sharers = adsPerCreative.get(w.row.creativeId) ?? [w]
      if (sharers.length > 1) spend = sharers.reduce((a, s) => a + s.sums[name].spendCents, 0)
    }
    return ordersOf(orders, net, spend, be)
  }

  // Budget: the row's own, else the nearest ancestor's (the budget-owning entity).
  const toNode = (w: Work, inherited: TreeBudget | null): TreeNode => {
    const own = budgetOf(w.row)
    const budget: TreeBudget | null = own ? { ...own, owner: 'self' } : inherited
    const passDown: TreeBudget | null = own
      ? { ...own, owner: w.level === 'campaign' ? 'campaign' : 'adset' }
      : inherited
    const children = w.children
      .map(c => toNode(c, w.level === 'ad' ? null : passDown))
      .sort(byName)
    const creativeId = w.level === 'ad' ? w.row.creativeId : null
    return {
      key: `${w.level}:${w.row.externalId}`,
      level: w.level,
      externalId: w.row.externalId,
      parentExternalId: w.row.parentExternalId,
      name: w.row.name?.trim() || w.row.externalId,
      effectiveStatus: w.row.effectiveStatus,
      objective: w.row.objective,
      budget,
      d1: metricsOf(w.sums.d1, input.leadCplCeilingCents),
      d7: metricsOf(w.sums.d7, input.leadCplCeilingCents),
      d30: metricsOf(w.sums.d30, input.leadCplCeilingCents),
      source7: w.source7,
      orders7: ordersFor(w, 'd7'),
      orders30: ordersFor(w, 'd30'),
      creativeId,
      sharedCreative: creativeId != null && (adsPerCreative.get(creativeId)?.length ?? 0) > 1,
      studioHref: creativeId != null ? studioHrefFor(creativeRefs.get(creativeId) ?? { id: creativeId, ideaId: null }) : null,
      adsManagerHref: input.linkFor(w.row),
      orphan: w.orphan,
      descendantCount: 0,
      children,
    }
  }

  const all = roots.map(r => toNode(r, null)).sort(byLevelThenName)
  for (const n of all) countDescendants(n)

  const campaigns = all
    .filter(n => n.level === 'campaign')
    .map(n => ({ externalId: n.externalId, name: n.name }))

  const totals: TreeTotals = { campaigns: 0, adsets: 0, ads: 0, removedHidden }
  for (const w of work.values()) {
    if (w.level === 'campaign') totals.campaigns++
    else if (w.level === 'adset') totals.adsets++
    else totals.ads++
  }

  const scoped = filters.campaignId
    ? all.filter(n => n.level === 'campaign' && n.externalId === filters.campaignId)
    : all
  const filtered = filterNodes(scoped, filters.status)

  return { roots: filtered, campaigns, totals, shown: countAll(filtered) }
}

function byName(a: TreeNode, b: TreeNode): number {
  return a.name.localeCompare(b.name) || a.externalId.localeCompare(b.externalId)
}

function byLevelThenName(a: TreeNode, b: TreeNode): number {
  const order = TREE_LEVELS.indexOf(a.level) - TREE_LEVELS.indexOf(b.level)
  return order || byName(a, b)
}

function countDescendants(n: TreeNode): number {
  n.descendantCount = n.children.reduce((a, c) => a + 1 + countDescendants(c), 0)
  return n.descendantCount
}

function countAll(nodes: TreeNode[]): number {
  return nodes.reduce((a, n) => a + 1 + countAll(n.children), 0)
}

/**
 * Status filter on a tree: a node stays when it matches or when something
 * under it matches, so a matching ad keeps its ad set and campaign around it
 * for context. Figures are never re-summed: a parent still shows everything
 * it spent.
 */
export function filterNodes(nodes: TreeNode[], status: StatusFilter): TreeNode[] {
  if (status === 'all') return nodes
  const out: TreeNode[] = []
  for (const n of nodes) {
    const children = filterNodes(n.children, status)
    if (children.length > 0 || matchesStatus(n.effectiveStatus, status)) out.push({ ...n, children })
  }
  return out
}

/** Every node key in a forest, for "expand all". */
export function allKeys(nodes: TreeNode[]): string[] {
  const out: string[] = []
  const walk = (ns: TreeNode[]) => { for (const n of ns) { if (n.children.length) out.push(n.key); walk(n.children) } }
  walk(nodes)
  return out
}

/** The `open` search param: comma-separated node keys, or "all". */
export function parseOpen(raw: string | null | undefined): { all: boolean; keys: Set<string> } {
  const v = (raw ?? '').trim()
  if (v === 'all') return { all: true, keys: new Set() }
  return { all: false, keys: new Set(v.split(',').map(s => s.trim()).filter(Boolean)) }
}

export function serializeOpen(keys: Iterable<string>): string {
  return [...new Set(keys)].sort().join(',')
}
