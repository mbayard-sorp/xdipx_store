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
async function handleOrderFulfilled(order) {
    if (!order.email || order.line_items.length === 0)
        return;
    const { getReviewSettings, createInvite } = await import('../app/lib/reviews.server.js');
    const settings = await getReviewSettings();
    const delayMs = settings.inviteDelayDays * 24 * 60 * 60 * 1000;
    setTimeout(async () => {
        for (const lineItem of order.line_items) {
            if (!lineItem.sku)
                continue;
            const searchRes = await shopifyAdmin(`/products.json?limit=1&sku=${encodeURIComponent(lineItem.sku)}`, 'GET').catch(() => null);
            const productId = searchRes?.products?.[0]?.id;
            if (!productId)
                continue;
            const shopifyProductId = `gid://shopify/Product/${productId}`;
            const reviewerName = [
                order.customer?.first_name,
                order.customer?.last_name,
            ].filter(Boolean).join(' ') || 'Customer';
            await createInvite({
                shopifyOrderId: String(order.id),
                shopifyCustomerId: order.customer?.id ? String(order.customer.id) : undefined,
                shopifyProductId,
                reviewerEmail: order.email,
                reviewerName,
            }).catch(err => console.error('[webhook:invite-create]', err));
            const { trackEvent } = await import('../app/lib/klaviyo.server.js');
            await trackEvent(order.email, 'Review Invite Sent', {
                orderId: order.id,
                productId: shopifyProductId,
                productName: lineItem.title,
                inviteDate: new Date().toISOString(),
            }).catch(() => { });
        }
    }, delayMs);
}
async function handleProductCreated(product) {
    const { upsertProductPage } = await import('../app/lib/sanity.server.js');
    const gid = `gid://shopify/Product/${product.id}`;
    const result = await upsertProductPage({
        handle: product.handle,
        shopifyProductId: gid,
        title: product.title,
        imageUrl: product.images?.[0]?.src,
    });
    console.log(`[webhook:product-created] ${product.handle} → ${result.created ? 'created in Sanity' : 'already exists'}`);
}
async function handleInventoryUpdate(level) {
    // Only care if available hit zero
    if (level.available > 0)
        return;
    const { isLiveDealSoldOut, rotateDeal } = await import('../app/lib/deal-rotator.server.js');
    const { soldOut } = await isLiveDealSoldOut();
    if (soldOut) {
        console.log('[webhook:inventory-update] Live deal sold out — rotating to next deal');
        const result = await rotateDeal();
        console.log('[webhook:inventory-update] Rotation result:', result);
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
    router.post('/order-fulfilled', async (req, res) => {
        if (!verifyShopifyWebhook(req)) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const order = JSON.parse(req.body.toString());
        res.json({ ok: true });
        handleOrderFulfilled(order).catch(err => console.error('[webhook:order-fulfilled]', err));
    });
    router.post('/product-created', async (req, res) => {
        if (!verifyShopifyWebhook(req)) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const product = JSON.parse(req.body.toString());
        res.json({ ok: true });
        handleProductCreated(product).catch(err => console.error('[webhook:product-created]', err));
    });
    router.post('/inventory-update', async (req, res) => {
        if (!verifyShopifyWebhook(req)) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const level = JSON.parse(req.body.toString());
        res.json({ ok: true });
        handleInventoryUpdate(level).catch(err => console.error('[webhook:inventory-update]', err));
    });
    return router;
}
