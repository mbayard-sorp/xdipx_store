// Pricing batch recompute cron handler.
// Registered in server/cron.ts as POST /cron/pricing-batch-recompute.
// Schedule: 0 7 * * * UTC (02:00 ET / 03:00 EDT).
// See vercel.json for the registered schedule.

import type { Request, Response } from 'express'

export async function handlePricingBatchRecompute(_req: Request, res: Response): Promise<void> {
  try {
    const { recomputeCatalog } = await import('../app/lib/pricing-apply-v2.server.js')
    const result = await recomputeCatalog({ trigger: 'batch' })
    res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron:pricing-batch-recompute]', err)
    res.status(500).json({ error: String(err) })
  }
}
