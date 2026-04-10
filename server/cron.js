import { Router } from 'express';
import { dailyFeedProcessor } from '../app/lib/feed-processor.server.js';
import { dealActivator } from '../app/lib/deal-activator.server.js';
import { writeProfitSummary } from '../app/lib/profit.server.js';
import { getPendingReminderInvites, markReminderSent, getReviewSettings } from '../app/lib/reviews.server.js';
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
            const result = await dailyFeedProcessor();
            res.json({ ok: true, topCandidates: result.topCandidates.length, needsImagen: result.needsImagen.length });
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
    /**
     * POST /cron/review-reminders
     * Schedule: 9:00 AM daily — send reminder emails for pending invites
     */
    router.post('/review-reminders', guard, async (_req, res) => {
        try {
            const settings = await getReviewSettings();
            if (!settings.remindersEnabled) {
                res.json({ ok: true, skipped: true, reason: 'reminders disabled' });
                return;
            }
            const invites = await getPendingReminderInvites();
            let sent = 0;
            for (const invite of invites) {
                try {
                    const { trackEvent } = await import('../app/lib/klaviyo.server.js');
                    await trackEvent(invite.reviewerEmail, 'Review Reminder Sent', {
                        orderId: invite.shopifyOrderId,
                        productId: invite.shopifyProductId,
                        inviteToken: invite.inviteToken,
                        reviewerName: invite.reviewerName,
                        reminderDate: new Date().toISOString(),
                    });
                    await markReminderSent(invite.id);
                    sent++;
                }
                catch (err) {
                    console.error('[cron:review-reminders] Failed for invite', invite.id, err);
                }
            }
            res.json({ ok: true, total: invites.length, sent });
        }
        catch (err) {
            console.error('[cron:review-reminders]', err);
            res.status(500).json({ error: String(err) });
        }
    });
    /**
     * POST /cron/inventory-check
     * Schedule: every 5 min — check if live deal is sold out, rotate if so
     */
    router.post('/inventory-check', guard, async (_req, res) => {
        try {
            const { isLiveDealSoldOut, rotateDeal } = await import('../app/lib/deal-rotator.server.js');
            const { soldOut } = await isLiveDealSoldOut();
            if (soldOut) {
                console.log('[cron:inventory-check] Live deal sold out — rotating');
                const result = await rotateDeal();
                res.json({ ok: true, rotated: true, ...result });
            }
            else {
                res.json({ ok: true, rotated: false });
            }
        }
        catch (err) {
            console.error('[cron:inventory-check]', err);
            res.status(500).json({ error: String(err) });
        }
    });
    return router;
}
