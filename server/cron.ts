import { Router, type Request, type Response, type NextFunction } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { handlePricingBatchRecompute } from './cron.pricing-batch-recompute.js'

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
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

  /**
   * POST /cron/daily-feed-processor
   * Schedule: 11:45 PM — fetch Nalpac feed, score products, stage top candidates
   */
  router.post('/daily-feed-processor', guard, async (_req, res) => {
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
  router.post('/deal-activator', guard, async (_req, res) => {
    try {
      const { dealActivator } = await import('../app/lib/deal-activator.server.js')
      const result = await dealActivator()
      res.json({ ok: true, ...result })
    } catch (err) {
      console.error('[cron:deal-activator]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * POST /cron/profit-summary
   * Schedule: 12:05 AM — write daily profit summary to Neon
   */
  router.post('/profit-summary', guard, async (_req, res) => {
    try {
      const { writeProfitSummary } = await import('../app/lib/profit.server.js')
      await writeProfitSummary()
      res.json({ ok: true })
    } catch (err) {
      console.error('[cron:profit-summary]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * POST /cron/review-reminders
   * Schedule: 9:00 AM daily — send reminder emails for pending invites
   */
  router.post('/review-reminders', guard, async (_req, res) => {
    try {
      const { getReviewSettings, getPendingReminderInvites, markReminderSent } = await import('../app/lib/reviews.server.js')
      const settings = await getReviewSettings()
      if (!settings.remindersEnabled) {
        res.json({ ok: true, skipped: true, reason: 'reminders disabled' })
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

      res.json({ ok: true, total: invites.length, sent })
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
   * POST /cron/keyword-research
   * Schedule: weekly Sunday 02:00 UTC — discover new SEO keywords via
   * DataForSEO + LLM clusterer, write to Sanity as pending or approved.
   * Also callable on-demand by admin (with the cron secret).
   * Body (optional): { manualSeeds?: string[], maxSeeds?: number }
   */
  router.post('/keyword-research', guard, async (req, res) => {
    try {
      const { runKeywordResearch } = await import('../app/lib/seo-research.server.js')
      const opts: { maxSeeds?: number; manualSeeds?: string[] } = {}
      if (typeof req.body?.maxSeeds === 'number') opts.maxSeeds = req.body.maxSeeds
      if (Array.isArray(req.body?.manualSeeds)) {
        opts.manualSeeds = (req.body.manualSeeds as unknown[]).filter((s): s is string => typeof s === 'string')
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
  router.post('/log-monitor', guard, async (req, res) => {
    try {
      const { runLogMonitor } = await import('../app/lib/log-monitor.server.js')
      const windowMinutes = typeof req.body?.windowMinutes === 'number' ? req.body.windowMinutes : 15
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
  router.post('/pricing-batch-recompute', guard, handlePricingBatchRecompute)

  /**
   * POST /cron/import-monitor
   * Schedule: 08:00 UTC daily — diff 4 Nalpac feeds against carried-SKU set,
   * tier + score + price-preview candidates, upsert import_candidates.
   * Gated by import_monitor_enabled kill-switch and import_monitor_run_days CSV.
   */
  router.post('/import-monitor', guard, async (_req, res) => {
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
  router.post('/import-enrich', guard, async (_req, res) => {
    try {
      const { runImportEnrichTick } = await import('../app/lib/import-enrich.server.js')
      const result = await runImportEnrichTick({ source: 'cron' })
      res.json(result)
    } catch (err) {
      console.error('[cron:import-enrich]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * POST /cron/inventory-check
   * Schedule: every 5 min — check if live deal is sold out, rotate if so
   */
  router.post('/inventory-check', guard, async (_req, res) => {
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

  return router
}
