/**
 * The ExoClick brakes run (ticket #19412): read the live placement, variation
 * and campaign stats, evaluate the kill rules, and pull the brakes. This is
 * what R-EXO calls hourly through POST /api/team/ad-metrics {op:'exoclick-brakes'}.
 * R-EXO holds the team token and no ExoClick key, so the key stays in
 * production and the brakes go through the ledger like every other change.
 *
 * dryRun defaults to true. A dry run reads, evaluates and returns the plan;
 * it writes nothing to ExoClick and nothing to the ledger. A real run sends
 * each action through dispatchExoclickAction, which refuses everything with
 * status not_enabled while exoclick_operator_enabled is off.
 *
 * Brakes only. No code path here can raise spend.
 */
import { exoClient, type ExoClient } from './client.server'
import { readBalanceCents } from './campaign-read.server'
import {
  evaluateKillRules, type ArrivalsInput, type KillAction,
} from './kill-rules-core'
import { MAX_BLOCK_HOSTNAMES_PER_CALL, chunk, normalizeHostname } from './operator-core'
import { dispatchExoclickAction, type ExoActionRequest, type ExoActionResult } from './operator.server'
import { EXOCLICK_CHANNEL } from './policy-core'
import { readCampaignRows, readSiteStats, readVariationStats, type PlacementWindow } from './placements.server'

export const BRAKES_PROPOSER = 'rule:exoclick-kill-rules'
/** Days of stats the rules read when the caller gives no window. The thresholds are cumulative. */
export const DEFAULT_WINDOW_DAYS = 14

export interface BrakesInput {
  campaignIds: string[]
  dateFrom?: string | undefined
  dateTo?: string | undefined
  /** Defaults to true. Only an explicit false sends anything. */
  dryRun?: boolean | undefined
  arrivals?: ArrivalsInput | undefined
  now?: Date | undefined
}

export interface BrakesDeps {
  client?: ExoClient
  dispatch?: (req: ExoActionRequest) => Promise<ExoActionResult>
  operatorEnabled?: () => Promise<boolean>
}

export interface PlannedAction {
  verb: ExoActionRequest['verb']
  targetLevel: 'campaign' | 'ad'
  /** The campaign id, or the variation id for a variation pause. */
  targetId: string
  params: Record<string, unknown> | null
  reason: string
}

export interface BrakesReport {
  dryRun: boolean
  operatorEnabled: boolean
  window: PlacementWindow
  balanceCents: number | null
  read: { sites: number; variations: number; campaigns: number }
  /** What the rules decided, per rule hit. */
  rules: KillAction[]
  /** The ledger requests those decisions become: block lists grouped per campaign and chunked. */
  planned: PlannedAction[]
  /** Variation pauses the rules asked for that no wired route can carry out. */
  unsupported: Array<{ variationId: string; campaignId: string; reason: string }>
  /** One per planned action, in order. Empty on a dry run. */
  results: ExoActionResult[]
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10)

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return dayOf(d)
}

/** Turns rule hits into ledger requests. Pure, so it tests without a network. */
export function planBrakes(rules: readonly KillAction[], variationPauseWired: boolean): { planned: PlannedAction[]; unsupported: BrakesReport['unsupported'] } {
  const planned: PlannedAction[] = []
  const unsupported: BrakesReport['unsupported'] = []

  // Site blocks: one list per campaign, chunked, so a 600-site sweep is a handful of rows.
  const byCampaign = new Map<string, { hosts: string[]; reasons: string[] }>()
  for (const a of rules) {
    if (a.kind !== 'block_site') continue
    const host = normalizeHostname(a.hostname)
    if (!host) continue
    for (const id of a.campaignIds) {
      const e = byCampaign.get(id) ?? { hosts: [], reasons: [] }
      if (!e.hosts.includes(host)) {
        e.hosts.push(host)
        if (e.reasons.length < 3) e.reasons.push(a.reason)
      }
      byCampaign.set(id, e)
    }
  }
  for (const [campaignId, e] of byCampaign) {
    const hosts = [...e.hosts].sort()
    for (const part of chunk(hosts, MAX_BLOCK_HOSTNAMES_PER_CALL)) {
      planned.push({
        verb: 'block_placement', targetLevel: 'campaign', targetId: campaignId, params: { hostnames: part },
        reason: `Kill rules: ${hosts.length} site(s) with traffic that does not click. e.g. ${e.reasons.join('; ')}`,
      })
    }
  }

  for (const a of rules) {
    if (a.kind === 'pause_campaign') planned.push({ verb: 'pause', targetLevel: 'campaign', targetId: a.campaignId, params: null, reason: `Kill rules: ${a.reason}` })
    if (a.kind === 'pause_variation') {
      if (variationPauseWired) planned.push({ verb: 'pause', targetLevel: 'ad', targetId: a.variationId, params: null, reason: `Kill rules: ${a.reason}` })
      else unsupported.push({ variationId: a.variationId, campaignId: a.campaignId, reason: a.reason })
    }
  }
  return { planned, unsupported }
}

export async function runExoclickBrakes(input: BrakesInput, deps: BrakesDeps = {}): Promise<BrakesReport> {
  const client = deps.client ?? exoClient
  const now = input.now ?? new Date()
  const today = dayOf(now)
  const dryRun = input.dryRun !== false
  const window: PlacementWindow = {
    campaignIds: [...new Set(input.campaignIds.map(String))],
    dateTo: input.dateTo ?? today,
    dateFrom: input.dateFrom ?? addDays(input.dateTo ?? today, -DEFAULT_WINDOW_DAYS),
  }

  const operatorEnabled = await (deps.operatorEnabled ?? (async () => (await import('./settings.server')).getExoOperatorSettings().then(s => s.operatorEnabled)))()
  const [sites, variations, campaigns, balanceCents] = await Promise.all([
    readSiteStats(window, client),
    readVariationStats(window, client),
    readCampaignRows(window, today, client),
    readBalanceCents(client),
  ])
  const rules = evaluateKillRules({
    campaignIds: window.campaignIds, sites, variations, campaigns, arrivals: input.arrivals ?? null,
  })
  const { variationPauseSupported } = await import('./mutate.server')
  const { planned, unsupported } = planBrakes(rules, variationPauseSupported)

  const report: BrakesReport = {
    dryRun, operatorEnabled, window, balanceCents,
    read: { sites: sites.length, variations: variations.length, campaigns: campaigns.length },
    rules, planned, unsupported, results: [],
  }
  if (dryRun) return report

  const send = deps.dispatch ?? ((req: ExoActionRequest) => dispatchExoclickAction(req))
  for (const p of planned) {
    report.results.push(await send({
      verb: p.verb,
      target: { platform: EXOCLICK_CHANNEL, level: p.targetLevel, externalId: p.targetId },
      params: p.params, proposedBy: BRAKES_PROPOSER, reason: p.reason, now,
    }))
  }
  return report
}
