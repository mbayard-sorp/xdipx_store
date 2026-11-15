/**
 * Pure parsers for ExoClick's statistics rows (ticket #19412). Field names
 * were read live on 2026-11-15 from /statistics/a/site, /a/campaign and
 * /a/hour: impressions, clicks, cost (dollars), site_hostname, hour. The
 * integer `value` field on the same rows is cost in cents and is ignored.
 * ctr on the API is already a percent; it is recomputed here from the counts
 * so a summed row stays right.
 */
import { ctrPct, type CampaignRow, type SiteRow, type VariationRow } from './kill-rules-core'

type Json = Record<string, unknown>

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/,/g, '')) : NaN
  return Number.isFinite(n) ? n : 0
}

const centsOf = (cost: unknown): number => Math.round(num(cost) * 100)

export const impressionsOf = (r: Json): number => Math.round(num(r['impressions'] ?? r['hits'] ?? r['total_impressions']))

export interface SiteStat extends SiteRow {
  costCents: number
  ctrPct: number
}

/** Sums rows that share a hostname, which paging or several campaigns can split. */
export function parseSiteRows(rows: readonly unknown[]): SiteStat[] {
  const by = new Map<string, SiteStat>()
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Json
    const host = typeof r['site_hostname'] === 'string' ? r['site_hostname'].trim().toLowerCase() : ''
    if (!host) continue
    const row = by.get(host) ?? { hostname: host, impressions: 0, clicks: 0, costCents: 0, ctrPct: 0 }
    row.impressions += impressionsOf(r)
    row.clicks += Math.round(num(r['clicks']))
    row.costCents += centsOf(r['cost'])
    by.set(host, row)
  }
  const out = [...by.values()]
  for (const s of out) s.ctrPct = ctrPct(s.clicks, s.impressions)
  return out.sort((a, b) => b.costCents - a.costCents || b.impressions - a.impressions)
}

export function parseVariationRows(campaignId: string, rows: readonly unknown[]): Array<VariationRow & { costCents: number }> {
  const by = new Map<string, VariationRow & { costCents: number }>()
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Json
    const id = r['idvariation'] ?? r['variation_id']
    if (id === undefined || id === null || id === '') continue
    const key = String(id)
    const row = by.get(key) ?? { id: key, campaignId, impressions: 0, clicks: 0, costCents: 0 }
    row.impressions += impressionsOf(r)
    row.clicks += Math.round(num(r['clicks']))
    row.costCents += centsOf(r['cost'])
    by.set(key, row)
  }
  return [...by.values()]
}

export interface CampaignStat {
  impressions: number
  clicks: number
  costCents: number
}

export function parseCampaignStatRows(rows: readonly unknown[]): Map<string, CampaignStat> {
  const by = new Map<string, CampaignStat>()
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Json
    const id = r['idcampaign'] ?? r['campaign_id']
    if (id === undefined || id === null || id === '') continue
    const key = String(id)
    const row = by.get(key) ?? { impressions: 0, clicks: 0, costCents: 0 }
    row.impressions += impressionsOf(r)
    row.clicks += Math.round(num(r['clicks']))
    row.costCents += centsOf(r['cost'])
    by.set(key, row)
  }
  return by
}

/** The most one hour-of-day row cost, in cents. Null when there are no rows. */
export function maxHourlyCostCents(rows: readonly unknown[]): number | null {
  let max: number | null = null
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const c = centsOf((raw as Json)['cost'])
    if (max === null || c > max) max = c
  }
  return max
}

/** Joins campaign stats with live status into the evaluator's rows. */
export function toCampaignRows(
  stats: Map<string, CampaignStat>,
  statusById: Map<string, string>,
  hourlyById: Map<string, number | null>,
  campaignIds: readonly string[],
): CampaignRow[] {
  return campaignIds.map(id => {
    const s = stats.get(id) ?? { impressions: 0, clicks: 0, costCents: 0 }
    return {
      id, status: statusById.get(id) ?? 'UNKNOWN', impressions: s.impressions, clicks: s.clicks, costCents: s.costCents,
      maxHourlySpendCents: hourlyById.get(id) ?? null,
    }
  })
}
