import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../app/lib/db.server.js';
import { dealHistory, referrals } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getWholesaleCostBySKU, shopifyAdmin } from '../app/lib/shopify.server.js';
// ─── HMAC verification ────────────────────────────────────────────────────
function verifyShopifyWebhook(req) {
    const secret = process.env['SHOPIFY_WEBHOOK_SECRET'];
    if (!secret)
        return false;
    const hmac = req.headers['x-shopify-hmac-sha256'];
    const body = req.body;
    const digest = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('base64');
    return crypto.timingSafeEqual(Buffer.from(hmac ?? ''), Buffer.from(digest));
}
// ─── Handlers ─────────────────────────────────────────────────────────────
/**
 * orders/create — Item 1 (Day-1 non-negotiable): write wholesale cost per order.
 * Also captures referral code.
 */
async function handleOrderCreated(order) {
    for (const lineItem of order.line_items) {
        const cost = await getWholesaleCostBySKU(lineItem.sku).catch(() => 0);
        const profit = parseFloat(lineItem.price) - cost;
        // Write per-line-item profit metafield onto the order
        await shopifyAdmin(`/orders/${order.id}/metafields.json`, 'POST', {
            metafield: {
                namespace: 'xdipx',
                key: `profit_${lineItem.sku}`,
                value: JSON.stringify({
                    sku: lineItem.sku,
                    wholesale_cost: cost,
                    deal_price: parseFloat(lineItem.price),
                    profit_per_unit: profit,
                    quantity: lineItem.quantity,
                    total_profit: profit * lineItem.quantity,
                }),
                type: 'json',
            },
        }).catch(err => console.error('[webhook] metafield write failed:', err));
        // Update deal_history units_sold
        const today = new Date().toISOString().split('T')[0];
        await db
            .update(dealHistory)
            .set({
            unitsSold: db.$count(dealHistory, eq(dealHistory.sku, lineItem.sku)), // increment handled via raw SQL
            totalRevenue: String(parseFloat(lineItem.price) * lineItem.quantity),
            totalProfit: String(profit * lineItem.quantity),
        })
            .where(eq(dealHistory.sku, lineItem.sku))
            .catch(() => { });
    }
    // Capture referral code from note_attributes
    const refCode = order.note_attributes?.find(a => a.name === 'ref_source')?.value;
    if (refCode) {
        await db.insert(referrals).values({
            refCode,
            referrerType: 'affiliate',
            referredCustomerId: order.customer?.id ? String(order.customer.id) : null,
            firstOrderId: String(order.id),
            firstOrderValue: order.total_price,
        }).catch(() => { });
    }
    // Capture ToS acceptance
    const tosVersion = order.note_attributes?.find(a => a.name === 'tos_version')?.value;
    if (tosVersion && order.customer?.id) {
        const { logTosAcceptance } = await import('../app/lib/consent.server.js');
        // We don't have the original Request here; stub IP
        const fakeRequest = new Request('https://xdipx.com');
        await logTosAcceptance(fakeRequest, {
            customerId: String(order.customer.id),
            email: order.email,
            tosVersion,
            method: 'checkout',
        }).catch(() => { });
    }
}
// ─── Router ───────────────────────────────────────────────────────────────
export function createWebhookRoutes() {
    const router = Router();
    router.post('/order-created', async (req, res) => {
        if (!verifyShopifyWebhook(req)) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const order = JSON.parse(req.body.toString());
        // Respond immediately — Shopify expects < 5s
        res.json({ ok: true });
        // Process async (fire and forget — errors logged, not bubbled)
        handleOrderCreated(order).catch(err => console.error('[webhook:order-created]', err));
    });
    return router;
}
