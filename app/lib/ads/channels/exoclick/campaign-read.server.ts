/**
 * Live campaign reads for the ExoClick write path (ticket #19412): status,
 * budgets and lifetime spend straight from the API, not the mirror, because a
 * brake or a cap check must not act on a six-hour-old copy.
 *
 * Units, read live 2026-11-15 against campaign 8774050: max_daily_budget_reset
 * 2000, total_budget_limit 3000, total_budget_spent 929.72 and price 75 are
 * all CENTS ($20 daily, $30 total, $9.30 spent, 75 cent CPM). The statistics
 * endpoints report `cost` in dollars. The adapter's normalizeExoCampaign
 * multiplies the budget fields by 100 and so mirrors them 100x too high; that
 * is left alone here and flagged in the PR.
 *
 * /campaigns?detailed=true answered with `result` as an object keyed by
 * campaign id on that date, so rowsOf accepts an array or an object.
 */
import { ExoClickError, type ExoClient, type ExoJson } from './client.server'
import type { ExoCampaignMoney } from './operator-core'

type Json = Record<string, unknown>

const PAGE_LIMIT = 500
const MAX_PAGES = 20

/** /collections/campaign-status: -1 archived, 0 paused, 1 active. */
const STATUS: Record<string, string> = { '-1': 'ARCHIVED', '0': 'PAUSED', '1': 'ACTIVE' }

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : 0
}

/** An ExoClick list result as rows, whether it came as an array or an id-keyed object. */
export function rowsOf(result: unknown): Json[] {
  if (Array.isArray(result)) return result.filter((r): r is Json => !!r && typeof r === 'object')
  if (result && typeof result === 'object') return Object.values(result as Json).filter((r): r is Json => !!r && typeof r === 'object')
  return []
}

export interface ExoCampaignRead extends ExoCampaignMoney {
  name: string | null
  /** The price (a CPM in cents for the Smart CPM campaigns here), as the API reports it. */
  priceCents: number | null
  raw: Json
}

export function campaignFromRow(row: Json): ExoCampaignRead | null {
  const id = row['id']
  if (id === undefined || id === null || id === '') return null
  const daily = num(row['daily_limit_type']) === 1 ? Math.round(num(row['max_daily_budget_reset']) || num(row['max_daily_budget'])) : 0
  const total = Math.round(num(row['total_budget_limit']))
  return {
    id: String(id),
    name: typeof row['name'] === 'string' ? row['name'] : null,
    status: STATUS[String(row['status'])] ?? String(row['status'] ?? 'UNKNOWN'),
    dailyBudgetCents: daily > 0 ? daily : null,
    totalBudgetCents: total > 0 ? total : null,
    spentCents: Math.round(num(row['total_budget_spent'])),
    priceCents: row['price'] != null ? num(row['price']) : null,
    raw: row,
  }
}

/** Every campaign on the account, paged. */
export async function listCampaigns(client: ExoClient): Promise<ExoCampaignRead[]> {
  const out: ExoCampaignRead[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const json: ExoJson = await client.get('campaigns', { detailed: true, limit: PAGE_LIMIT, offset: page * PAGE_LIMIT })
    const rows = rowsOf(json['result'])
    for (const r of rows) {
      const c = campaignFromRow(r)
      if (c) out.push(c)
    }
    if (rows.length < PAGE_LIMIT) return out
  }
  throw new ExoClickError('bad_response', `ExoClick GET campaigns paged past ${MAX_PAGES} pages.`, { path: 'campaigns' })
}

/** One campaign, or null when ExoClick has no such id. */
export async function readCampaign(client: ExoClient, id: string): Promise<ExoCampaignRead | null> {
  try {
    const json = await client.get(`campaigns/${encodeURIComponent(id)}`)
    const result = json['result']
    const row = result && typeof result === 'object' ? ((result as Json)['campaign'] ?? result) : null
    return row && typeof row === 'object' ? campaignFromRow(row as Json) : null
  } catch (err) {
    if (err instanceof ExoClickError && err.detail.status === 404) return null
    throw err
  }
}

/** Account balance in cents, from GET /user result.balance (dollars). Null when absent. */
export async function readBalanceCents(client: ExoClient): Promise<number | null> {
  const json = await client.get('user')
  const result = json['result']
  const b = result && typeof result === 'object' ? (result as Json)['balance'] : undefined
  return typeof b === 'number' && Number.isFinite(b) ? Math.round(b * 100) : null
}
