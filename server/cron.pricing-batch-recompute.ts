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
//  3. It used to prune aged-out pricing_audit_log noise on the way out. That
//     moved to /cron/pricing-audit-prune (below, 07:15 UTC): a DELETE of up to
//     20,000 rows was competing for the same 300s budget the recompute needs to
//     finish the catalog, which is budget contention on the money path in
//     service of pure housekeeping. Retention is unchanged.

import type { Request, Response } from 'express'

/** Products a healthy full-catalog recompute is expected to consider. */
const EXPECTED_MIN_PRODUCTS = 800

/**
 * Wall-clock budget for one invocation, against the 300s global maxDuration in
 * vercel.json. The 60s margin covers the in-flight page, response
 * serialization, and the continuation kick. A walk that hits this stops at a
 * page boundary with its cursor persisted, rather than being SIGKILLed
 * mid-catalog and leaving no trace, which is what starved 2,349 SKUs for
 * seventeen days.
 */
const RECOMPUTE_BUDGET_MS = 240_000

/**
 * Ceiling on self-scheduled continuations per UTC day. A persistent Shopify
 * outage must not spin; once this is spent the coverage floor is what escalates.
 */
const MAX_CONTINUATIONS_PER_DAY = 8

/**
 * Lock TTL, seconds. Must exceed the budget so the 07:00 pass and a pricing-ops
 * catch-up can never both hold a cursor and double-apply on the money path.
 */
const RECOMPUTE_LOCK_TTL_SECONDS = 295

export async function handlePricingBatchRecompute(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as { trigger?: unknown }
  const asked = String(body.trigger ?? req.query['trigger'] ?? '')
  const trigger =
    asked === 'batch_catchup'      ? ('batch_catchup' as const)
    : asked === 'batch_continuation' ? ('batch_continuation' as const)
    : ('batch' as const)

  // A continuation resumes today's checkpoint; so does a catch-up, so the agent's
  // one daily rescue finishes the walk instead of restarting the same head.
  const resume = trigger === 'batch_continuation' || trigger === 'batch_catchup'

  const { kvSetNX, kvDel, kvGet, kvSet } = await import('../app/lib/kv.server.js')
  const lockKey = 'lock:pricing-batch-recompute'
  const acquired = await kvSetNX(lockKey, String(Date.now()), RECOMPUTE_LOCK_TTL_SECONDS)
  if (!acquired) {
    res.json({ ok: true, trigger, skipped: 'locked' })
    return
  }

  try {
    const { recomputeCatalog } = await import('../app/lib/pricing-apply-v2.server.js')
    const result = await recomputeCatalog({ trigger, budgetMs: RECOMPUTE_BUDGET_MS, resume })

    // A run that "succeeds" while pricing almost nothing is the quiet version
    // of the same failure, so name it instead of reporting ok on a stub. Measured
    // against the day's cumulative total, not this invocation's slice, or every
    // continuation would look like a stub.
    if (result.done && result.dayTotal > 0 && result.dayTotal < EXPECTED_MIN_PRODUCTS) {
      console.warn(
        `[cron:pricing-batch-recompute] only ${result.dayTotal} variants priced today (expected >= ${EXPECTED_MIN_PRODUCTS})`,
      )
    }

    let continued = false
    if (!result.done) {
      const kickKey = `pricing-batch:continuations:${new Date().toISOString().slice(0, 10)}`
      const spent = Number((await kvGet<string>(kickKey)) ?? 0)
      if (spent < MAX_CONTINUATIONS_PER_DAY) {
        await kvSet(kickKey, String(spent + 1))
        continued = await kickContinuation()
      } else {
        console.warn('[cron:pricing-batch-recompute] continuation cap spent; coverage floor will escalate')
      }
    }

    res.json({ ok: true, trigger, continued, ...result })
  } catch (err) {
    console.error('[cron:pricing-batch-recompute]', err)
    await alertPricingFailure(err, trigger)
    res.status(500).json({ error: String(err), trigger })
  } finally {
    // Release before the TTL so the continuation is not blocked by our own lock.
    await kvDel(lockKey).catch(() => {})
  }
}

/**
 * Fire-and-forget kick for the next slice.
 *
 * Preferred over extra vercel.json entries at fixed offsets: those would race
 * this invocation while it still holds its own budget, and they add two more
 * scheduled surfaces that can silently go missing, which is the original bug.
 */
async function kickContinuation(): Promise<boolean> {
  const origin = process.env['APP_URL'] ?? process.env['VERCEL_URL']
  const secret = process.env['CRON_SECRET']
  if (!origin || !secret) {
    console.warn('[cron:pricing-batch-recompute] no APP_URL/CRON_SECRET; cannot self-continue')
    return false
  }
  const base = origin.startsWith('http') ? origin : `https://${origin}`
  try {
    // Deliberately not awaited to completion: we only need the request to be
    // accepted. The next invocation takes the lock this one is about to drop.
    void fetch(`${base}/cron/pricing-batch-recompute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cron-secret': secret },
      body: JSON.stringify({ trigger: 'batch_continuation' }),
    }).catch(e => console.warn('[cron:pricing-batch-recompute] continuation kick failed:', e))
    return true
  } catch (e) {
    console.warn('[cron:pricing-batch-recompute] continuation kick threw:', e)
    return false
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

/**
 * Audit-log retention, on its own budget.
 *
 * Split out of the recompute handler on 2026-09-02. `prunePricingAuditLog`
 * deletes up to PRUNE_CHUNK rows, and it ran after the full variant walk inside
 * the same 300s function — so on exactly the days the recompute most needed its
 * remaining margin, housekeeping was spending it. Retention policy itself is
 * unchanged (PRICING_AUDIT_RETENTION_DAYS).
 */
export async function handlePricingAuditPrune(_req: Request, res: Response): Promise<void> {
  try {
    const { prunePricingAuditLog } = await import('../app/lib/pricing-apply-v2.server.js')
    const pruned = await prunePricingAuditLog()
    res.json({ ok: true, pruned })
  } catch (err) {
    console.error('[cron:pricing-audit-prune]', err)
    res.status(500).json({ error: String(err) })
  }
}
