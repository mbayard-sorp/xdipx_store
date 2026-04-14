import { Router, type Request, type Response, type NextFunction } from 'express'
import { timingSafeEqual } from 'node:crypto'

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
