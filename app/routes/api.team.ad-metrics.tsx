/**
 * POST /api/team/ad-metrics (Ad Studio v2, PR-G). Team-token guarded.
 *
 * { op: 'daily' }
 *   Attribute Shopify orders for yesterday and today to creatives by
 *   utm_content, roll yesterday and today up into
 *   daily_profit_summary.ad_spend, then run rules R1 to R8 (PR-H): one
 *   ad_rule_events recommendation per firing, and R7 applied on its own. The
 *   ads routine's Pass 2 calls this.
 *   -> { today, yesterday, attribution, rollup, rules }
 *   `rules` is the run summary, or { ok: false, error } when the rules pass
 *   failed (the metrics half still landed; read the error, do not retry blind).
 *   Meta insights are not pulled here: /cron/ads-insights pulls them hourly
 *   into ad_creative_daily_metrics (source 'api'), so the rollup already
 *   counts Meta spend.
 *
 * { op: 'import-preview' | 'import-commit' }   multipart/form-data
 *   fields: op, file (the exported report), source ('google' | 'shop')
 *   preview parses and matches and writes nothing; commit writes. Both return
 *   the same shape (counts, date range, unmatched rows, first plan rows).
 *
 * { op: 'summary', creativeIds: number[], lookback?: 7 | 30 }
 *   -> { summaries: CreativeSummary[] } (spend, impressions, clicks, CTR,
 *   orders, net revenue, net ROAS, break-even, per-day series)
 *
 * { op: 'backfill', fromDay: 'YYYY-MM-DD' }
 *   Roll every day with metrics since fromDay up into ad_spend.
 *
 * { op: 'placements', campaignIds: string[], dateFrom, dateTo, minImpressions?, maxRows? }
 *   Read only, live from ExoClick (the key stays in production). Per-site
 *   stats summed over the campaigns, paged to the end, plus the balance.
 *   -> { window, balanceCents, siteCount, sites, truncated }
 *
 * { op: 'exoclick-brakes', campaignIds: string[], dryRun?: boolean (default true),
 *   dateFrom?, dateTo?, arrivals?: number | Record<campaignId, number> | null }
 *   Reads live ExoClick stats, runs the kill rules (exoclick/kill-rules-core.ts)
 *   and pulls the brakes: block sites, pause campaigns. Brakes only. A dry run
 *   returns the plan and writes nothing. A real run goes through the ledger and
 *   returns not_enabled for every action while exoclick_operator_enabled is off.
 *   R-EXO calls this hourly.
 *
 * { op: 'channel', platform: string, sinceDay: 'YYYY-MM-DD' }
 *   Read only. The mirror's entities and spend for one channel, so a routine
 *   can watch a channel without holding its key.
 *   -> { platform, sinceDay, entities, insights: { level, totals, byExternalId } }
 */
import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { apiError } from '~/lib/api-error.server'
import {
  AdMetricsError, backfillAdSpend, creativeSummaries, importGoogleAdsCsv, importShopCampaignsCsv, runDailyMetrics,
} from '~/lib/ad-metrics.server'
import { runRulesDaily } from '~/lib/ad-rules.server'
import { readChannelMirror } from '~/lib/ads/channel-read.server'

const MAX_FILE_BYTES = 8 * 1024 * 1024
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status })
}

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const isMultipart = (request.headers.get('content-type') ?? '').toLowerCase().includes('multipart/form-data')
  try {
    if (isMultipart) {
      const form = await request.formData()
      const op = String(form.get('op') ?? '')
      if (op !== 'import-preview' && op !== 'import-commit') return bad('multipart is for op import-preview or import-commit')
      const source = String(form.get('source') ?? '')
      if (source !== 'google' && source !== 'shop') return bad('source must be google or shop')
      const file = form.get('file')
      if (!(file instanceof File) || file.size === 0) return bad('file is required')
      if (file.size > MAX_FILE_BYTES) return bad('file is over 8 MB', 413)
      const buf = new Uint8Array(await file.arrayBuffer())
      const commit = op === 'import-commit'
      const result = source === 'google'
        ? await importGoogleAdsCsv(buf, { source: 'google', commit })
        : await importShopCampaignsCsv(buf, { source: 'shop', commit })
      return Response.json(result)
    }

    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const op = b['op']

    if (op === 'daily') {
      const daily = await runDailyMetrics()
      // The rules read what the rollup just wrote. A rules failure must not hide
      // the metrics result, but it must not be silent either.
      const rules = await runRulesDaily().catch(err => {
        console.error('[team-ad-metrics] runRulesDaily failed', err)
        return { ok: false as const, error: err instanceof Error ? err.message : 'rules pass failed' }
      })
      return Response.json({ ...daily, rules })
    }

    if (op === 'summary') {
      const ids = b['creativeIds']
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || !ids.every(i => typeof i === 'number' && Number.isInteger(i))) {
        return bad('creativeIds must be 1 to 200 integers')
      }
      const lookback = b['lookback'] === 30 ? 30 : 7
      return Response.json({ summaries: await creativeSummaries(ids as number[], lookback) })
    }

    if (op === 'backfill') {
      const from = b['fromDay']
      if (typeof from !== 'string' || !DAY_RE.test(from)) return bad('fromDay must be YYYY-MM-DD')
      return Response.json(await backfillAdSpend(from))
    }

    if (op === 'channel') {
      const platform = b['platform']
      const since = b['sinceDay']
      if (typeof platform !== 'string' || !platform) return bad('platform required')
      if (typeof since !== 'string' || !DAY_RE.test(since)) return bad('sinceDay must be YYYY-MM-DD')
      return Response.json(await readChannelMirror(platform, since))
    }

    if (op === 'placements' || op === 'exoclick-brakes') {
      const ids = b['campaignIds']
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50 || !ids.every(i => (typeof i === 'string' || typeof i === 'number') && /^\d+$/.test(String(i)))) {
        return bad('campaignIds must be 1 to 50 numeric ids')
      }
      const campaignIds = ids.map(String)
      const from = b['dateFrom']
      const to = b['dateTo']
      if (from !== undefined && (typeof from !== 'string' || !DAY_RE.test(from))) return bad('dateFrom must be YYYY-MM-DD')
      if (to !== undefined && (typeof to !== 'string' || !DAY_RE.test(to))) return bad('dateTo must be YYYY-MM-DD')
      if (op === 'placements') {
        if (typeof from !== 'string' || typeof to !== 'string') return bad('placements needs dateFrom and dateTo')
        const { readPlacements } = await import('~/lib/ads/channels/exoclick/placements.server')
        const minImpressions = typeof b['minImpressions'] === 'number' ? b['minImpressions'] : undefined
        const maxRows = typeof b['maxRows'] === 'number' ? b['maxRows'] : undefined
        return Response.json(await readPlacements({ campaignIds, dateFrom: from, dateTo: to }, { ...(minImpressions !== undefined ? { minImpressions } : {}), ...(maxRows !== undefined ? { maxRows } : {}) }))
      }
      const arrivals = b['arrivals']
      const arrivalsOk = arrivals === undefined || arrivals === null || (typeof arrivals === 'number' && arrivals >= 0)
        || (typeof arrivals === 'object' && !Array.isArray(arrivals) && Object.values(arrivals as Record<string, unknown>).every(v => typeof v === 'number' && v >= 0))
      if (!arrivalsOk) return bad('arrivals must be a number, an object of campaign id to number, or null')
      // Only an explicit false sends anything.
      const { runExoclickBrakes } = await import('~/lib/ads/channels/exoclick/brakes.server')
      return Response.json(await runExoclickBrakes({
        campaignIds, dryRun: b['dryRun'] === false ? false : true,
        ...(typeof from === 'string' ? { dateFrom: from } : {}), ...(typeof to === 'string' ? { dateTo: to } : {}),
        arrivals: (arrivals ?? null) as number | Record<string, number> | null,
      }))
    }

    if (op === 'import-preview' || op === 'import-commit') return bad('imports are multipart/form-data with file and source')
    return bad('op must be daily, import-preview, import-commit, summary, backfill, channel, placements or exoclick-brakes')
  } catch (err) {
    if (err instanceof AdMetricsError) return bad(err.message, err.code === 'not_configured' ? 501 : 400)
    return apiError('team-ad-metrics', err, 'ad-metrics op failed')
  }
}
