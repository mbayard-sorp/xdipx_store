import { Router, type Request, type Response, type NextFunction } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { handlePricingBatchRecompute } from './cron.pricing-batch-recompute.js'

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
    const { metaCapiFailures } = await import('../db/schema.js')
    const { sendCapiEvent } = await import('../app/lib/meta-capi.server.js')
    const { and, eq, isNull, lt } = await import('drizzle-orm')

    const rows = await db.select().from(metaCapiFailures)
      .where(and(isNull(metaCapiFailures.resolvedAt), lt(metaCapiFailures.attempts, MAX_ATTEMPTS)))
      .limit(100)

    let resolved = 0
    for (const row of rows) {
      // PII-free path matches the original webhook send.
      const result = await sendCapiEvent(row.payload as Parameters<typeof sendCapiEvent>[0], { consentGranted: false })
      if (result.ok) {
        await db.update(metaCapiFailures)
          .set({ resolvedAt: new Date(), attempts: row.attempts + 1 })
          .where(eq(metaCapiFailures.id, row.id))
        resolved++
      } else {
        await db.update(metaCapiFailures)
          .set({ attempts: row.attempts + 1, lastError: result.error ?? 'unknown' })
          .where(eq(metaCapiFailures.id, row.id))
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
    const { ga4PurchaseFailures } = await import('../db/schema.js')
    const { sendGa4Purchase } = await import('../app/lib/ga4-mp.server.js')
    const { and, eq, isNull, lt } = await import('drizzle-orm')

    const rows = await db.select().from(ga4PurchaseFailures)
      .where(and(isNull(ga4PurchaseFailures.resolvedAt), lt(ga4PurchaseFailures.attempts, MAX_ATTEMPTS)))
      .limit(100)

    let resolved = 0
    for (const row of rows) {
      const result = await sendGa4Purchase(row.payload as Parameters<typeof sendGa4Purchase>[0])
      if (result.ok) {
        await db.update(ga4PurchaseFailures)
          .set({ resolvedAt: new Date(), attempts: row.attempts + 1 })
          .where(eq(ga4PurchaseFailures.id, row.id))
        resolved++
      } else {
        await db.update(ga4PurchaseFailures)
          .set({ attempts: row.attempts + 1, lastError: result.error ?? result.skipped ?? 'unknown' })
          .where(eq(ga4PurchaseFailures.id, row.id))
      }
    }
    return resolved
  } catch (err) {
    console.error('[cron:profit-summary] GA4 drain error:', err)
    return 0
  }
}

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

  // Registers a scheduled cron endpoint on both GET (Vercel native cron) and POST
  // (GitHub fallback / manual / internal). POST-only internal routes keep router.post.
  const cronRoute = (
    path: string,
    handler: (req: Request, res: Response) => void | Promise<void>,
  ) => router.route(path).get(guard, handler).post(guard, handler)

  /**
   * POST /cron/daily-feed-processor
   * Schedule: 11:45 PM — fetch Nalpac feed, score products, stage top candidates
   */
  cronRoute('/daily-feed-processor', async (_req, res) => {
    try {
      const { dailyFeedProcessor } = await import('../app/lib/feed-processor.server.js')
      const result = await dailyFeedProcessor()
      res.json({ ok: true, topCandidates: result.topCandidates.length, needsImagen: result.needsImagen.length })
    } catch (err) {
      console.error('[cron:daily-feed-processor]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * POST /cron/deal-activator
   * Schedule: 11:59 PM — archive today's deal, activate tomorrow's, trigger Klaviyo
   */
  cronRoute('/deal-activator', async (_req, res) => {
    try {
      const { rotateDeal } = await import('../app/lib/deal-rotator.server.js')
      const result = await rotateDeal()
      res.json({ ok: true, ...result })
    } catch (err) {
      console.error('[cron:deal-activator]', err)
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
      // Non-2xx on failure so Vercel cron + monitoring surface it (recovery,
      // if any, already happened inside runHomepageHealthcheck).
      res.status(result.ok ? 200 : 503).json(result)
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
    try {
      const { writeProfitSummary } = await import('../app/lib/profit.server.js')
      await writeProfitSummary()
      const capiRetried = await drainMetaCapiFailures()
      const ga4Retried = await drainGa4Failures()
      res.json({ ok: true, capiRetried, ga4Retried })
    } catch (err) {
      console.error('[cron:profit-summary]', err)
      res.status(500).json({ error: String(err) })
    }
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
  router.post('/regenerate-emma-rail', guard, async (req, res) => {
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
  cronRoute('/log-monitor', async (req, res) => {
    try {
      const { runLogMonitor } = await import('../app/lib/log-monitor.server.js')
      const rawWindow = req.body?.windowMinutes ?? (req.query['windowMinutes'] ? Number(req.query['windowMinutes']) : undefined)
      const windowMinutes = typeof rawWindow === 'number' && !isNaN(rawWindow) ? rawWindow : 15
      const result = await runLogMonitor({ windowMinutes })
      res.json({ ok: true, ...result })
    } catch (err) {
      console.error('[cron:log-monitor]', err)
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

  /**
   * POST /cron/import-monitor
   * Schedule: 08:00 UTC daily — diff 4 Nalpac feeds against carried-SKU set,
   * tier + score + price-preview candidates, upsert import_candidates.
   * Gated by import_monitor_enabled kill-switch and import_monitor_run_days CSV.
   */
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
    const acquired = await kvSetNX('lock:enrichment-poller', String(Date.now()), 110)
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
   * cost nothing here. Same idle-flag + lock discipline as the enrichment
   * poller above.
   */
  cronRoute('/video-job-poller', async (_req, res) => {
    const { kvGet, kvSetNX, kvDel, KV_KEYS } = await import('../app/lib/kv.server.js')
    const idle = await kvGet(KV_KEYS.videoPollerIdle)
    if (idle != null) {
      res.json({ ok: true, skipped: 'idle' })
      return
    }
    const acquired = await kvSetNX('lock:video-poller', String(Date.now()), 110)
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

  /**
   * POST /cron/inventory-check
   * Schedule: every 5 min — check if live deal is sold out, rotate if so
   */
  cronRoute('/inventory-check', async (_req, res) => {
    try {
      const { isLiveDealSoldOut, rotateDeal } = await import('../app/lib/deal-rotator.server.js')
      const { soldOut } = await isLiveDealSoldOut()

      if (soldOut) {
        console.log('[cron:inventory-check] Live deal sold out — rotating')
        const result = await rotateDeal()
        res.json({ ok: true, rotated: true, ...result })
      } else {
        res.json({ ok: true, rotated: false })
      }
    } catch (err) {
      console.error('[cron:inventory-check]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * POST /cron/warm-discovery-index
   * Called by triggerDiscoveryRebuild() (fire-and-forget from SSR on cold KV miss)
   * and by /cron/warm. Builds the full discovery index and vocab, writes to KV.
   */
  router.post('/warm-discovery-index', guard, async (_req, res) => {
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

      // Step 1: trigger the discovery index rebuild (reuses the dedicated handler).
      let discoveryCount = 0
      if (baseUrl && cronSecret) {
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
        pagesWarmed,
        homepageBytes, homepageRails,
        storefrontBytes, storefrontRails,
      })
    } catch (err) {
      console.error('[cron:warm]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  return router
}
