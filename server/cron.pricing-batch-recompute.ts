// Pricing batch recompute cron handler.
// Registered in server/cron.ts as GET/POST /cron/pricing-batch-recompute.
// Schedule: 0 7 * * * UTC (02:00 ET / 03:00 EDT).
// See vercel.json for the registered schedule.
//
// Two behaviours worth knowing about:
//
//  1. A failure here used to be a console.error and a 500, nothing else. Prod
//     console output is swallowed (handleError routes to Sentry), so the
//     scheduled pass could die without anyone hearing: on 2026-07-28 the 07:00
//     run produced nothing and was only rescued by hand at 14:48, and on
//     2026-07-29 nothing ran at all. The first anyone knew was an audit days
//     later. It now captures to Sentry, files a deduped ticket, and emails the
//     owner. (An earlier version of this comment said both days wrote no rows;
//     07-28 did write 4,705, just seven hours late and only because a human
//     noticed. That is the failure this alarm is for.)
//  2. The pricing-ops agent can POST here to catch up a missed run. Catch-up
//     runs pass trigger='batch_catchup' so they are distinguishable from the
//     scheduled 07:00 pass. That distinction is the whole point: while both
//     wrote trigger='batch', every late rescue reset the agent's 26-hour
//     look-back, so a dead daily cron looked like a healthy every-other-day one.
//  3. It prunes aged-out pricing_audit_log noise. That table had no retention
//     and was at 310,170 rows growing ~5k/day. See prunePricingAuditLog for why
//     only two of the four statuses are eligible.

import type { Request, Response } from 'express'

/** Products a healthy full-catalog recompute is expected to consider. */
const EXPECTED_MIN_PRODUCTS = 800

export async function handlePricingBatchRecompute(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as { trigger?: unknown }
  const isCatchup =
    body.trigger === 'batch_catchup' || String(req.query['trigger'] ?? '') === 'batch_catchup'
  const trigger = isCatchup ? ('batch_catchup' as const) : ('batch' as const)

  try {
    const { recomputeCatalog } = await import('../app/lib/pricing-apply-v2.server.js')
    const result = await recomputeCatalog({ trigger })

    // A run that "succeeds" while pricing almost nothing is the quiet version
    // of the same failure, so name it instead of reporting ok on a stub.
    if (result.total > 0 && result.total < EXPECTED_MIN_PRODUCTS) {
      console.warn(
        `[cron:pricing-batch-recompute] only ${result.total} products considered (expected >= ${EXPECTED_MIN_PRODUCTS})`,
      )
    }

    // Housekeeping rides the same handler. Independently guarded: a recompute
    // that succeeded must never be reported as failed because a DELETE did not.
    let pruned = 0
    try {
      const { prunePricingAuditLog } = await import('../app/lib/pricing-apply-v2.server.js')
      pruned = await prunePricingAuditLog()
    } catch (e) {
      console.warn('[cron:pricing-batch-recompute] audit-log prune skipped (ignored):', e)
    }

    res.json({ ok: true, trigger, pruned, ...result })
  } catch (err) {
    console.error('[cron:pricing-batch-recompute]', err)
    await alertPricingFailure(err, trigger)
    res.status(500).json({ error: String(err), trigger })
  }
}

/**
 * Sentry, then a ticket, then the owner email. Each is independently guarded so
 * a failure in one cannot suppress the others. Same shape as the notebook and
 * homepage healthchecks.
 */
async function alertPricingFailure(err: unknown, trigger: string): Promise<void> {
  const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)

  try {
    const { Sentry } = await import('../app/lib/sentry.server.js')
    Sentry.captureException(
      err instanceof Error ? err : new Error(`pricing batch recompute failed: ${detail}`),
      { tags: { cron: 'pricing-batch-recompute', severity: 'P1', trigger } },
    )
  } catch (e) {
    console.error('[cron:pricing-batch-recompute] Sentry capture failed (ignored):', e)
  }

  try {
    const { fileDetectionTicket, makeDedupeKey, priorityFromSeverity } =
      await import('../app/lib/detection-tickets.server.js')
    await fileDetectionTicket({
      detector: 'pricing-batch',
      // Undated: one open conversation until the recompute is healthy again.
      dedupeKey: makeDedupeKey('pricing', 'batch-recompute'),
      priority: priorityFromSeverity('P1'),
      category: 'other',
      kind: 'code',
      suggestion:
        'The pricing batch recompute (/cron/pricing-batch-recompute, 07:00 UTC) threw and wrote no '
        + 'pricing rows.\n\nEvery product keeps whatever price it already had, and the pricing-ops '
        + 'sweep can only catch up once per day.\n\nError:\n'
        + detail.slice(0, 1200),
    })
  } catch (e) {
    console.error('[cron:pricing-batch-recompute] ticket filing failed (ignored):', e)
  }

  try {
    const { sendOwnerEmail, escapeHtml } = await import('../app/lib/owner-alerts.server.js')
    await sendOwnerEmail(
      '[P1] xdipx pricing batch recompute failed',
      `<p>The ${trigger === 'batch_catchup' ? 'catch-up' : '07:00 UTC scheduled'} pricing recompute threw before writing any rows.</p>
       <pre style="font-family:monospace;white-space:pre-wrap;font-size:12px;">${escapeHtml(detail.slice(0, 1500))}</pre>
       <p>Prices are unchanged from the last successful run. The daily pricing sweep will attempt one catch-up.</p>`,
    )
  } catch (e) {
    console.error('[cron:pricing-batch-recompute] owner email failed (ignored):', e)
  }
}
