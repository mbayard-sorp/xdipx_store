import { Router, type Request, type Response } from 'express'
import crypto from 'node:crypto'
import { db } from '../app/lib/db.server.js'
import { dealHistory, referrals } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { getWholesaleCostBySKU, shopifyAdmin } from '../app/lib/shopify.server.js'

// ─── HMAC verification ────────────────────────────────────────────────────

function verifyShopifyWebhook(req: Request): boolean {
  const secret = process.env['SHOPIFY_WEBHOOK_SECRET']
  if (!secret) return false
  const hmac      = req.headers['x-shopify-hmac-sha256'] as string
  const body      = req.body as Buffer
  const digest    = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64')
  return crypto.timingSafeEqual(Buffer.from(hmac ?? ''), Buffer.from(digest))
}

// ─── Order payload types ──────────────────────────────────────────────────

interface ShopifyLineItem {
  id: number
  sku: string
  title: string
  quantity: number
  price: string
}

interface ShopifyNoteAttribute { name: string; value: string }

interface ShopifyOrder {
  id: number
  order_number: number
  email: string
  total_price: string
  line_items: ShopifyLineItem[]
  note_attributes?: ShopifyNoteAttribute[]
  customer?: { id: number }
}

// ─── Handlers ─────────────────────────────────────────────────────────────

/**
 * orders/create — Item 1 (Day-1 non-negotiable): write wholesale cost per order.
 * Also captures referral code.
 */
async function handleOrderCreated(order: ShopifyOrder): Promise<void> {
  for (const lineItem of order.line_items) {
    const cost   = await getWholesaleCostBySKU(lineItem.sku).catch(() => 0)
    const profit = parseFloat(lineItem.price) - cost

    // Write per-line-item profit metafield onto the order
    await shopifyAdmin(`/orders/${order.id}/metafields.json`, 'POST', {
      metafield: {
        namespace: 'xdipx',
        key:       `profit_${lineItem.sku}`,
        value:     JSON.stringify({
          sku:           lineItem.sku,
          wholesale_cost: cost,
          deal_price:    parseFloat(lineItem.price),
          profit_per_unit: profit,
          quantity:      lineItem.quantity,
          total_profit:  profit * lineItem.quantity,
        }),
        type: 'json',
      },
    }).catch(err => console.error('[webhook] metafield write failed:', err))

    // Update deal_history units_sold
    const today = new Date().toISOString().split('T')[0]!
    await db
      .update(dealHistory)
      .set({
        unitsSold:    db.$count(dealHistory, eq(dealHistory.sku, lineItem.sku)), // increment handled via raw SQL
        totalRevenue: String(parseFloat(lineItem.price) * lineItem.quantity),
        totalProfit:  String(profit * lineItem.quantity),
      })
      .where(eq(dealHistory.sku, lineItem.sku))
      .catch(() => {/* non-critical */})
  }

  // Capture referral code from note_attributes
  const refCode = order.note_attributes?.find(a => a.name === 'ref_source')?.value
  if (refCode) {
    await db.insert(referrals).values({
      refCode,
      referrerType:       'affiliate',
      referredCustomerId: order.customer?.id ? String(order.customer.id) : null,
      firstOrderId:       String(order.id),
      firstOrderValue:    order.total_price,
    }).catch(() => {/* non-critical */})
  }

  // Capture ToS acceptance
  const tosVersion = order.note_attributes?.find(a => a.name === 'tos_version')?.value
  if (tosVersion && order.customer?.id) {
    const { logTosAcceptance } = await import('../app/lib/consent.server.js')
    // We don't have the original Request here; stub IP
    const fakeRequest = new Request('https://xdipx.com')
    await logTosAcceptance(fakeRequest, {
      customerId: String(order.customer.id),
      email:      order.email,
      tosVersion,
      method:     'checkout',
    }).catch(() => {})
  }
}

// ─── Fulfilled order: send review invite ──────────────────────────────────

interface ShopifyFulfillment {
  id: number
  status: string
}

interface ShopifyFulfilledOrder extends ShopifyOrder {
  fulfillments: ShopifyFulfillment[]
  customer?: {
    id: number
    email: string
    first_name?: string
    last_name?: string
  }
}

async function handleOrderFulfilled(order: ShopifyFulfilledOrder): Promise<void> {
  if (!order.email || order.line_items.length === 0) return

  const { getReviewSettings, createInvite } = await import('../app/lib/reviews.server.js')
  const settings = await getReviewSettings()

  const delayMs = settings.inviteDelayDays * 24 * 60 * 60 * 1000
  setTimeout(async () => {
    for (const lineItem of order.line_items) {
      if (!lineItem.sku) continue

      const searchRes = await shopifyAdmin(
        `/products.json?limit=1&sku=${encodeURIComponent(lineItem.sku)}`,
        'GET',
      ).catch(() => null) as { products?: { id: number }[] } | null

      const productId = searchRes?.products?.[0]?.id
      if (!productId) continue

      const shopifyProductId = `gid://shopify/Product/${productId}`
      const reviewerName = [
        order.customer?.first_name,
        order.customer?.last_name,
      ].filter(Boolean).join(' ') || 'Customer'

      await createInvite({
        shopifyOrderId:    String(order.id),
        shopifyCustomerId: order.customer?.id ? String(order.customer.id) : undefined,
        shopifyProductId,
        reviewerEmail:     order.email,
        reviewerName,
      }).catch(err => console.error('[webhook:invite-create]', err))

      const { trackEvent } = await import('../app/lib/klaviyo.server.js')
      await trackEvent(order.email, 'Review Invite Sent', {
        orderId:     order.id,
        productId:   shopifyProductId,
        productName: lineItem.title,
        inviteDate:  new Date().toISOString(),
      }).catch(() => {/* non-critical */})
    }
  }, delayMs)
}

// ─── Product created handler ──────────────────────────────────────────────

interface ShopifyProductWebhook {
  id: number
  handle: string
  title: string
  images?: { src: string }[]
}

async function handleProductCreated(product: ShopifyProductWebhook): Promise<void> {
  const { upsertProductPage } = await import('../app/lib/sanity.server.js')
  const gid = `gid://shopify/Product/${product.id}`
  const result = await upsertProductPage({
    handle: product.handle,
    shopifyProductId: gid,
    title: product.title,
    imageUrl: product.images?.[0]?.src,
  })
  console.log(`[webhook:product-created] ${product.handle} → ${result.created ? 'created in Sanity' : 'already exists'}`)
}

// ─── Router ───────────────────────────────────────────────────────────────

export function createWebhookRoutes() {
  const router = Router()

  router.post('/order-created', async (req: Request, res: Response) => {
    if (!verifyShopifyWebhook(req)) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const order = JSON.parse((req.body as Buffer).toString()) as ShopifyOrder

    // Respond immediately — Shopify expects < 5s
    res.json({ ok: true })

    // Process async (fire and forget — errors logged, not bubbled)
    handleOrderCreated(order).catch(err =>
      console.error('[webhook:order-created]', err),
    )
  })

  router.post('/order-fulfilled', async (req: Request, res: Response) => {
    if (!verifyShopifyWebhook(req)) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const order = JSON.parse((req.body as Buffer).toString()) as ShopifyFulfilledOrder

    res.json({ ok: true })

    handleOrderFulfilled(order).catch(err =>
      console.error('[webhook:order-fulfilled]', err),
    )
  })

  router.post('/product-created', async (req: Request, res: Response) => {
    if (!verifyShopifyWebhook(req)) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const product = JSON.parse((req.body as Buffer).toString()) as ShopifyProductWebhook

    res.json({ ok: true })

    handleProductCreated(product).catch(err =>
      console.error('[webhook:product-created]', err),
    )
  })

  return router
}
