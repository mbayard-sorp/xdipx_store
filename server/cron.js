import { Router } from 'express';
import { dailyFeedProcessor } from '../app/lib/feed-processor.server.js';
import { dealActivator } from '../app/lib/deal-activator.server.js';
import { writeProfitSummary } from '../app/lib/profit.server.js';
import { orchestrateDealPipeline } from '../app/lib/deal-pipeline.server.js';
export function createCronRoutes() {
    const router = Router();
    // Guard — all cron routes require x-cron-secret header
    const guard = (req, res, next) => {
        const secret = req.headers['x-cron-secret'];
        if (!process.env['CRON_SECRET'] || secret !== process.env['CRON_SECRET']) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        next();
    };
    /**
     * POST /cron/daily-feed-processor
     * Schedule: 11:45 PM — fetch Nalpac feed, score products, stage top candidates
     */
    router.post('/daily-feed-processor', guard, async (_req, res) => {
        try {
            const feedResult = await dailyFeedProcessor();
            // Fire-and-forget: stage next deal — errors are logged but don't fail the cron
            const pipelineResult = await orchestrateDealPipeline();
            console.log('[cron:deal-pipeline]', pipelineResult);
            res.json({
                ok: true,
                topCandidates: feedResult.topCandidates.length,
                needsImagen: feedResult.needsImagen.length,
                pipeline: pipelineResult,
            });
        }
        catch (err) {
            console.error('[cron:daily-feed-processor]', err);
            res.status(500).json({ error: String(err) });
        }
    });
    /**
     * POST /cron/deal-activator
     * Schedule: 11:59 PM — archive today's deal, activate tomorrow's, trigger Klaviyo
     */
    router.post('/deal-activator', guard, async (_req, res) => {
        try {
            const result = await dealActivator();
            res.json({ ok: true, ...result });
        }
        catch (err) {
            console.error('[cron:deal-activator]', err);
            res.status(500).json({ error: String(err) });
        }
    });
    /**
     * POST /cron/profit-summary
     * Schedule: 12:05 AM — write daily profit summary to Neon
     */
    router.post('/profit-summary', guard, async (_req, res) => {
        try {
            await writeProfitSummary();
            res.json({ ok: true });
        }
        catch (err) {
            console.error('[cron:profit-summary]', err);
            res.status(500).json({ error: String(err) });
        }
    });
    return router;
}
