/**
 * POST /api/team/ad-metrics (Ad Studio v2, PR-G). Team-token guarded.
 *
 * { op: 'daily' }
 *   Attribute Shopify orders for yesterday and today to creatives by
 *   utm_content, roll yesterday and today up into
 *   daily_profit_summary.ad_spend, then run rules R1 to R8 (PR-H): one
 *   ad_rule_events recommendation per firing, and R7 applied on its own. The
 *   ads routine's Pass 2 calls this.
 *   -> { today, yesterday, attribution, rollup, importMeta, rules }
 *   `rules` is the run summary, or { ok: false, error } when the rules pass
 *   failed (the metrics half still landed; read the error, do not retry blind).
 *   Meta insights are not pulled here: the Meta connector is wired in PR-E, so
 *   `importMeta` reads "not_configured".
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
 */
import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { apiError } from '~/lib/api-error.server'
import {
  AdMetricsError, backfillAdSpend, creativeSummaries, importGoogleAdsCsv, importShopCampaignsCsv, runDailyMetrics,
} from '~/lib/ad-metrics.server'
import { runRulesDaily } from '~/lib/ad-rules.server'

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

    if (op === 'import-preview' || op === 'import-commit') return bad('imports are multipart/form-data with file and source')
    return bad('op must be daily, import-preview, import-commit, summary or backfill')
  } catch (err) {
    if (err instanceof AdMetricsError) return bad(err.message, err.code === 'not_configured' ? 501 : 400)
    return apiError('team-ad-metrics', err, 'ad-metrics op failed')
  }
}
