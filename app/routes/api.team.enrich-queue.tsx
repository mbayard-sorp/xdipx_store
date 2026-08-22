/**
 * POST /api/team/enrich-queue — the subagent (Max) transport's half of the
 * import→enrich→publish lifecycle. Called by the daily R-ENRICH Claude cloud
 * routine (see docs/store-team/routine-enrich-daily.md), which generates
 * ProductWrites payloads with the emma-product-enricher subagent on the Max
 * subscription instead of the Anthropic API key.
 *
 *   { op: 'claim', leaseId, cap? }
 *       -> { ok: true, leaseId, claims: [{ candidateId, productId, sku?, brief }],
 *            skippedNoBrief, sharedContext }
 *     Leases up to cap (clamped by import_enrich_batch_cap) unenriched
 *     imported drafts. Requires import_enrich_enabled AND
 *     import_enrich_transport='subagent' — the valve checks live HERE, server
 *     side, so the routine can treat any { ok:false, reason } as an honest
 *     skip without reading settings itself.
 *   { op: 'complete', candidateId, writes }
 *       -> { ok: true, result: 'enriched' }
 *        | { ok: false, result: 'requeued'|'parked'|'not_claimable', reason }
 *     Runs the SAME quality gate + apply + retry/park bookkeeping as the
 *     batch-API collect path. 'requeued' means the candidate can be
 *     re-claimed for one more attempt (regenerate with the reason in mind);
 *     'parked' means the attempt cap is hit and the row needs manual review.
 *   { op: 'release', candidateId, reason }
 *       -> same shape as complete; for products the routine could not
 *     generate for. Counts an attempt, so the cap holds across transports.
 *   { op: 'status' } -> { ok: true, funnel, transport, enabled }
 *     Read-only funnel snapshot for the routine's run report.
 *
 * Publishing is NOT here: the 30-minute /cron/import-enrich tick keeps
 * flipping enriched drafts live (and recovering expired subagent leases)
 * exactly as before. The kill switch is unchanged: import_enrich_enabled off
 * refuses every mutating op.
 */
import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { getPipelineSetting } from '~/lib/feed-processor.server'
import {
  claimEnrichmentForSubagent,
  completeSubagentEnrichment,
  releaseSubagentClaim,
  snapshotEnrichFunnel,
  getEnrichTransport,
} from '~/lib/import-enrich.server'
import type { ProductWrites } from '~/lib/emma-orchestrator.server'

/** Hard ceiling per claim call regardless of import_enrich_batch_cap: each
 *  claim gathers one Shopify GraphQL brief per product inside a single
 *  serverless invocation, and 15 stays comfortably under the function budget.
 *  The routine loops claim calls to drain a deeper queue. */
const MAX_CLAIM_PER_REQUEST = 15
const DEFAULT_CLAIM_CAP = 10

export function clampClaimCap(requested: number | undefined, settingCap: number): number {
  const setting = Number.isFinite(settingCap) && settingCap > 0 ? settingCap : DEFAULT_CLAIM_CAP
  const want = requested !== undefined && Number.isFinite(requested) && requested > 0
    ? Math.floor(requested)
    : setting
  return Math.min(want, setting, MAX_CLAIM_PER_REQUEST)
}

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }
  const op = typeof body['op'] === 'string' ? body['op'] : ''

  if (op === 'status') {
    const [funnel, transport, enabledRaw] = await Promise.all([
      snapshotEnrichFunnel(),
      getEnrichTransport(),
      getPipelineSetting('import_enrich_enabled'),
    ])
    return Response.json({ ok: true, funnel, transport, enabled: enabledRaw === 'true' })
  }

  // Every mutating op sits behind the same kill switch as the cron tick.
  const enabled = (await getPipelineSetting('import_enrich_enabled')) === 'true'
  if (!enabled) {
    return Response.json({ ok: false, reason: 'disabled', error: 'import_enrich_enabled is off' }, { status: 403 })
  }

  if (op === 'claim') {
    const transport = await getEnrichTransport()
    if (transport !== 'subagent') {
      return Response.json({
        ok: false,
        reason: 'wrong_transport',
        error: "import_enrich_transport is 'batch-api': the cron owns generation; nothing to claim here",
      }, { status: 409 })
    }
    const leaseId = typeof body['leaseId'] === 'string' && body['leaseId'].trim()
      ? body['leaseId'].trim().slice(0, 64)
      : ''
    if (!leaseId) {
      return Response.json({ ok: false, error: 'missing leaseId' }, { status: 400 })
    }
    const settingCapRaw = await getPipelineSetting('import_enrich_batch_cap')
    const settingCap = parseInt(settingCapRaw ?? String(DEFAULT_CLAIM_CAP), 10)
    const cap = clampClaimCap(
      typeof body['cap'] === 'number' ? body['cap'] : undefined,
      settingCap,
    )
    const result = await claimEnrichmentForSubagent(cap, leaseId)
    return Response.json({ ok: true, ...result })
  }

  if (op === 'complete' || op === 'release') {
    const candidateId = typeof body['candidateId'] === 'number' ? body['candidateId'] : NaN
    if (!Number.isInteger(candidateId)) {
      return Response.json({ ok: false, error: 'missing or invalid candidateId' }, { status: 400 })
    }
    if (op === 'complete') {
      const writes = body['writes']
      if (!writes || typeof writes !== 'object' || Array.isArray(writes)) {
        return Response.json({ ok: false, error: 'missing writes object' }, { status: 400 })
      }
      const result = await completeSubagentEnrichment(candidateId, writes as ProductWrites)
      return Response.json(result, { status: result.ok || result.result !== 'not_claimable' ? 200 : 409 })
    }
    const reason = typeof body['reason'] === 'string' && body['reason'].trim()
      ? body['reason'].trim().slice(0, 500)
      : 'unspecified'
    const result = await releaseSubagentClaim(candidateId, reason)
    return Response.json(result, { status: result.result !== 'not_claimable' ? 200 : 409 })
  }

  return Response.json({ ok: false, error: `unknown op: ${op}` }, { status: 400 })
}
