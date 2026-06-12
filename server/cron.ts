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
   * POST /cron/profit-summary
   * Schedule: 12:05 AM — write daily profit summary to Neon
   */
  cronRoute('/profit-summary', async (_req, res) => {
    try {
      const { writeProfitSummary } = await import('../app/lib/profit.server.js')
      await writeProfitSummary()
      const capiRetried = await drainMetaCapiFailures()
      res.json({ ok: true, capiRetried })
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
  cronRoute('/keyword-research', async (req, res) => {
    try {
      const { runKeywordResearch } = await import('../app/lib/seo-research.server.js')
      const opts: { maxSeeds?: number; manualSeeds?: string[] } = {}
      const rawMaxSeeds = req.body?.maxSeeds ?? (req.query['maxSeeds'] ? Number(req.query['maxSeeds']) : undefined)
      if (typeof rawMaxSeeds === 'number' && !isNaN(rawMaxSeeds)) opts.maxSeeds = rawMaxSeeds
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
    const acquired = await kvSetNX('lock:import-enrich', String(Date.now()), 110)
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
   * POST /cron/enrichment-batch-poller
   * Schedule: every 2 minutes. Advances every in-flight batch_job by one pass
   * (retrieve current turn's batch; if ended, distribute + run tools + submit
   * next turn or apply). Bounded work per invocation to fit the 60s budget.
   */
  cronRoute('/enrichment-batch-poller', async (_req, res) => {
    const { kvSetNX, kvDel } = await import('../app/lib/kv.server.js')
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
        INDEX_KEY,
        INDEX_TTL_SECONDS,
        VOCAB_KEY,
        VOCAB_TTL_SECONDS,
      } = await import('../app/lib/discovery.server.js')
      const { kvSet } = await import('../app/lib/kv.server.js')

      const fresh = await buildDiscoveryIndex()

      if (fresh.length > 0) {
        const vocab = computeVocab(fresh)
        await kvSet(INDEX_KEY, fresh, INDEX_TTL_SECONDS)
        await kvSet(VOCAB_KEY, vocab, VOCAB_TTL_SECONDS)
        console.log(`[cron:warm-discovery-index] wrote ${fresh.length} products to KV`)
      }

      res.json({ ok: true, count: fresh.length })
    } catch (err) {
      console.error('[cron:warm-discovery-index]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  /**
   * POST /cron/warm
   * Schedule: every 15 min (added to the inventory-check + log-monitor bucket).
   * (1) Rebuilds the discovery index via the warm-discovery-index handler.
   * (2) Reads the current live deal handle from deal_history.
   * (3) Fires GET requests to / and /products/{handle} with no-cache headers
   *     to prime the Vercel CDN SWR cache before Googlebot's next crawl window.
   */
  router.post('/warm', guard, async (_req, res) => {
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
              await fetch(url, {
                headers: { 'Cache-Control': 'no-cache' },
              })
              pagesWarmed.push(url)
            } catch (err) {
              console.warn(`[cron:warm] CDN warm failed for ${url}:`, err)
            }
          }),
        )
      }

      res.json({ ok: true, discoveryProducts: discoveryCount, pagesWarmed })
    } catch (err) {
      console.error('[cron:warm]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  return router
}
