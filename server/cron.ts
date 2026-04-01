import { Router, type Request, type Response, type NextFunction } from 'express'
import { dailyFeedProcessor } from '../app/lib/feed-processor.server.js'
import { dealActivator }       from '../app/lib/deal-activator.server.js'
import { writeProfitSummary }  from '../app/lib/profit.server.js'

export function createCronRoutes() {
  const router = Router()

  // Guard — all cron routes require x-cron-secret header
  const guard = (req: Request, res: Response, next: NextFunction) => {
    const secret = req.headers['x-cron-secret']
    if (!process.env['CRON_SECRET'] || secret !== process.env['CRON_SECRET']) {
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
      await writeProfitSummary()
      res.json({ ok: true })
    } catch (err) {
      console.error('[cron:profit-summary]', err)
      res.status(500).json({ error: String(err) })
    }
  })

  return router
}
