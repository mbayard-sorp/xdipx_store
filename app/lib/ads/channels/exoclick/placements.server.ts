/**
 * Live ExoClick placement reads (ticket #19412): per-site stats paged to the
 * end, per-variation and per-campaign stats, the busiest hour of a day, and
 * the account balance. Read only. This is what lets a routine that holds the
 * team token but not the ExoClick key see where the money went.
 *
 * Paging matters: round one had 1,898 sites and the API's default limit hides
 * most of the spend, so every read pages with limit and offset until a short
 * page comes back.
 */
import { ExoClickError, exoClient, type ExoClient } from './client.server'
import { listCampaigns, readBalanceCents } from './campaign-read.server'
import {
  maxHourlyCostCents, parseCampaignStatRows, parseSiteRows, parseVariationRows, toCampaignRows, type SiteStat,
} from './placements-core'
import type { CampaignRow, VariationRow } from './kill-rules-core'

const PAGE_LIMIT = 500
const MAX_PAGES = 40

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export interface PlacementWindow {
  campaignIds: string[]
  dateFrom: string
  dateTo: string
}

export function assertWindow(w: PlacementWindow): void {
  if (!w.campaignIds.length || w.campaignIds.length > 50 || !w.campaignIds.every(id => /^\d+$/.test(id))) {
    throw new ExoClickError('bad_response', 'campaignIds must be 1 to 50 numeric ids.')
  }
  if (!DAY_RE.test(w.dateFrom) || !DAY_RE.test(w.dateTo) || w.dateFrom > w.dateTo) {
    throw new ExoClickError('bad_response', 'dateFrom and dateTo must be YYYY-MM-DD with dateFrom not after dateTo.')
  }
}

/** Every row of one statistics endpoint, paged. */
async function pageStats(client: ExoClient, path: string, params: Record<string, string | number | string[]>): Promise<unknown[]> {
  const out: unknown[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await client.get(path, { ...params, limit: PAGE_LIMIT, offset: page * PAGE_LIMIT })
    const rows = json['result']
    if (!Array.isArray(rows)) throw new ExoClickError('bad_response', `ExoClick GET ${path} returned no result array.`, { path })
    out.push(...rows)
    if (rows.length < PAGE_LIMIT) return out
  }
  throw new ExoClickError('bad_response', `ExoClick GET ${path} paged past ${MAX_PAGES} pages.`, { path })
}

export async function readSiteStats(w: PlacementWindow, client: ExoClient = exoClient): Promise<SiteStat[]> {
  assertWindow(w)
  const rows = await pageStats(client, 'statistics/a/site', { campaignid: w.campaignIds, 'date-from': w.dateFrom, 'date-to': w.dateTo })
  return parseSiteRows(rows)
}

export async function readVariationStats(w: PlacementWindow, client: ExoClient = exoClient): Promise<Array<VariationRow & { costCents: number }>> {
  assertWindow(w)
  const out: Array<VariationRow & { costCents: number }> = []
  // One call per campaign so each row knows its campaign.
  for (const id of w.campaignIds) {
    const rows = await pageStats(client, 'statistics/a/variation', { campaignid: [id], 'date-from': w.dateFrom, 'date-to': w.dateTo })
    out.push(...parseVariationRows(id, rows))
  }
  return out
}

/** The busiest hour-of-day of one day for one campaign, in cents. Null when it had no rows. */
export async function readMaxHourlySpendCents(campaignId: string, day: string, client: ExoClient = exoClient): Promise<number | null> {
  const rows = await pageStats(client, 'statistics/a/hour', { campaignid: [campaignId], 'date-from': day, 'date-to': day })
  return maxHourlyCostCents(rows)
}

export async function readCampaignRows(w: PlacementWindow, today: string, client: ExoClient = exoClient): Promise<CampaignRow[]> {
  assertWindow(w)
  const statRows = await pageStats(client, 'statistics/a/campaign', { campaignid: w.campaignIds, 'date-from': w.dateFrom, 'date-to': w.dateTo })
  const stats = parseCampaignStatRows(statRows)
  const live = await listCampaigns(client)
  const status = new Map(live.map(c => [c.id, c.status]))
  const hourly = new Map<string, number | null>()
  for (const id of w.campaignIds) hourly.set(id, await readMaxHourlySpendCents(id, today, client))
  return toCampaignRows(stats, status, hourly, w.campaignIds)
}

export interface PlacementsReport {
  window: PlacementWindow
  balanceCents: number | null
  siteCount: number
  /** Sorted by cost, highest first. */
  sites: SiteStat[]
  truncated: boolean
}

/** The `placements` team op: per-site stats for a window, plus the balance. */
export async function readPlacements(
  w: PlacementWindow,
  opts: { minImpressions?: number; maxRows?: number } = {},
  client: ExoClient = exoClient,
): Promise<PlacementsReport> {
  const [all, balanceCents] = await Promise.all([readSiteStats(w, client), readBalanceCents(client)])
  const min = opts.minImpressions ?? 0
  const max = Math.min(Math.max(opts.maxRows ?? 1000, 1), 5000)
  const kept = all.filter(s => s.impressions >= min)
  return { window: w, balanceCents, siteCount: all.length, sites: kept.slice(0, max), truncated: kept.length > max }
}
