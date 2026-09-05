import { Router, type Request, type Response, type NextFunction } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { handlePricingBatchRecompute, handlePricingAuditPrune } from './cron.pricing-batch-recompute.js'

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Drain unresolved Meta CAPI Purchase failures (bounded attempts). Re-sends each
 * queued event; marks resolved on success, otherwise increments attempts and
 * records the error. Runs piggybacked on the nightly profit-summary cron.
 * Returns the number of rows that resolved this pass.
 */
async function drainMetaCapiFailures(): Promise<number> {
  const MAX_ATTEMPTS = 5
  try {
    const { db } = await import('../app/lib/db.server.js')
    const { metaCapiOutbox } = await import('../db/schema.js')
    const { sendCapiEvent } = await import('../app/lib/meta-capi.server.js')
    const { and, eq, isNull, lt } = await import('drizzle-orm')

    const rows = await db.select().from(metaCapiOutbox)
      .where(and(isNull(metaCapiOutbox.resolvedAt), lt(metaCapiOutbox.attempts, MAX_ATTEMPTS)))
      .limit(100)

    let resolved = 0
    for (const row of rows) {
      // PII-free path matches the original webhook send.
      const result = await sendCapiEvent(row.payload as Parameters<typeof sendCapiEvent>[0], { consentGranted: false })
      if (result.ok) {
        await db.update(metaCapiOutbox)
          .set({ resolvedAt: new Date(), attempts: row.attempts + 1 })
          .where(eq(metaCapiOutbox.id, row.id))
        resolved++
      } else if (result.skipped) {
        // Missing credentials is an environment problem, not a bad payload.
        // Burning an attempt would exhaust the retry budget on rows that were
        // never actually sent, so record the reason and leave attempts alone.
        await db.update(metaCapiOutbox)
          .set({ lastError: result.skipped })
          .where(eq(metaCapiOutbox.id, row.id))
      } else {
        await db.update(metaCapiOutbox)
          .set({ attempts: row.attempts + 1, lastError: result.error ?? 'unknown' })
          .where(eq(metaCapiOutbox.id, row.id))
      }
    }
    return resolved
  } catch (err) {
    console.error('[cron:profit-summary] CAPI drain error:', err)
    return 0
  }
}

/**
 * Drain unresolved GA4 Measurement Protocol purchase failures. Mirrors the CAPI
 * drain: re-send each queued purchase (idempotent on transaction_id), mark
 * resolved on success. Runs piggybacked on the nightly profit-summary cron.
 */
async function drainGa4Failures(): Promise<number> {
  const MAX_ATTEMPTS = 5
  try {
    const { db } = await import('../app/lib/db.server.js')
    const { ga4PurchaseOutbox } = await import('../db/schema.js')
    const { sendGa4Purchase } = await import('../app/lib/ga4-mp.server.js')
    const { and, eq, isNull, lt } = await import('drizzle-orm')

    const rows = await db.select().from(ga4PurchaseOutbox)
      .where(and(isNull(ga4PurchaseOutbox.resolvedAt), lt(ga4PurchaseOutbox.attempts, MAX_ATTEMPTS)))
      .limit(100)

    let resolved = 0
    for (const row of rows) {
      const result = await sendGa4Purchase(row.payload as Parameters<typeof sendGa4Purchase>[0])
      if (result.ok) {
        await db.update(ga4PurchaseOutbox)
          .set({ resolvedAt: new Date(), attempts: row.attempts + 1 })
          .where(eq(ga4PurchaseOutbox.id, row.id))
        resolved++
      } else {
        await db.update(ga4PurchaseOutbox)
          .set({ attempts: row.attempts + 1, lastError: result.error ?? result.skipped ?? 'unknown' })
          .where(eq(ga4PurchaseOutbox.id, row.id))
      }
    }
    return resolved
  } catch (err) {
    console.error('[cron:profit-summary] GA4 drain error:', err)
    return 0
  }
}

/**
 * Poller lock TTL, seconds (ticket #5941). Must be >= the function's
 * maxDuration in vercel.json (300s) so a lock can never expire while the
 * invocation that holds it is still running, and > the cron interval so the
 * next tick skips rather than doubling up. 295 leaves a small margin under
 * maxDuration: the lambda is killed first, then the lock lapses, then the
 * next tick retries.
 */
const POLLER_LOCK_TTL_SECONDS = 295

export function createCronRoutes() {
  const router = Router()

  // Guard — all cron routes require x-cron-secret header.
  // Vercel also sets `x-vercel-cron: 1` on scheduled invocations; we require
  // either the shared secret OR that header (the platform gate) to pass.
  const guard = (req: Request, res: Response, next: NextFunction) => {
    const expected = process.env['CRON_SECRET']
    const headerSecret = req.headers['x-cron-secret']
    const authHeader = req.headers['authorization']
    const bearer =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : undefined
    const provided = typeof headerSecret === 'string' ? headerSecret : bearer
    if (
      typeof expected !== 'string' ||
      expected.length === 0 ||
      typeof provided !== 'string' ||
      !safeEqual(provided, expected)
    ) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    next()
  }

  /**
   * Wrap a cron handler so the invocation leaves a durable trace.
   *
   * Three rules this obeys, each of which was a way to get it wrong:
   *
   * 1. **Bookkeeping never changes the outcome.** Every recording call swallows
   *    its own errors inside `cron-runs.server.ts`, and the whole `finally`
   *    block is additionally wrapped here. A cron that ran perfectly but could
   *    not write its row is a gap in the record, not an incident; a failed write
   *    must never turn a success into a reported failure, nor mask a real one.
   *
   * 2. **`skipped` is a real outcome, not a failure.** An idle poller and a
   *    gate-closed routine both did their job. Reading the response body is the
   *    only way to know, since every one of them answers HTTP 200 with
   *    `{ ok: true, skipped: '...' }`, so `res.json` is intercepted rather than
   *    inferred from the status code.
   *
   * 3. **The write is awaited, not fired and forgotten.** On a serverless
   *    platform, work started after the response is sent can be killed with the
   *    invocation. Awaiting costs the function's own lifetime, not the caller's
   *    latency — the handler has already responded by the time this runs.
   *
   * Only ~12 routes actually write a row (see `app/lib/cron-expectations.ts`);
   * the rest get a KV heartbeat. That split is a deliberate cost decision, not
   * an oversight: the two every-2-minute pollers have a KV negative cache built
   * specifically so their 1,440 daily invocations touch Neon zero times, and a
   * blanket INSERT here would undo it and pin DB compute awake around the clock.
   */
  const instrument = (
    path: string,
    handler: (req: Request, res: Response) => void | Promise<void>,
  ) => async (req: Request, res: Response) => {
    const route = `/cron${path}`
    const startedAt = new Date()
    const triggerKind: 'schedule' | 'manual' = req.method === 'GET' ? 'schedule' : 'manual'

    let payload: unknown = null
    const originalJson = res.json.bind(res)
    res.json = ((body: unknown) => {
      payload = body
      return originalJson(body as never)
    }) as typeof res.json

    let thrown: unknown = null
    try {
      await handler(req, res)
    } catch (err) {
      thrown = err
      throw err
    } finally {
      try {
        const { classifyCronOutcome, recordCronRun, heartbeatCron } =
          await import('../app/lib/cron-runs.server.js')
        const { status, error } = classifyCronOutcome({
          thrown,
          statusCode: res.statusCode,
          payload,
        })
        const failed = status === 'failed'

        await recordCronRun({
          route,
          startedAt,
          finishedAt: new Date(),
          status,
          error,
          result: payload,
          triggerKind,
        })
        // Heartbeat on any non-failed completion, recorded routes included: a
        // recorded route whose INSERT failed still beat, so a database blip
        // degrades the record's resolution instead of reading as a dead cron.
        if (!failed) await heartbeatCron(route, startedAt)
      } catch (bookkeepingErr) {
        console.warn(`[cron:${path}] recording failed (ignored):`, bookkeepingErr)
      }
    }
  }

  // Registers a scheduled cron endpoint on both GET (Vercel native cron) and POST
  // (GitHub fallback / manual / internal).
  const cronRoute = (
    path: string,
    handler: (req: Request, res: Response) => void | Promise<void>,
  ) => {
    const wrapped = instrument(path, handler)
    return router.route(path).get(guard, wrapped).post(guard, wrapped)
  }

  /**
   * POST-only internal endpoints, instrumented the same way.
   *
   * Three routes used a bare `router.post` and were therefore invisible to
   * anything wrapper-level — including `/cron/purchase-reconcile`, which
   * reconciles paid Shopify orders against the conversion ledger, so nothing
   * could have told you it had stopped. They go through the recorder now.
   *
   * Deliberately POST-only rather than folded into `cronRoute`: two of them
   * require a request body, and giving an internal endpoint a GET surface it
   * never had is an unrequested change to the HTTP surface, not instrumentation.
   */
  const cronRoutePost = (
    path: string,
    handler: (req: Request, res: Response) => void | Promise<void>,
  ) => router.post(path, guard, instrument(path, handler))

  /**
   * GET|POST /cron/discontinued-sweep
   * Schedule: 11:45 PM — archive products the Nalpac feed now marks discontinued.
   *
   * Replaces /cron/daily-feed-processor, which also scored the feed and staged
   * the next daily deal. Daily deals are retired; the sweep is the part worth
   * keeping. /cron/deal-activator (rotation) is gone entirely.
   */
  cronRoute('/discontinued-sweep', async (_req, res) => {
    try {
      const { runDiscontinuedSweep } = await import('../app/lib/feed-processor.server.js')
      const result = await runDiscontinuedSweep()

      // Catch productPage docs whose Shopify counterpart was archived or removed
      // by a path the SKU-scoped mirror above never sees, so search / IVR stop
      // matching docs that can no longer hydrate a PDP. Best-effort: a reconcile
      // hiccup must not fail the discontinued sweep. The reconcile's own safety
      // guard refuses to mass-archive on a partial Shopify sweep.
      let reconcile: unknown = null
      try {
        const { reconcileArchivedProductPages } = await import('../app/lib/sanity-shopify-reconcile.server.js')
        const rec = await reconcileArchivedProductPages({ apply: true })
        console.log(
          `[cron:discontinued-sweep] reconcile: ${rec.flagged} flagged ` +
          `(${rec.archivedInShopify} archived, ${rec.goneFromShopify} gone), ${rec.patched} patched` +
          (rec.skippedForSafety ? ` — SKIPPED: ${rec.skippedForSafety.reason}` : ''),
        )
        reconcile = rec
      } catch (err) {
        console.error('[cron:discontinued-sweep] reconcile failed (ignored):', err)
        reconcile = { error: String(err) }
      }

      res.json({ ok: true, ...result.discontinuedSweep, reconcile })
    } catch (err) {
      console.error('[cron:discontinued-sweep]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * GET|POST /cron/homepage-healthcheck
   * Schedule: every 30 min — assert `/` + `/discover` render cleanly. On a broken
   * homepage, roll the Sanity homepage doc back to last-good, re-warm the Variant A
   * payload, and alert (Sentry + P0 GitHub issue). Safety net for the autonomous
   * merchandiser's content auto-publish.
   */
  cronRoute('/homepage-healthcheck', async (_req, res) => {
    try {
      const { runHomepageHealthcheck } = await import('../app/lib/homepage-healthcheck.server.js')
      const result = await runHomepageHealthcheck()
      // Report-only sweep of the merchandised category/drop pages (and the
      // deck once flipped) rides the same schedule. It alerts through Sentry
      // and the ticket bus, never through the cron status: the 503 below is
      // reserved for the homepage, whose failure has a rollback path.
      let categoryPages: unknown = null
      try {
        const { runCategoryHealthcheck } = await import('../app/lib/category-healthcheck.server.js')
        categoryPages = await runCategoryHealthcheck()
      } catch (err) {
        console.error('[cron:homepage-healthcheck] category sweep failed:', err)
        categoryPages = { error: String(err) }
      }
      // Non-2xx on failure so Vercel cron + monitoring surface it (recovery,
      // if any, already happened inside runHomepageHealthcheck).
      res.status(result.ok ? 200 : 503).json({ ...result, categoryPages })
    } catch (err) {
      console.error('[cron:homepage-healthcheck]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * GET|POST /cron/notebook-healthcheck
   * Schedule: daily — assert /notebook, the latest post (+ its .md twin), and a
   * category page render cleanly (200, images, JSON-LD). Report-only: alerts
   * Sentry, opens a P1 issue on a hard 5xx, never rolls anything back (the
   * Notebook has no auto-publish path a rollback would undo).
   */
  cronRoute('/notebook-healthcheck', async (_req, res) => {
    try {
      const { runNotebookHealthcheck } = await import('../app/lib/notebook-healthcheck.server.js')
      const result = await runNotebookHealthcheck()
      res.status(result.ok ? 200 : 503).json(result)
    } catch (err) {
      console.error('[cron:notebook-healthcheck]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * POST /cron/profit-summary
   * Schedule: 12:05 AM — write daily profit summary to Neon
   */
  cronRoute('/profit-summary', async (_req, res) => {
    // The drains are independent of the summary. They used to share its try
    // block, so a profit-summary failure silently skipped every queued
    // conversion retry for the day.
    let summaryError: string | null = null
    try {
      const { writeProfitSummary } = await import('../app/lib/profit.server.js')
      await writeProfitSummary()
    } catch (err) {
      summaryError = String(err)
      console.error('[cron:profit-summary]', err)
    }

    const capiRetried = await drainMetaCapiFailures()
    const ga4Retried = await drainGa4Failures()

    if (summaryError) {
      res.status(500).json({ error: summaryError, capiRetried, ga4Retried })
      return
    }
    res.json({ ok: true, capiRetried, ga4Retried })
  })

  /**
   * POST /cron/review-reminders
   * Schedule: 9:00 AM daily — send reminder emails for pending invites
   */
  cronRoute('/review-reminders', async (_req, res) => {
    try {
      const { getReviewSettings, getPendingReminderInvites, markReminderSent, getDueScheduledInvites, markInviteSent } = await import('../app/lib/reviews.server.js')
      const settings = await getReviewSettings()

      // Phase 1: send scheduled invites whose send_after has passed. The
      // orders/fulfilled webhook inserts these immediately (status
      // 'scheduled'); this is the only path that actually delivers them.
      // Runs regardless of remindersEnabled — that setting governs the
      // follow-up nudge, not the initial invite.
      const due = await getDueScheduledInvites()
      let invitesSent = 0
      for (const invite of due) {
        try {
          const { trackReviewInviteSent } = await import('../app/lib/klaviyo.server.js')
          await trackReviewInviteSent({
            email:            invite.reviewerEmail,
            reviewerName:     invite.reviewerName,
            shopifyProductId: invite.shopifyProductId,
            shopifyOrderId:   invite.shopifyOrderId,
            inviteToken:      invite.inviteToken,
          })
          await markInviteSent(invite.id)
          invitesSent++
        } catch (err) {
          console.error('[cron:review-reminders] invite send failed', invite.id, err)
        }
      }

      if (!settings.remindersEnabled) {
        res.json({ ok: true, invitesDue: due.length, invitesSent, remindersSkipped: 'reminders disabled' })
        return
      }

      const invites = await getPendingReminderInvites()
      let sent = 0

      for (const invite of invites) {
        try {
          const { trackEvent } = await import('../app/lib/klaviyo.server.js')

          await trackEvent(invite.reviewerEmail, 'Review Reminder Sent', {
            orderId:      invite.shopifyOrderId,
            productId:    invite.shopifyProductId,
            inviteToken:  invite.inviteToken,
            reviewerName: invite.reviewerName,
            reminderDate: new Date().toISOString(),
          })

          await markReminderSent(invite.id)
          sent++
        } catch (err) {
          console.error('[cron:review-reminders] Failed for invite', invite.id, err)
        }
      }

      res.json({ ok: true, invitesDue: due.length, invitesSent, reminderTotal: invites.length, remindersSent: sent })
    } catch (err) {
      console.error('[cron:review-reminders]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * POST /cron/regenerate-emma-rail
   * Body: { railId: string, dealHandle?: string, trigger?: 'admin' | 'brief_change' | 'agent' }
   * Regenerates one Emma context rail's picks against the current (or given)
   * live deal. Used by Studio actions, admins, and agents via MCP/HTTP.
   */
  cronRoutePost('/regenerate-emma-rail', async (req, res) => {
    try {
      const railId = typeof req.body?.railId === 'string' ? req.body.railId : null
      if (!railId) {
        res.status(400).json({ error: 'railId required' })
        return
      }
      const trigger: 'admin' | 'brief_change' | 'agent' =
        req.body?.trigger === 'brief_change' || req.body?.trigger === 'agent'
          ? req.body.trigger
          : 'admin'

      // Resolve deal handle: body override, else current live deal.
      let dealHandle = typeof req.body?.dealHandle === 'string' ? req.body.dealHandle : null
      if (!dealHandle) {
        const { getDailyDeal } = await import('../app/lib/shopify.server.js')
        const live = await getDailyDeal().catch(() => null)
        dealHandle = live?.handle ?? null
      }
      if (!dealHandle) {
        res.status(400).json({ error: 'no_live_deal' })
        return
      }

      const { regenerateRailById } = await import('../app/lib/emma-rails.server.js')
      const result = await regenerateRailById(railId, dealHandle, trigger)
      res.json({ ok: result.ok, ...(result as object) })
    } catch (err) {
      console.error('[cron:regenerate-emma-rail]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * GET|POST /cron/gsc-snapshot
   * Schedule: Monday 06:00 UTC — pull last-28-day Search Console top
   * queries/pages + sitemap status into gsc_snapshots, ahead of the Monday
   * noon weekly strategy run. No-ops with a logged skip until the GSC
   * service-account env vars are set (GSC_SA_JSON, or GSC_SA_EMAIL +
   * GSC_SA_PRIVATE_KEY; optional GSC_SITE_URL, default sc-domain:xdipx.com).
   */
  /**
   * GET|POST /cron/owner-digest
   * Schedule: daily 13:00 UTC (approx 6a Pacific) — email the owner one
   * digest: orders/profit, team runs and failures, valve snapshot,
   * suggestion queue, and program-tracker RAG. KV-guarded to once per day;
   * pass ?force=1 to re-send while testing.
   */
  cronRoute('/owner-digest', async (req, res) => {
    try {
      const { runOwnerDigest } = await import('../app/lib/owner-digest.server.js')
      const force = req.query['force'] === '1' || req.body?.force === true
      const result = await runOwnerDigest({ force })
      res.json({ ok: true, ...result })
    } catch (err) {
      console.error('[cron:owner-digest]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * GET|POST /cron/blocker-list
   * Schedule: daily 13:30 UTC (approx 6:30a Pacific) — the owner blocker list,
   * sent as its own short email half an hour after the digest. Deliberately
   * NOT a digest section: a task list welded to a fourteen-section ops report
   * reads as reference material, which is how blockers went unnoticed for
   * days. Verifies every probe before composing, so a blocker cleared
   * yesterday never appears. Sends even when empty. Pass ?force=1 to re-send.
   */
  cronRoute('/blocker-list', async (req, res) => {
    try {
      const { runBlockerEmail } = await import('../app/lib/owner-blockers.server.js')
      const force = req.query['force'] === '1' || req.body?.force === true
      const result = await runBlockerEmail({ force })
      res.json({ ok: true, ...result })
    } catch (err) {
      console.error('[cron:blocker-list]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  cronRoute('/gsc-snapshot', async (_req, res) => {
    try {
      const { runGscSnapshot } = await import('../app/lib/gsc.server.js')
      const result = await runGscSnapshot()
      res.json({ ok: true, ...result })
    } catch (err) {
      console.error('[cron:gsc-snapshot]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * GET|POST /cron/gsc-index-sweep
   * Schedule: every 3 hours at :15 — rotate through the sitemap with the
   * URL Inspection API (200 URLs/run, 8 runs/day, KV-capped at 1,900/day
   * against the 2,000/day property quota) and upsert per-URL index state
   * plus the gsc_index_daily aggregate. ?budget=N overrides the run budget.
   * No-ops with a logged skip until the GSC service-account env vars are set.
   */
  cronRoute('/gsc-index-sweep', async (req, res) => {
    try {
      const { runGscIndexSweep } = await import('../app/lib/gsc-index.server.js')
      const budgetParam = Number(req.query['budget'])
      const result = await runGscIndexSweep(
        Number.isFinite(budgetParam) && budgetParam > 0 ? { budget: budgetParam } : {},
      )
      res.json({ ok: true, ...result })
    } catch (err) {
      console.error('[cron:gsc-index-sweep]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * GET|POST /cron/indexnow-push
   * Schedule: daily 04:40 UTC — bulk IndexNow submission.
   * ?scope=stale (default) pushes exactly the cached-bad-verdict URLs that need
   * a recrawl signal (~1,565 today: noindex + duplicate-canonical leftovers
   * from the May outage, minus the dead ones we trust). ?scope=all pushes the
   * whole sitemap. ?limit=N caps the run.
   * URLs pushed in the last 14 days are excluded; a 429/5xx stops the run and
   * records nothing, so the next pass is a clean retry. Read-only with respect
   * to the sitemap and gsc_url_inspections: no lastmod is ever bumped.
   * No-ops with a logged skip until SEARCH_PING_ENABLED + INDEXNOW_API_KEY are set.
   */
  cronRoute('/indexnow-push', async (req, res) => {
    try {
      const { runIndexNowBulkPush } = await import('../app/lib/indexnow-bulk.server.js')
      const scopeParam = req.query['scope'] ?? req.body?.scope
      const scope = scopeParam === 'all' ? 'all' : 'stale'
      const limitParam = Number(req.query['limit'] ?? req.body?.limit)
      const result = await runIndexNowBulkPush({
        scope,
        ...(Number.isFinite(limitParam) && limitParam > 0 ? { limit: limitParam } : {}),
      })
      res.json({ ok: !result.error, ...result })
    } catch (err) {
      console.error('[cron:indexnow-push]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * GET|POST /cron/seo-daily
   * Schedule: daily 12:30 UTC — 30 min before the 13:00 owner digest, so the
   * digest reads a fresh row. Computes week-over-week index deltas and 24h
   * coverage transitions, runs the live regression tripwire (200 +
   * self-canonical + no noindex + parseable JSON-LD on a sampled page set),
   * writes seo_coverage_daily, and files deduped tickets on anomalies.
   */
  cronRoute('/seo-daily', async (_req, res) => {
    try {
      const { runSeoDaily } = await import('../app/lib/seo-daily.server.js')
      const result = await runSeoDaily()
      // 503 on a live-probe failure so Vercel cron monitoring surfaces the one
      // class of problem that is actively damaging indexation right now.
      res.status(result.probeFailures > 0 ? 503 : 200).json({ ok: result.probeFailures === 0, ...result })
    } catch (err) {
      console.error('[cron:seo-daily]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * GET|POST /cron/conversation-quality-daily
   * Schedule: daily 03:20 UTC — well after midnight UTC so it always
   * aggregates a fully-closed prior day across every timezone that matters
   * here. Aggregates yesterday's sms_turns (the unified per-turn log for
   * web/sms/voice) into conversation_quality_daily: sessions, turns,
   * fabrication-guard trips, tool-budget exhaustion, error turns, the
   * v2-to-v1 web fallback count, and p50/p95 latency, per channel (ticket
   * #625). See app/lib/conversation-quality-daily.server.ts for exactly
   * which of the ticket's originally-requested signals this does and does
   * not cover.
   */
  cronRoute('/conversation-quality-daily', async (req, res) => {
    try {
      const { runConversationQualityDaily } = await import('../app/lib/conversation-quality-daily.server.js')
      const dayParam = req.query['day'] ?? req.body?.day
      const day = typeof dayParam === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : undefined
      const result = await runConversationQualityDaily(day)
      res.json({ ok: true, ...result })
    } catch (err) {
      console.error('[cron:conversation-quality-daily]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * POST /cron/keyword-research
   * Schedule: monthly, 1st 02:00 UTC — discover new SEO keywords via
   * DataForSEO (when creds exist) or LLM-only expansion, classify, and write
   * to Sanity as pending or approved.
   * Gated by the keyword_research_enabled valve (paused in #198 to stop
   * spend; the valve makes re-enabling a dashboard action).
   * Also callable on-demand by admin (with the cron secret).
   * Body (optional): { manualSeeds?: string[], maxSeeds?: number }
   */
  cronRoute('/keyword-research', async (req, res) => {
    try {
      const { getValve } = await import('../app/lib/team.server.js')
      const { VALVE_KEYS } = await import('../app/lib/team-keys.js')
      if (!(await getValve(VALVE_KEYS.keywordResearch))) {
        console.log('[cron:keyword-research] skipped: keyword_research_enabled is off')
        res.json({ ok: true, skipped: 'keyword_research_enabled is off' })
        return
      }
      const { runKeywordResearch } = await import('../app/lib/seo-research.server.js')
      const opts: { maxSeeds?: number; manualSeeds?: string[] } = {}
      const rawMaxSeeds = req.body?.maxSeeds ?? (req.query['maxSeeds'] ? Number(req.query['maxSeeds']) : undefined)
      if (typeof rawMaxSeeds === 'number' && !isNaN(rawMaxSeeds)) opts.maxSeeds = rawMaxSeeds
      // Scheduled (Vercel cron) invocations carry no body or query — cap those
      // at 40 seeds, matching the cap the old GitHub Actions schedule passed via
      // ?maxSeeds=40. Explicit callers (admin / MCP) keep the library default.
      const isScheduled = req.headers['x-vercel-cron-schedule'] !== undefined || req.headers['user-agent'] === 'vercel-cron/1.0'
      if (opts.maxSeeds === undefined && isScheduled) opts.maxSeeds = 40
      const rawManualSeeds = req.body?.manualSeeds ?? (
        typeof req.query['manualSeeds'] === 'string'
          ? req.query['manualSeeds'].split(',').map(s => s.trim()).filter(Boolean)
          : undefined
      )
      if (Array.isArray(rawManualSeeds)) {
        opts.manualSeeds = (rawManualSeeds as unknown[]).filter((s): s is string => typeof s === 'string')
      }
      const result = await runKeywordResearch(opts)
      res.json({ ok: true, ...result })
    } catch (err) {
      console.error('[cron:keyword-research]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * POST /cron/log-monitor
   * Schedule: every 15 min — pull recent Vercel runtime logs, classify
   * signal vs noise via Claude haiku, open GitHub issues for P0 groups.
   * Body (optional): { windowMinutes?: number }
   */
  /**
   * The conversion-delivery watcher and the CAPI reconciler, on their own cron.
   *
   * These two rode `/cron/log-monitor` for one stated reason, written in the
   * comment they used to sit under: it was "the only existing every-15-minutes
   * slot and vercel.json is a protected path". **`vercel.json` stopped being a
   * protected path on 2026-08-19**, so the constraint that put a P0 money-path
   * watcher inside a log classifier is gone.
   *
   * Splitting them out is not tidiness. Stage G3 drops the log-monitor route to
   * hourly, and leaving these attached would have quietly taken the check that
   * notices Purchase conversion delivery is dead from every 15 minutes to every
   * 60 — a money-path regression hidden inside a cost saving, on the exact path
   * that once stayed broken for two months undetected.
   *
   * Order is deliberate and unchanged. The watcher observes delivery health from
   * `order_line_items` (did the webhook handler run at all), then the reconciler
   * heals CAPI delivery via `meta_capi_outbox`. They read different tables, so
   * healing cannot mask the alarm.
   */
  cronRoute('/conversion-watch', async (_req, res) => {
    // Each gets its own try: neither may take down the other, and in particular
    // the watcher must never be skipped because reconciliation threw.
    let purchaseWatch: unknown = null
    try {
      const { runPurchaseWatcher } = await import('../app/lib/purchase-watcher.server.js')
      purchaseWatch = await runPurchaseWatcher()
    } catch (err) {
      console.error('[cron:conversion-watch] purchase-watcher failed (ignored):', err)
    }

    let purchaseReconcile: unknown = null
    try {
      const { reconcilePurchases } = await import('../app/lib/purchase-capi.server.js')
      const r = await reconcilePurchases({ sinceHours: 26 })
      purchaseReconcile = { scanned: r.scanned, gaps: r.gaps.length, sent: r.sent.length, failed: r.failed.length, tooOld: r.tooOld.length }
    } catch (err) {
      console.error('[cron:conversion-watch] purchase reconcile error:', err)
    }

    res.json({ ok: true, purchaseWatch, purchaseReconcile })
  })

  /**
   * POST /cron/log-monitor
   * Hourly. The auto-expired-run folder.
   *
   * The Haiku log classifier that gave this route its name is gone (Stage G3):
   * 433 calls and 16.9M input tokens over 30 days for zero log-derived tickets
   * in its lifetime. What is left reads `homepage_team_runs` for runs the idle
   * reaper marked failed and files one ticket per recurring class at the lane
   * that owns the run. That never needed a model, and it was the only thing
   * here that ever produced a ticket.
   *
   * Hourly rather than every 15 minutes because these are post-hoc diagnostic
   * tickets, not real-time pages — `fetchExpiredRunGroups` deliberately holds a
   * run back through a recovery grace before surfacing it, since a quiet-but-
   * alive run can be reaped and then finish successfully minutes later.
   *
   * The route path is kept rather than renamed: ADR-009 records the decision to
   * ride it, and rewriting an ADR to match a later change falsifies the record.
   */
  cronRoute('/log-monitor', async (req, res) => {
    try {
      const { runLogMonitor } = await import('../app/lib/log-monitor.server.js')
      const rawWindow = req.body?.windowMinutes ?? (req.query['windowMinutes'] ? Number(req.query['windowMinutes']) : undefined)
      const windowMinutes = typeof rawWindow === 'number' && !isNaN(rawWindow) ? rawWindow : 60
      const result = await runLogMonitor({ windowMinutes })
      res.json({ ok: true, ...result })
    } catch (err) {
      console.error('[cron:log-monitor]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * POST /cron/purchase-reconcile
   * Query/body: { sinceHours?: number, dryRun?: boolean }
   * On-demand Meta CAPI Purchase reconciliation. Sends a Purchase for every
   * paid Shopify order with no resolved ledger row. Idempotent by construction
   * (deterministic purchase_<orderId> event id), so it is always safe to run.
   * No vercel.json cron entry: the sweep also rides /cron/conversion-watch.
   */
  cronRoutePost('/purchase-reconcile', async (req, res) => {
    try {
      const { reconcilePurchases } = await import('../app/lib/purchase-capi.server.js')
      const rawSince = req.body?.sinceHours ?? (req.query['sinceHours'] ? Number(req.query['sinceHours']) : undefined)
      const sinceHours = typeof rawSince === 'number' && !isNaN(rawSince) ? rawSince : 26
      const dryRun = req.body?.dryRun === true || req.query['dryRun'] === '1' || req.query['dryRun'] === 'true'
      const result = await reconcilePurchases({ sinceHours, dryRun })
      res.json({ ok: true, ...result })
    } catch (err) {
      console.error('[cron:purchase-reconcile]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * POST /cron/pricing-batch-recompute
   * Schedule: 07:00 UTC (02:00 ET) daily — recompute all variant prices using
   * the v2 target-margin engine, write audit log rows, auto-apply within threshold.
   * Query: ?dry=1 to inspect counts without applying (not yet implemented; returns counts).
   */
  cronRoute('/pricing-batch-recompute', handlePricingBatchRecompute)
  // Retention, deliberately on its own budget rather than riding the recompute's.
  cronRoute('/pricing-audit-prune', handlePricingAuditPrune)

  /**
   * POST /cron/import-monitor
   * Schedule: 08:00 UTC daily — diff 4 Nalpac feeds against carried-SKU set,
   * tier + score + price-preview candidates, upsert import_candidates.
   * Gated by import_monitor_enabled kill-switch and import_monitor_run_days CSV.
   */
  /**
   * GET|POST /cron/social-publish
   * Schedule: hourly. Publishes approved, due drafts for every platform whose
   * autopublish valve is on (Instagram ticket #2740, X 2026-08-16).
   *
   * SHIPS INERT per platform: instagram_autopublish_enabled and
   * x_autopublish_enabled both default off and are read fresh every tick, so
   * this does nothing until the owner flips one. Those flips are his move;
   * nothing in the agent fleet may make them.
   *
   * The substance lives in app/lib/social-publish-job.server.ts (the tick) and
   * app/lib/social-publish-run.server.ts (which platforms, which valves, which
   * caps). Neither is a protected path and both carry tests. This handler stays
   * registration only, which is why adding X did not require rewriting it.
   *
   * AWAITED before responding, deliberately. Work that continues after the
   * response is discarded on Vercel, which is how six Shopify webhook handlers
   * silently did nothing for months.
   */
  cronRoute('/social-publish', async (_req, res) => {
    try {
      const { runAllSocialPublishTicks } =
        await import('../app/lib/social-publish-run.server.js')
      const results = await runAllSocialPublishTicks()
      res.json({ ok: true, results })
    } catch (err) {
      console.error('[cron/social-publish] failed:', err)
      res.status(500).json({ ok: false, error: (err as Error).message })
    }
  })

  /**
   * GET|POST /cron/social-metrics-sweep
   * Schedule: every 6 hours. Refreshes metrics_json on posted Instagram and X
   * rows from the last 30 days and appends an IG follower reading (Social
   * Studio v2 Phase 6b, ticket #4916).
   *
   * SHIPS INERT: social_metrics_sweep_enabled defaults off and is read every
   * tick. X bills per metrics read, so the valve and x_metrics_max_reads_month
   * are owner-only spend controls. Read-only against both platforms.
   * Awaited before responding, same reason as social-publish.
   */
  cronRoute('/social-metrics-sweep', async (_req, res) => {
    try {
      const { runSocialMetricsSweep } =
        await import('../app/lib/social-metrics-sweep.server.js')
      const result = await runSocialMetricsSweep()
      res.json({ ok: true, result })
    } catch (err) {
      console.error('[cron/social-metrics-sweep] failed:', err)
      res.status(500).json({ ok: false, error: (err as Error).message })
    }
  })

  /**
   * GET|POST /cron/social-asset-auto-archive
   * Schedule: daily. Archives unpicked social_media_assets rows past a
   * tunable age threshold (default 60 days, `social_library_auto_archive_days`
   * pipeline_setting) so the library grid and Composer picker stay
   * browsable at ~110 new images/day (ticket #5426). Reversible: sets
   * archivedAt only, never deletes a row. Refuses per-asset when a usage
   * guard blocks it (see `assessArchiveEligibility`); a refusal here is
   * silent-safe, the row just stays in the active library for a future tick.
   */
  cronRoute('/social-asset-auto-archive', async (_req, res) => {
    try {
      const { runSocialAssetAutoArchiveSweep } =
        await import('../app/lib/social-studio.server.js')
      const result = await runSocialAssetAutoArchiveSweep()
      res.json({ ok: true, result })
    } catch (err) {
      console.error('[cron/social-asset-auto-archive] failed:', err)
      res.status(500).json({ ok: false, error: (err as Error).message })
    }
  })

  cronRoute('/import-monitor', async (_req, res) => {
    try {
      const { getPipelineSetting } = await import('../app/lib/feed-processor.server.js')

      // Kill-switch gate.
      const enabled = await getPipelineSetting('import_monitor_enabled')
      if (enabled === 'false') {
        res.json({ ok: true, skipped: true, reason: 'monitor_disabled' })
        return
      }

      // Day-of-week gate. import_monitor_run_days is a CSV of UTC day numbers (0=Sun).
      const runDaysSetting = await getPipelineSetting('import_monitor_run_days')
      const runDays = (runDaysSetting ?? '0,1,2,3,4,5,6')
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n))
      const todayUtcDay = new Date().getUTCDay()
      if (!runDays.includes(todayUtcDay)) {
        res.json({ ok: true, skipped: true, reason: `not_scheduled_today (day=${todayUtcDay})` })
        return
      }

      const { runImportMonitor } = await import('../app/lib/import-monitor.server.js')
      const result = await runImportMonitor({ source: 'cron' })
      res.json({ ok: true, ...result })
    } catch (err) {
      console.error('[cron:import-monitor]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * POST /cron/import-enrich
   * Schedule: every 30 min — self-draining post-import lifecycle tick.
   * Collects finished enrichment batches, publishes enriched drafts, then
   * submits a new batch if none is in flight. Gated by import_enrich_enabled
   * (checked inside runImportEnrichTick).
   */
  cronRoute('/import-enrich', async (_req, res) => {
    const { kvSetNX, kvDel } = await import('../app/lib/kv.server.js')
    // Lock TTL must exceed the tick's wall-clock budget (240s submit deadline
    // inside a 300s function) so a legitimately long tick never loses its lock
    // and lets a second, overlapping tick start.
    const acquired = await kvSetNX('lock:import-enrich', String(Date.now()), 290)
    if (!acquired) {
      res.json({ ok: true, skipped: 'locked' })
      return
    }
    try {
      const { runImportEnrichTick } = await import('../app/lib/import-enrich.server.js')
      const result = await runImportEnrichTick({ source: 'cron' })
      res.json(result)
    } catch (err) {
      console.error('[cron:import-enrich]', err)
      res.status(500).json({ error: String(err) })
    } finally {
      await kvDel('lock:import-enrich')
    }
  })

  /**
   * GET|POST /cron/checkout-probe
   * Schedule: every 6h — HTTP-tier synthetic probe of the purchase path up to
   * the Shopify checkout page. Writes a row and alerts the owner on failure.
   * 503 on failure so Vercel cron monitoring surfaces it.
   */
  cronRoute('/checkout-probe', async (_req, res) => {
    try {
      const { runCheckoutProbe, recordAndAlertProbe } = await import('../app/lib/checkout-probe.server.js')
      const result = await runCheckoutProbe()
      await recordAndAlertProbe('http', result)
      res.status(result.ok ? 200 : 503).json(result)
    } catch (err) {
      console.error('[cron:checkout-probe]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * GET|POST /cron/release-engine
   * Schedule: every 10 minutes. Merges gate-passing agent PRs, waits for the
   * production deploy, smoke-tests the live site, and reverts on failure.
   *
   * Lives on Vercel rather than in a cloud routine because cloud egress cannot
   * reach api.github.com or api.vercel.com and both tokens are in Vercel's env.
   *
   * `?dryRun=1` (or `dry=1`) logs every decision and merges nothing. That is
   * the staging path: watch a clean dry-run cycle before flipping
   * `release_engine_enabled` on. The kill switch is checked first regardless,
   * so with the valve off this route is a no-op either way.
   *
   * Always 200 on a completed cycle, including "did nothing": the engine
   * deciding to wait is normal, and a 503 there would page for nothing. A
   * config error or a thrown cycle is 503.
   */
  cronRoute('/release-engine', async (req, res) => {
    try {
      const q = req.query as Record<string, unknown>
      const flag = (v: unknown) => v === '1' || v === 'true'
      const dryRun = flag(q['dryRun']) || flag(q['dry'])
      const { runReleaseEngineCycle } = await import('../app/lib/release-engine.server.js')
      const result = await runReleaseEngineCycle({ dryRun })
      res.status(result.ok ? 200 : 503).json(result)
    } catch (err) {
      console.error('[cron:release-engine]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * GET|POST /cron/main-ci-watch
   * Schedule: every 10 minutes. Emails the owner when main's `check` run is
   * red, produced no verdict, or never happened at all.
   *
   * Deliberately NOT part of /cron/release-engine, despite the identical
   * cadence and the engine already owning an escalate() helper. The engine is
   * behind `release_engine_enabled`, and an alarm must not share a kill switch
   * with the thing it watches: pausing automation is exactly when a broken main
   * most needs to be shouted about. See the module header for the full argument.
   *
   * `?dryRun=1` (or `dry=1`) decides and logs without sending mail.
   *
   * `?sha=<commit>` evaluates that commit instead of main's head. This is how
   * the alert path gets exercised without breaking main, since the only other
   * way to see a real alert is to push a broken commit and a red main deploys
   * to production. Point it at a historically red commit and everything is
   * real except which commit is being looked at. Probes are state-free and
   * clearly marked in the subject and body; see the module header.
   *
   * Always 200 on a completed pass, including a red main: the alert IS the
   * outcome, and a 503 would make Vercel's cron monitoring page for a condition
   * that has already been reported through the channel that matters. 503 is
   * reserved for the watcher itself being unable to reach a decision.
   */
  cronRoute('/main-ci-watch', async (req, res) => {
    try {
      const q = req.query as Record<string, unknown>
      const flag = (v: unknown) => v === '1' || v === 'true'
      const dryRun = flag(q['dryRun']) || flag(q['dry'])
      // 40-hex only. A free-form string here becomes a GitHub API path segment.
      const rawSha = typeof q['sha'] === 'string' ? q['sha'].trim() : ''
      const sha = /^[0-9a-f]{40}$/i.test(rawSha) ? rawSha : undefined
      if (rawSha && !sha) {
        res.status(400).json({ error: 'sha must be a full 40-character commit hash' })
        return
      }
      const { runMainCiWatch } = await import('../app/lib/main-ci-watch.server.js')
      const result = await runMainCiWatch({ dryRun, sha })
      res.status(result.ok ? 200 : 503).json(result)
    } catch (err) {
      console.error('[cron:main-ci-watch]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * POST /cron/checkout-probe-report
   * Ingests the browser-tier Playwright result (a ProbeResult JSON body) from
   * the GitHub Action and records + alerts through the same path as the HTTP
   * tier. Guarded by CRON_SECRET like every cron route.
   */
  cronRoute('/checkout-probe-report', async (req, res) => {
    try {
      const body = req.body as { ok?: unknown; failedStep?: unknown; steps?: unknown; durationMs?: unknown } | undefined
      if (!body || typeof body.ok !== 'boolean' || !Array.isArray(body.steps)) {
        res.status(400).json({ error: 'expected a ProbeResult body { ok, failedStep, steps[], durationMs }' })
        return
      }
      const result = {
        ok: body.ok,
        failedStep: typeof body.failedStep === 'string' ? body.failedStep : null,
        steps: body.steps as { step: string; ok: boolean; status?: number; ms: number; detail?: string }[],
        durationMs: typeof body.durationMs === 'number' ? body.durationMs : 0,
      }
      const { recordAndAlertProbe } = await import('../app/lib/checkout-probe.server.js')
      const out = await recordAndAlertProbe('browser', result)
      res.json({ ok: true, ...out })
    } catch (err) {
      console.error('[cron:checkout-probe-report]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * GET|POST /cron/outreach-inbox
   * Schedule: every 30 minutes. Poll hello@xdipx.com over IMAP for replies to
   * outreach emails (read-only towards the mailbox: BODY.PEEK, matched threads
   * only, never flags/moves/deletes; see outreach-inbox.server.ts).
   *
   * Free until armed: when the outreach_send_enabled valve is off AND no
   * outreach_messages rows exist, the handler no-ops before touching IMAP,
   * so shipping the cron costs nothing until the owner enables the pipeline.
   */
  cronRoute('/outreach-inbox', async (_req, res) => {
    try {
      const { isOutreachSendEnabled } = await import('../app/lib/outreach.server.js')
      const { hasAnyOutreachMessages, pollOutreachInbox } = await import('../app/lib/outreach-inbox.server.js')
      if (!(await isOutreachSendEnabled()) && !(await hasAnyOutreachMessages())) {
        res.json({ ok: true, skipped: 'outreach not armed' })
        return
      }
      const result = await pollOutreachInbox()
      res.status(result.ok ? 200 : 503).json(result)
    } catch (err) {
      console.error('[cron:outreach-inbox]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * POST /cron/enrichment-batch-poller
   * Schedule: every 2 minutes. Advances every in-flight batch_job by one pass
   * (retrieve current turn's batch; if ended, distribute + run tools + submit
   * next turn or apply). Bounded work per invocation to fit the 60s budget.
   */
  cronRoute('/enrichment-batch-poller', async (_req, res) => {
    const { kvGet, kvSetNX, kvDel, KV_KEYS } = await import('../app/lib/kv.server.js')
    // Negative cache: when the last pass found zero in-flight jobs, skip the
    // Neon query entirely so the every-2-min cron doesn't keep DB compute
    // awake. enqueueBatchJob deletes the flag; the TTL bounds staleness.
    const idle = await kvGet(KV_KEYS.enrichmentPollerIdle)
    if (idle != null) {
      res.json({ ok: true, skipped: 'idle' })
      return
    }
    const acquired = await kvSetNX('lock:enrichment-poller', String(Date.now()), POLLER_LOCK_TTL_SECONDS)
    if (!acquired) {
      res.json({ ok: true, skipped: 'locked' })
      return
    }
    try {
      const { advanceInflightJobs } = await import('../app/lib/batch-orchestrator.server.js')
      const result = await advanceInflightJobs({ maxJobs: 10, perJobBudgetMs: 8000 })
      res.json({ ok: true, ...result })
    } catch (err) {
      console.error('[cron:enrichment-batch-poller]', err)
      res.status(500).json({ error: String(err) })
    } finally {
      await kvDel('lock:enrichment-poller')
    }
  })

  /**
   * GET|POST /cron/video-job-poller
   * Schedule: every 2 minutes. Advances every in-flight video_jobs row by one
   * stage pass (compose frames / submit fal / poll fal / assemble / poster).
   * Jobs parked at awaiting_frame_approval are outside the in-flight set and
   * cost nothing here.
   *
   * LOCK TTL MUST OUTLIVE THE INVOCATION (ticket #5941). advanceJob dispatches
   * on job.stage and marks no row busy, so this lock is the ONLY thing keeping
   * two passes off the same job. At the old 110s against a 120s cron and a
   * 300s maxDuration, any pass slower than 110s had its lock expire while it
   * was still working: the next tick acquired it, re-selected the same
   * in-flight rows (status unchanged) and re-ran the same stage concurrently.
   * That is not theoretical — one assembly pass alone carries ffmpeg timeouts
   * of 180s + 120s + 60s x3, and a pass may carry five jobs. A doubled
   * scene_frame stage composes and PAYS FOR a second set of candidates; a
   * doubled assembly re-runs the post pass (music generation is metered) and
   * double-increments assembly_attempts, degrading the cut early.
   *
   * The invariant is lock TTL >= maxDuration > cron interval, which is what
   * /cron/import-enrich above already does at 290s. While the lambda lives the
   * lock is held; if it is killed at maxDuration the lock expires just after
   * and the next tick retries, which is the correct outcome.
   */
  cronRoute('/video-job-poller', async (_req, res) => {
    const { kvGet, kvSetNX, kvDel, KV_KEYS } = await import('../app/lib/kv.server.js')
    const idle = await kvGet(KV_KEYS.videoPollerIdle)
    if (idle != null) {
      res.json({ ok: true, skipped: 'idle' })
      return
    }
    const acquired = await kvSetNX('lock:video-poller', String(Date.now()), POLLER_LOCK_TTL_SECONDS)
    if (!acquired) {
      res.json({ ok: true, skipped: 'locked' })
      return
    }
    try {
      const { advanceInflightVideoJobs } = await import('../app/lib/video-pipeline.server.js')
      const result = await advanceInflightVideoJobs({ maxJobs: 5 })
      res.json({ ok: true, ...result })
    } catch (err) {
      console.error('[cron:video-job-poller]', err)
      res.status(500).json({ error: String(err) })
    } finally {
      await kvDel('lock:video-poller')
    }
  })

  /**
   * POST /cron/aeo-surface-check
   * Schedule: weekly Sunday 06:00 UTC — spot-check that AEO markdown surfaces
   * are reachable. Parses /llms.txt, fetches 3-5 .md URLs cold, logs errors so
   * Sentry picks them up without failing the deployment.
   */
  cronRoute('/aeo-surface-check', async (_req, res) => {
    const siteUrl = process.env['BASE_URL'] ?? process.env['SITE_URL'] ?? ''
    if (!siteUrl) {
      console.error('[cron:aeo-surface-check] BASE_URL / SITE_URL not set — skipping')
      res.json({ ok: true, skipped: true, reason: 'BASE_URL not set' })
      return
    }

    const results: { url: string; status: number; ok: boolean; error?: string }[] = []

    try {
      // Fetch llms.txt
      const llmsRes = await fetch(`${siteUrl}/llms.txt`, { headers: { 'Cache-Control': 'no-cache' } })
      if (!llmsRes.ok) {
        console.error(`[cron:aeo-surface-check] /llms.txt returned ${llmsRes.status}`)
        res.json({ ok: false, llmsStatus: llmsRes.status, results })
        return
      }

      const llmsText = await llmsRes.text()

      // Parse up to 5 .md URLs from the response body
      const mdUrls = [...llmsText.matchAll(/https:\/\/[^\s)]+\.md/g)]
        .map(m => m[0]!)
        .filter((u, i, arr) => arr.indexOf(u) === i) // dedupe
        .slice(0, 5)

      await Promise.allSettled(
        mdUrls.map(async url => {
          try {
            const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } })
            const ct = r.headers.get('content-type') ?? ''
            const ok = r.ok && ct.includes('text/markdown')
            if (!ok) {
              console.error(
                `[cron:aeo-surface-check] ${url} returned status=${r.status} content-type="${ct}"`,
              )
            }
            results.push({ url, status: r.status, ok })
          } catch (err) {
            console.error(`[cron:aeo-surface-check] fetch failed for ${url}:`, err)
            results.push({ url, status: 0, ok: false, error: String(err) })
          }
        }),
      )

      const failures = results.filter(r => !r.ok)
      if (failures.length > 0) {
        console.error(
          `[cron:aeo-surface-check] ${failures.length} of ${results.length} .md URLs failed`,
          failures,
        )
      }

      res.json({ ok: failures.length === 0, checked: results.length, failures: failures.length, results })
    } catch (err) {
      console.error('[cron:aeo-surface-check]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  // /cron/inventory-check is retired. Its only job was polling the live daily
  // deal for sell-out and rotating to the next queued deal. Back-in-stock
  // notifications do not come from here — they fire from the Shopify inventory
  // webhook in server/webhooks.ts, which is untouched.

  /**
   * POST /cron/warm-discovery-index
   * Called by triggerDiscoveryRebuild() (fire-and-forget from SSR on cold KV miss)
   * and by /cron/warm. Builds the full discovery index and vocab, writes to KV.
   */
  cronRoutePost('/warm-discovery-index', async (_req, res) => {
    try {
      const {
        buildDiscoveryIndex,
        computeVocab,
        writeDiscoveryIndexDurable,
      } = await import('../app/lib/discovery.server.js')

      const fresh = await buildDiscoveryIndex()

      if (fresh.length > 0) {
        const vocab = computeVocab(fresh)
        await writeDiscoveryIndexDurable(fresh, vocab)
        console.log(`[cron:warm-discovery-index] wrote ${fresh.length} products to KV + Neon`)
      }

      res.json({ ok: true, count: fresh.length })
    } catch (err) {
      console.error('[cron:warm-discovery-index]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * GET|POST /cron/instagram-comments-ingest
   * Schedule: hourly. Instagram comment support lane, phase 1 (ticket #2027).
   * Pulls comments for every Instagram post from the last 14 days via the
   * Graph API and upserts them into social_comments at status 'inbound'.
   * Never fails loudly on a missing/under-scoped token: `ingestRecentComments`
   * reports `ok:false` with a `detail` the admin queue renders as a banner,
   * so a token problem degrades to "nothing new ingested, here's why" rather
   * than a 500 or a silent empty result.
   */
  cronRoute('/instagram-comments-ingest', async (_req, res) => {
    const { kvSetNX, kvDel, kvSet } = await import('../app/lib/kv.server.js')
    const acquired = await kvSetNX('lock:instagram-comments-ingest', String(Date.now()), 290)
    if (!acquired) {
      res.json({ ok: true, skipped: 'locked' })
      return
    }
    try {
      const { ingestRecentComments } = await import('../app/lib/social-publish/instagram-comments.server.js')
      const result = await ingestRecentComments()
      // Read by the /admin/socials/comments loader to render a banner when a
      // token is missing or under-scoped, instead of the page silently
      // showing zero new comments with no explanation.
      await kvSet('social-comments-ingest:last', { ...result, checkedAt: new Date().toISOString() }, 3600 * 6)
      res.json(result)
    } catch (err) {
      console.error('[cron:instagram-comments-ingest]', err)
      res.status(500).json({ error: String(err) })
    } finally {
      await kvDel('lock:instagram-comments-ingest')
    }
  })

  /**
   * GET|POST /cron/warm
   * Schedule: every 15 min (Vercel cron; see vercel.json).
   * (1) Rebuilds the discovery index via the warm-discovery-index handler.
   * (2) Reads the current live deal handle from deal_history.
   * (3) Fires GET requests to / and /products/{handle} with no-cache headers
   *     to prime the Vercel CDN SWR cache before Googlebot's next crawl window.
   */
  /**
   * GET|POST /cron/warm-homepage
   * Rebuilds the precomputed Variant A homepage payload (KV + Neon) so the
   * indexable request path reads one blob instead of fanning out. force=true:
   * an explicit warm always refreshes. Standalone for on-demand / admin use;
   * also folded into /warm Step 1.5 for the scheduled 15-min sweep.
   */
  cronRoute('/warm-homepage', async (_req, res) => {
    try {
      const { warmHomepagePayloadA } = await import('../app/lib/homepage-payload.server.js')
      const p = await warmHomepagePayloadA({ force: true })
      res.json({
        ok: true,
        degraded: p.degraded,
        bytes: JSON.stringify(p).length,
        sections: p.sections.length,
        rails: p.rails.length,
      })
    } catch (err) {
      console.error('[cron:warm-homepage]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * GET|POST /cron/warm-homepage-b
   * Variant B (storefront) equivalent of /warm-homepage. Rebuilds the
   * precomputed storefront blob so `assembleStorefrontHome` reads ~50–100 KB
   * instead of pulling the full 4K-SKU / 2.7 MB discovery index on every render.
   * Standalone for on-demand / admin use; also folded into /warm Step 1.6.
   */
  cronRoute('/warm-homepage-b', async (_req, res) => {
    try {
      const { warmHomepagePayloadB } = await import('../app/lib/storefront-home.server.js')
      const p = await warmHomepagePayloadB({ force: true })
      res.json({
        ok: true,
        degraded: p.degraded,
        bytes: JSON.stringify(p).length,
        rails: p.rails.length,
        total: p.total,
      })
    } catch (err) {
      console.error('[cron:warm-homepage-b]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  cronRoute('/warm', async (_req, res) => {
    try {
      const baseUrl = process.env['BASE_URL'] ?? ''
      const cronSecret = process.env['CRON_SECRET'] ?? ''

      // Step 1: rebuild the discovery index — but only when it is actually
      // stale. This used to fire unconditionally on every 15-minute tick.
      //
      // Measured 2026-08-05: one catalog page costs 128 rate-limit points and
      // the catalog is 46 pages, so a rebuild is 5,888 points against a
      // 2,000-point bucket refilling at 100/s. It is 2.9x the whole bucket, so
      // it throttles itself after 15 pages and then pins the bucket near zero
      // for ~60s. Sampled across a cron boundary: 1999 -> 1864 -> 138 -> 128 ->
      // 575 -> 1999. Every other Admin API caller in that window died —
      // the purchase reconcile sweep (also every 15 min, so it collided every time),
      // warm-discovery-index 500ing on itself, and getDiscoveryRails timing out
      // so the homepage served a degraded payload.
      //
      // The products/create and products/update webhooks went live 2026-08-05,
      // so the catalog now tells us when it changes and the crawl can follow
      // real events instead of a timer. The staleness floor is the safety net
      // for anything that changes without a webhook (a collection edit, a
      // missed delivery, a KV eviction of the flag).
      let discoveryCount = 0
      let discoverySkipped: string | null = null
      if (baseUrl && cronSecret) {
        const { isDiscoveryIndexDirty, getDiscoveryIndexAgeMs, shouldRebuildDiscoveryIndex } =
          await import('../app/lib/discovery.server.js')
        const decision = shouldRebuildDiscoveryIndex({
          dirty: await isDiscoveryIndexDirty(),
          ageMs: await getDiscoveryIndexAgeMs(),
        })
        if (!decision.rebuild) {
          discoverySkipped = decision.reason
          console.log(`[cron:warm] discovery rebuild skipped — ${decision.reason}`)
        } else {
          console.log(`[cron:warm] discovery rebuild — ${decision.reason}`)
          try {
            const r = await fetch(`${baseUrl}/cron/warm-discovery-index`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${cronSecret}` },
            })
            if (r.ok) {
              const body = await r.json() as { count?: number }
              discoveryCount = body.count ?? 0
            }
          } catch (err) {
            console.warn('[cron:warm] discovery rebuild fetch failed:', err)
          }
        }
      }

      // Step 1.5: precompute the homepage payload right after the discovery
      // index is fresh (the payload's rails are built from that index). Direct
      // in-process call — not a fetch — since we're already inside the cron
      // invocation. Non-forced so a transient cold index can't clobber a good
      // blob with a degraded one; rotation is the forced refresh.
      let homepageBytes = 0
      let homepageRails = 0
      try {
        const { warmHomepagePayloadA } = await import('../app/lib/homepage-payload.server.js')
        const p = await warmHomepagePayloadA({ force: false })
        homepageBytes = JSON.stringify(p).length
        homepageRails = p.rails.length
      } catch (err) {
        console.warn('[cron:warm] homepage payload warm failed:', err)
      }

      // Step 1.6: same for the storefront (variant B) blob — the one `/` serves
      // once HOME_VARIANT=b. Without this the storefront falls back to a full
      // live assembly, which reads the entire 2.7 MB discovery index.
      let storefrontBytes = 0
      let storefrontRails = 0
      try {
        const { warmHomepagePayloadB } = await import('../app/lib/storefront-home.server.js')
        const p = await warmHomepagePayloadB({ force: false })
        storefrontBytes = JSON.stringify(p).length
        storefrontRails = p.rails.length
      } catch (err) {
        console.warn('[cron:warm] storefront payload warm failed:', err)
      }

      // Step 2: resolve the current live deal handle from KV (the rotator
      // maintains KV_KEYS.liveDealHandle; deal_history has no handle column).
      let liveHandle: string | null = null
      try {
        const { kvGet, KV_KEYS } = await import('../app/lib/kv.server.js')
        liveHandle = (await kvGet<string>(KV_KEYS.liveDealHandle)) ?? null
      } catch (err) {
        console.warn('[cron:warm] could not resolve live deal handle:', err)
      }

      // Step 3: warm the CDN edge cache.
      const pagesWarmed: string[] = []
      if (baseUrl) {
        const targets = ['/', liveHandle ? `/products/${liveHandle}` : null].filter(Boolean) as string[]
        await Promise.allSettled(
          targets.map(async path => {
            const url = `${baseUrl}${path}`
            try {
              const r = await fetch(url, {
                headers: { 'Cache-Control': 'no-cache' },
              })
              // Drain the streamed body to completion. Dropping the response
              // after headers aborts the origin's SSR stream mid-render, and the
              // CDN can end up caching that truncated HTML — visitors (and the
              // homepage healthcheck) then get a page cut off before the
              // trailing JSON-LD blocks. Warming only counts when the full
              // document made it into the cache.
              await r.text()
              pagesWarmed.push(url)
            } catch (err) {
              console.warn(`[cron:warm] CDN warm failed for ${url}:`, err)
            }
          }),
        )
      }

      res.json({
        ok: true,
        discoveryProducts: discoveryCount,
        discoverySkipped,
        pagesWarmed,
        homepageBytes, homepageRails,
        storefrontBytes, storefrontRails,
      })
    } catch (err) {
      console.error('[cron:warm]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * GET|POST /cron/runpod-pod-watch
   * Schedule: hourly. RunPod GPU work runs two ways: Serverless (endpoint
   * 1cnxz75c71177q, scale-to-zero, billed per job, correct and not this route's
   * concern) and Pods (hourly-billed standalone machines used only for
   * one-time model bootstraps). A pod left running is a silent leak at
   * $0.74/hr; one ran 18.7h on 2026-08-22/23 for ~$14 before anyone noticed.
   * This lists RUNNING pods and files one deduped owner blocker if any exist,
   * naming every running pod, its hours-running, and its hourly rate. The
   * `runpod_no_pods` probe auto-clears the row on the next verify pass once
   * the pod is stopped. No LLM: one HTTPS call per hour.
   */
  cronRoute('/runpod-pod-watch', async (_req, res) => {
    try {
      const { listRunningRunpodPods } = await import('../app/lib/runpod-pods.server.js')
      const running = await listRunningRunpodPods()

      // Second surface (ticket #5717): re-probe recently completed video jobs
      // whose per-video idle confirmation is still open (the poster-stage
      // probe ran into an API hiccup, or the endpoint genuinely had not
      // scaled down yet), and escalate ONCE when the endpoint still has
      // active workers past the grace window. The pods list above cannot see
      // the serverless endpoint at all, so without this block a busy render
      // fleet reads as "all clear" here forever.
      let endpointEscalation: { staleJobs: number; activeWorkers: number } | null = null
      try {
        const IDLE_CONFIRM_GRACE_MS = 20 * 60 * 1000
        const { db } = await import('../app/lib/db.server.js')
        const { videoJobs } = await import('../db/schema.js')
        const { and, eq, isNull, isNotNull, lt } = await import('drizzle-orm')
        const { confirmRunpodIdle, jobUsedRunpod } = await import('../app/lib/video-pipeline.server.js')
        const stale = await db.select().from(videoJobs).where(and(
          eq(videoJobs.stage, 'done'),
          isNull(videoJobs.runpodIdleConfirmedAt),
          isNotNull(videoJobs.completedAt),
          lt(videoJobs.completedAt, new Date(Date.now() - IDLE_CONFIRM_GRACE_MS)),
        )).limit(20)
        let activeWorkers = 0
        let staleCount = 0
        for (const job of stale) {
          if (!jobUsedRunpod(job)) continue
          staleCount++
          const probe = await confirmRunpodIdle(job.id)
          if (!probe.clear && probe.endpoint && probe.endpoint.workers.active > 0) {
            activeWorkers = Math.max(activeWorkers, probe.endpoint.workers.active)
          }
        }
        if (activeWorkers > 0) {
          endpointEscalation = { staleJobs: staleCount, activeWorkers }
          const { fileBlocker: fileEndpointBlocker } = await import('../app/lib/owner-blockers.server.js')
          await fileEndpointBlocker({
            dedupeKey: 'runpod:endpoint-workers-up',
            title: `RunPod video endpoint still has ${activeWorkers} active worker(s) 20+ min after the last video finished`,
            detail: `${staleCount} completed video job(s) past the 20-minute grace window without an idle confirmation, and the endpoint health read shows ${activeWorkers} active worker(s). Idle Flex slots bill nothing and are not counted; active workers are billing.`,
            unblocks: 'Confirms the render GPU scaled to zero, so a finished video is not still billing.',
            whereToGo: 'RunPod console > Serverless > xdipx-video',
            category: 'console',
            priority: 2,
            source: 'sweep',
            sourceRef: 'cron:runpod-pod-watch',
            verifyProbe: 'runpod_endpoint_idle',
            verifyArg: '',
          })
          console.warn(`[cron:runpod-pod-watch] endpoint still active for ${staleCount} unconfirmed job(s), blocker filed`)
        }
      } catch (err) {
        // Never let the endpoint sweep break the pod sweep: the pod leak is
        // the historically expensive failure and must keep filing.
        console.warn('[cron:runpod-pod-watch] endpoint idle sweep failed:', err)
      }

      // Record out-of-band pod GPU spend into api_token_log (ticket #6320).
      // Pods on the management API are only ever created outside the video_jobs
      // pipeline (model bootstraps, S2V bake-offs driven against the RunPod REST
      // API), so nothing else writes their cost to the ledger: the Video tab and
      // /admin/usage read $0 for a day a stray or bake-off pod actually spent
      // money. We record the INCREMENT since the last sweep, watermarked per pod
      // in KV against the pod's cumulative uptime cost (rate * hoursRunning), so
      // re-seeing the same long-lived pod each hour never double-counts. This is
      // record-only, NOT gated (RUNPOD_POD_FEATURE is not a `video-` label). It
      // captures the historically expensive case well: the 18.7h pod that cost
      // ~$14 accruing hourly, and captures whatever an hourly sweep catches of
      // sub-hour rolls; a pod created and terminated between two sweeps reports
      // cost 0 once TERMINATED and is not seen here. Best-effort and fully
      // guarded: a recording failure must never stop the stray-pod blocker below.
      try {
        const { kvGet, kvSet } = await import('../app/lib/kv.server.js')
        const { logRunpodPodCost } = await import('../app/lib/token-log.server.js')
        for (const pod of running) {
          const cumulativeCents = Math.round(pod.costPerHour * pod.hoursRunning * 100)
          if (cumulativeCents <= 0) continue
          const wmKey = `runpod-pod:recorded-cents:${pod.id}`
          const recorded = Number(await kvGet<number>(wmKey)) || 0
          const deltaCents = cumulativeCents - recorded
          if (deltaCents <= 0) continue
          const gpuSeconds = pod.costPerHour > 0
            ? Math.round((deltaCents / 100) / pod.costPerHour * 3600)
            : 0
          await logRunpodPodCost({
            podId: pod.id,
            gpuSeconds,
            costUsd: deltaCents / 100,
            ...(pod.gpu ? { gpu: pod.gpu } : {}),
          })
          await kvSet(wmKey, cumulativeCents)
        }
      } catch (err) {
        console.warn('[cron:runpod-pod-watch] out-of-band pod-spend recording failed (ignored):', err)
      }

      if (running.length === 0) {
        res.json({ ok: true, running: 0, ...(endpointEscalation ? { endpointEscalation } : {}) })
        return
      }

      const { fileBlocker } = await import('../app/lib/owner-blockers.server.js')
      const worst = running.reduce((a, b) => (b.hoursRunning > a.hoursRunning ? b : a), running[0]!)
      const totalPerHour = running.reduce((sum, p) => sum + p.costPerHour, 0)

      await fileBlocker({
        dedupeKey: 'runpod:stray-pod',
        title: `RunPod pod ${worst.name} has been running ${worst.hoursRunning.toFixed(1)}h ($${worst.costPerHour.toFixed(2)}/hr): stop or terminate it`,
        detail: running
          .map(p => `${p.name} (${p.id}): ${p.hoursRunning.toFixed(1)}h running, $${p.costPerHour.toFixed(2)}/hr`)
          .join('\n'),
        unblocks: `Stops the $${totalPerHour.toFixed(2)}/hr leak across ${running.length} running pod${running.length === 1 ? '' : 's'}.`,
        whereToGo: 'RunPod console > Pods',
        category: 'console',
        priority: 1,
        source: 'sweep',
        sourceRef: 'cron:runpod-pod-watch',
        verifyProbe: 'runpod_no_pods',
        verifyArg: '',
      })

      console.warn(`[cron:runpod-pod-watch] ${running.length} pod(s) RUNNING, blocker filed`)
      res.json({ ok: true, running: running.length, pods: running })
    } catch (err) {
      console.error('[cron:runpod-pod-watch]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * GET|POST /cron/janitor-sweep
   * Schedule: every 6 hours (0 asterisk-slash-6).
   *
   * The reader for everything Stage C records. Three jobs today, and it is
   * deliberately the ONLY caller of `syncCronExpectations`: a manifest nothing
   * pushes into the database is a file, not an expectation, and a table nothing
   * writes to is not a record.
   *
   *   1. Push the code manifest into `cron_expectations` (upsert, never delete).
   *   2. Read liveness for every declared surface across BOTH scheduler planes
   *      and report the breaches. A route with no evidence of life is breached,
   *      not unknown: silence must never read as a pass, which is the whole
   *      lesson of the pricing batch dying at the 300s ceiling every morning for
   *      four days while the digest printed GOOD.
   *   3. Assert zero rows landed terminal with a NULL `finished_at`. That should
   *      be impossible by construction — one INSERT in a `finally` carries both
   *      timestamps — but the same class existed on `homepage_team_runs` (18
   *      `succeeded` runs with a NULL finish in one fortnight) precisely because
   *      nothing ever checked, and "should be impossible" is not a measurement.
   *
   * NOT YET, and named here so the gap is visible rather than assumed covered:
   * filing a ticket at the breached route's own lane (invariant 3 — a breach
   * files at that lane, never an email to the owner), the lane floors, and the
   * blocked-class routing. This pass reports; it does not yet act.
   */
  /**
   * The nightly logical dump (Stage G1).
   *
   * Neon point-in-time restore is the primary recovery path and needs no code,
   * but it rewinds the WHOLE database — including the 19 `public` tables that
   * belong to a dormant video-studio application sharing it — and cannot undo
   * one table without undoing every other write since. This is the surgical
   * alternative, and the only copy that survives the Neon account.
   *
   * It also carries the cheap half of G1, which is arguably the useful one: a
   * PITR only helps inside the retention window, so what actually decides
   * whether a mass-delete is recoverable is how fast anyone notices. Comparing
   * per-table row counts against the previous dump is how anyone notices.
   */
  cronRoute('/db-backup', async (_req, res) => {
    try {
      const { runBackup, detectRowDrift, previousDumpTables } =
        await import('../app/lib/db-backup.server.js')

      const result = await runBackup()

      // Drift is read from the two newest dumps, so a failed or partial run
      // simply produces no comparison rather than a spurious "everything
      // vanished" against a truncated snapshot.
      let drift: Array<{ table: string; previousRows: number; currentRows: number; delta: number }> = []
      if (result.status === 'succeeded') {
        const { db } = await import('../app/lib/db.server.js')
        const { backupRuns } = await import('../db/schema.js')
        const { desc } = await import('drizzle-orm')
        const [row] = await db.select({ id: backupRuns.id }).from(backupRuns).orderBy(desc(backupRuns.id)).limit(1)
        if (row) drift = detectRowDrift(await previousDumpTables(row.id), result.tables)
      }

      for (const d of drift) {
        console.warn(`[cron:db-backup] DRIFT ${d.table}: ${d.previousRows} -> ${d.currentRows} (${d.delta})`)
      }
      if (result.unclassified.length > 0) {
        // A migration that adds a table is merged unattended; nothing in that
        // path asks whether the new table needs backing up. So an unclassified
        // table is the normal outcome of the system working as designed, and
        // it has to be loud rather than assumed absent.
        console.warn(`[cron:db-backup] ${result.unclassified.length} live table(s) not in the backup manifest: ${result.unclassified.join(', ')}`)
      }
      if (result.status === 'failed' || result.status === 'partial') {
        console.error(`[cron:db-backup] ${result.status}: ${result.error}`)
      }

      // The status code, not the `ok` field, is what the wrapper reads.
      // `classifyCronOutcome` treats any 200 without a `skipped` string as
      // `succeeded`, so answering 200 here with `ok: false` would record a
      // failed backup as a healthy cron run — the exact "prints GOOD over a
      // dead pipeline" failure this whole program exists to remove,
      // reintroduced by the change meant to close it. A partial counts as a
      // failure for the same reason: it wrote no manifest and is unreadable.
      if (result.status === 'failed' || result.status === 'partial') res.status(500)
      res.json({
        ok: result.status === 'succeeded' || result.status === 'skipped',
        ...(result.status === 'skipped' ? { skipped: result.error } : {}),
        status: result.status,
        snapshotKey: result.snapshotKey,
        tables: result.tables.length,
        rows: result.tables.reduce((n, t) => n + t.rows, 0),
        bytes: result.totalBytes,
        elapsedMs: result.elapsedMs,
        unclassified: result.unclassified,
        drift,
        error: result.error,
      })
    } catch (err) {
      console.error('[cron:db-backup]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * Read the newest dump back and grade it.
   *
   * This is the half that makes the other half a backup. A dump nobody has read
   * back is a file, and the failure modes it hides are exactly the expensive
   * ones: a table that serialised to nothing, a gzip that never finished, a
   * private object the token can no longer read. Every one of those leaves a
   * `succeeded` dump row behind an unusable snapshot.
   *
   * Daily rather than weekly, because the gap between "the backup broke" and
   * "someone found out" is the whole quantity this stage is trying to shrink,
   * and reading 16 MB of blobs costs nothing worth saving.
   */
  cronRoute('/db-restore-probe', async (_req, res) => {
    try {
      const { runRestoreProbe } = await import('../app/lib/db-backup.server.js')
      const result = await runRestoreProbe()

      if (result.status === 'failed') {
        console.error(
          `[cron:db-restore-probe] ${result.error}`
          + result.verdicts.filter(v => !v.ok).map(v => `\n  ${v.table}: ${v.note ?? 'mismatch'}`).join(''),
        )
      }

      // Same reasoning as the dump above: a probe that found an unreadable
      // backup must not be recorded as a successful cron run.
      if (result.status === 'failed') res.status(500)
      res.json({
        ok: result.status === 'succeeded' || result.status === 'skipped',
        ...(result.status === 'skipped' ? { skipped: result.error } : {}),
        status: result.status,
        snapshotKey: result.snapshotKey,
        ageHours: result.ageHours == null ? null : Number(result.ageHours.toFixed(1)),
        stale: result.stale,
        checked: result.verdicts.length,
        failures: result.failures,
        failed: result.verdicts.filter(v => !v.ok).map(v => ({ table: v.table, note: v.note })),
        error: result.error,
      })
    } catch (err) {
      console.error('[cron:db-restore-probe]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  cronRoute('/janitor-sweep', async (_req, res) => {
    try {
      const {
        syncCronExpectations,
        readCronLiveness,
        countUnfinishedTerminalRuns,
        pruneCronRuns,
      } = await import('../app/lib/cron-runs.server.js')
      const { readUnwatchedLanes } = await import('../app/lib/ticket-janitor.server.js')

      const expectations = await syncCronExpectations()
      const liveness = await readCronLiveness()
      const breaches = liveness.filter(l => l.breached)
      const unfinished = await countUnfinishedTerminalRuns()
      const pruned = await pruneCronRuns()
      // The inverse of the liveness check above, and it catches what that one
      // structurally cannot. A routine created after ROUTINE_CADENCES was last
      // curated is not late, it is absent, and absence from a hand-maintained
      // list looks exactly like health. On its first run this found the entire
      // video program — the most expensive lane in the estate — running with no
      // liveness entry at all, six days after both its triggers were created.
      // Wrapped for the same reason the credential sweep below is: this is the
      // only awaited call in the handler that had no guard of its own, so a
      // `homepage_team_runs` blip 500ed the whole sweep — which `cronRoute`
      // then recorded as the JANITOR failing and suppressed its heartbeat. The
      // watcher could take itself down, silently, on someone else's outage.
      let unwatched: Awaited<ReturnType<typeof readUnwatchedLanes>> = []
      try {
        unwatched = await readUnwatchedLanes()
      } catch (err) {
        console.error('[cron:janitor-sweep] unwatched-lane read failed (ignored):', err)
      }

      // Credential liveness. Nothing in this estate has ever probed whether the
      // store's own Shopify, Klaviyo, Instagram, X, GitHub, Vercel, Twilio or
      // RunPod credentials still work — the `webhook_registered` probe has
      // existed since it was built and no blocker row has ever used it. The
      // cost of that gap is not hypothetical: an expired IG token reads as a
      // takedown to the removal watcher, which then halves posting volume.
      //
      // Wrapped so a third-party API having a bad day can never fail the sweep
      // that reads cron liveness.
      let credentials: Awaited<ReturnType<typeof import('../app/lib/credential-health.server.js')['checkAllCredentials']>> = []
      let credentialBlockers: string[] = []
      try {
        const { checkAllCredentials, fileCredentialBlockers } =
          await import('../app/lib/credential-health.server.js')
        credentials = await checkAllCredentials()
        credentialBlockers = await fileCredentialBlockers(credentials)
      } catch (err) {
        console.error('[cron:janitor-sweep] credential sweep failed (ignored):', err)
      }
      for (const c of credentials) {
        if (c.state === 'dead') console.error(`[cron:janitor-sweep] CREDENTIAL DEAD ${c.key}: ${c.detail}`)
        else if (c.state === 'unconfigured') console.warn(`[cron:janitor-sweep] credential unconfigured ${c.key}: ${c.detail}`)
        else if (c.state === 'unknown') console.warn(`[cron:janitor-sweep] credential could-not-ask ${c.key}: ${c.detail}`)
      }

      // The actuator. Until this shipped, everything above was measured every
      // six hours and written to console.warn — a log stream whose only reader
      // Stage G3 deleted. `readCronLiveness` had one caller and no consumer,
      // which is why both of the owner's own delivery crons could return HTTP
      // 500 for two days with this sweep running four times in between.
      //
      // Closing runs before filing, inside the module: a condition that cleared
      // must release its dedupe key before anything tries to file against it.
      // Lane output floors: liveness answers "did it run", this answers "did it
      // produce". A lane can be perfectly alive and shipping nothing, which is
      // the state every dead lane in the estate was in while reading green.
      let floors: Awaited<ReturnType<typeof import('../app/lib/lane-floors.server.js')['checkLaneFloors']>> = []
      try {
        const { checkLaneFloors } = await import('../app/lib/lane-floors.server.js')
        floors = await checkLaneFloors()
      } catch (err) {
        console.error('[cron:janitor-sweep] lane floor check failed (ignored):', err)
      }

      let alarms: {
        filed: string[]; closed: number[]; escalated: string[]; unreadable: string[]
      } = { filed: [], closed: [], escalated: [], unreadable: [] }
      try {
        const { reconcileCronAlarms } = await import('../app/lib/cron-liveness-tickets.server.js')
        alarms = await reconcileCronAlarms(liveness, unwatched, floors)
      } catch (err) {
        console.error('[cron:janitor-sweep] alarm reconcile failed (ignored):', err)
      }

      for (const v of floors.filter(f => f.breached === true)) {
        console.warn(`[cron:janitor-sweep] FLOOR ${v.lane} -> ${v.team}: ${v.detail}`)
      }

      const failing = liveness.filter(l => l.failing)
      for (const b of breaches) {
        console.warn(
          `[cron:janitor-sweep] BREACH ${b.route} (${b.plane}): `
          + (b.lastSeenAt ? `last seen ${b.lastSeenAt.toISOString()}` : 'never seen')
          + `, floor ${b.periodMinutes}+${b.graceMinutes} min`
          + (b.moneyRelevant ? ' [money]' : '')
          + (b.ownerTeam ? ` -> ${b.ownerTeam}` : ''),
        )
      }
      for (const f of failing) {
        console.error(
          `[cron:janitor-sweep] FAILING ${f.route}: ${f.consecutiveFailures} consecutive failed run(s), `
          + `last ${f.lastSeenAt ? f.lastSeenAt.toISOString() : 'never'}: ${(f.lastError ?? '').slice(0, 200)}`,
        )
      }
      if (unfinished > 0) {
        console.error(`[cron:janitor-sweep] ${unfinished} cron_runs row(s) terminal with a NULL finished_at`)
      }
      for (const u of unwatched) {
        console.warn(
          `[cron:janitor-sweep] UNWATCHED LANE ${u.team}/${u.runType}: `
          + `${u.runs} run(s) in 30d, last ${u.lastRunAt ?? 'never'}, no ROUTINE_CADENCES entry`,
        )
      }
      for (const r of alarms.unreadable) {
        console.error(
          `[cron:janitor-sweep] UNREADABLE ${r}: no row, no heartbeat and no external reader. `
          + 'Not ticketed on purpose — this is a manifest bug, not a route fault.',
        )
      }

      res.json({
        ok: true,
        expectations,
        checked: liveness.length,
        breaches: breaches.map(b => ({
          route: b.route,
          plane: b.plane,
          ageMinutes: b.ageMinutes,
          source: b.source,
          moneyRelevant: b.moneyRelevant,
          ownerTeam: b.ownerTeam,
          lastStatus: b.lastStatus,
        })),
        unfinishedTerminalRuns: unfinished,
        unwatchedLanes: unwatched,
        laneFloors: floors.map(v => ({
          lane: v.lane, team: v.team, kind: v.kind, threshold: v.threshold,
          measured: v.measured, breached: v.breached, detail: v.detail,
        })),
        // Alive and broken, the fault `breaches` structurally cannot see.
        failing: failing.map(f => ({
          route: f.route,
          consecutiveFailures: f.consecutiveFailures,
          lastStatus: f.lastStatus,
          lastError: f.lastError,
          moneyRelevant: f.moneyRelevant,
          ownerTeam: f.ownerTeam,
        })),
        // Counted here rather than inferred from fileDetectionTicket's return
        // value, which is 0 both for a dedupe hit and for a thrown error.
        alarms: {
          filed: alarms.filed.length,
          closed: alarms.closed.length,
          escalated: alarms.escalated.length,
          unreadable: alarms.unreadable,
          closedIds: alarms.closed,
        },
        credentials: credentials.map(c => ({ key: c.key, state: c.state, detail: c.detail })),
        credentialBlockers,
        pruned,
      })
    } catch (err) {
      console.error('[cron:janitor-sweep]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  return router
}
