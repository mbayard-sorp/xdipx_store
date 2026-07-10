import { Router, type Request, type Response } from 'express'
import crypto from 'node:crypto'
import { dealHistory, metaCapiFailures, orderLineItems, productCopurchase, referrals } from '../db/schema.js'
import { eq, sql } from 'drizzle-orm'

// ─── HMAC verification ────────────────────────────────────────────────────

function verifyShopifyWebhook(req: Request): boolean {
  const secret = process.env['SHOPIFY_WEBHOOK_SECRET']
  if (!secret) return false
  const hmac = req.headers['x-shopify-hmac-sha256']
  if (typeof hmac !== 'string' || hmac.length === 0) return false
  const body   = req.body as Buffer
  const digest = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64')
  const a = Buffer.from(hmac)
  const b = Buffer.from(digest)
  // timingSafeEqual throws on length mismatch, turning a bad header into a 500
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

// ─── Order payload types ──────────────────────────────────────────────────

interface ShopifyLineItem {
  id: number
  product_id?: number
  variant_id?: number
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
  currency?: string
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
  const { db } = await import('../app/lib/db.server.js')
  const { getWholesaleCostBySKU, getHandleByProductId, shopifyAdmin } = await import('../app/lib/shopify.server.js')

  // Resolve handles for each line item (used for copurchase rollup).
  const resolvedHandles: (string | null)[] = await Promise.all(
    order.line_items.map(li =>
      li.product_id ? getHandleByProductId(li.product_id).catch(() => null) : Promise.resolve(null),
    ),
  )

  // Per-line-item work is independent — parallelize to keep the webhook
  // inside Shopify's retry budget on multi-item orders.
  await Promise.all(order.line_items.map(async lineItem => {
    const cost   = await getWholesaleCostBySKU(lineItem.sku).catch(() => 0)
    const profit = parseFloat(lineItem.price) - cost

    const metafieldWrite = shopifyAdmin(`/orders/${order.id}/metafields.json`, 'POST', {
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

    const dealHistoryUpdate = db
      .update(dealHistory)
      .set({
        unitsSold:    db.$count(dealHistory, eq(dealHistory.sku, lineItem.sku)),
        totalRevenue: String(parseFloat(lineItem.price) * lineItem.quantity),
        totalProfit:  String(profit * lineItem.quantity),
      })
      .where(eq(dealHistory.sku, lineItem.sku))
      .catch(() => {/* non-critical */})

    await Promise.all([metafieldWrite, dealHistoryUpdate])
  }))

  // Persist raw line items for analytics + copurchase rollups
  try {
    const rows = order.line_items.map((li, i) => ({
      shopifyOrderId:   String(order.id),
      shopifyProductId: li.product_id ? String(li.product_id) : '',
      handle:           resolvedHandles[i] ?? null,
      sku:              li.sku || null,
      quantity:         li.quantity,
      unitPrice:        li.price,
    }))
    if (rows.length > 0) await db.insert(orderLineItems).values(rows)
  } catch (err) {
    console.error('[webhook:order-created] line items insert failed:', err)
  }

  // UPSERT co-purchase pairs. Convention: handle_a < handle_b (lexicographic).
  const uniqueHandles = Array.from(
    new Set(resolvedHandles.filter((h): h is string => !!h)),
  )
  if (uniqueHandles.length >= 2) {
    for (let i = 0; i < uniqueHandles.length; i++) {
      for (let j = i + 1; j < uniqueHandles.length; j++) {
        const [a, b] = [uniqueHandles[i]!, uniqueHandles[j]!].sort() as [string, string]
        try {
          await db.insert(productCopurchase)
            .values({ handleA: a, handleB: b, count: 1 })
            .onConflictDoUpdate({
              target: [productCopurchase.handleA, productCopurchase.handleB],
              set: {
                count:      sql`${productCopurchase.count} + 1`,
                lastSeenAt: new Date(),
              },
            })
        } catch (err) {
          console.error('[webhook:order-created] copurchase upsert failed:', err)
        }
      }
    }
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

  // ─── Meta CAPI Purchase event ─────────────────────────────────────────────
  // Revenue-critical conversion signal. No browser pixel counterpart here (the
  // shopper has left the storefront), so dedup is by a stable event_id derived
  // from the order id (idempotent on Shopify webhook retries). The webhook has
  // no browser consent state, so we send the PII-free path (no hashed email);
  // value/currency/content_ids only. On failure we enqueue for the cron drain.
  try {
    const { sendCapiEvent } = await import('../app/lib/meta-capi.server.js')
    const fbp = order.note_attributes?.find(a => a.name === '_fbp')?.value || null
    const fbc = order.note_attributes?.find(a => a.name === '_fbc')?.value || null
    const eventId  = `purchase_${order.id}`
    const numItems = order.line_items.reduce((n, li) => n + (li.quantity || 0), 0)
    const contentIds = order.line_items
      .map(li => (li.product_id ? String(li.product_id) : ''))
      .filter(Boolean)

    const event = {
      event_name:    'Purchase' as const,
      event_id:      eventId,
      event_time:    Math.floor(Date.now() / 1000),
      action_source: 'website' as const,
      user_data:     { fbp, fbc },
      custom_data:   {
        content_ids:  contentIds,
        content_type: 'product' as const,
        value:        parseFloat(order.total_price) || 0,
        currency:     order.currency || 'USD',
        num_items:    numItems,
      },
    }

    // consentGranted: false → PII-free (no email) per the launch consent policy.
    const result = await sendCapiEvent(event, { consentGranted: false })
    if (!result.ok) {
      await db.insert(metaCapiFailures)
        .values({
          orderId:   String(order.id),
          eventId,
          payload:   event,
          attempts:  1,
          lastError: result.error ?? 'unknown',
        })
        .onConflictDoNothing({ target: metaCapiFailures.orderId })
      console.error('[webhook:order-created] Meta CAPI Purchase failed, queued for retry:', result.error)
    }
  } catch (err) {
    console.error('[webhook:order-created] Meta CAPI Purchase block error:', err)
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

  const { shopifyAdmin } = await import('../app/lib/shopify.server.js')
  const { getReviewSettings, createInvite } = await import('../app/lib/reviews.server.js')
  const settings = await getReviewSettings()

  // Insert scheduled invite rows immediately; a serverless instance does not
  // live long enough for a days-long setTimeout (the previous approach, which
  // is why no delayed invite ever fired). The daily /cron/review-reminders
  // job sends invites whose send_after has passed and fires the Klaviyo
  // "Review Invite Sent" event at actual send time.
  const sendAfter = new Date(Date.now() + settings.inviteDelayDays * 24 * 60 * 60 * 1000)

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
      sendAfter,
    }).catch(err => console.error('[webhook:invite-create]', err))
  }
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

// ─── Product updated: purge markdown twin cache ──────────────────────────
//
// Shopify fires `products/update` on any product mutation (price, availability,
// title, status, etc). The markdown twin at /products/:slug.md caches its
// rendered body in KV for 900s (app/routes/products.$slug[.md].tsx), which
// means an AI crawler can cite a stale price or "in stock" claim for up to
// 15 minutes after a change. Purge just that product's own cache key (plus
// the two handle-scoped Shopify read caches backing the same PDP data),
// cheap, precise, single-key deletes. Collection/homepage markdown that
// happens to embed this product's price is left to expire on its own TTL;
// purging those would require a scan we don't want on a webhook hot path.

async function handleProductUpdated(product: ShopifyProductWebhook): Promise<void> {
  if (!product.handle) {
    console.warn('[webhook:product-updated] payload missing handle, skipping purge:', product.id)
    return
  }
  const { purgeMarkdownCache } = await import('../app/lib/kv.server.js')
  await purgeMarkdownCache(product.handle)
  console.log(`[webhook:product-updated] purged markdown + PDP cache for ${product.handle}`)
}

// ─── Inventory update: auto-rotate on sold-out ──────────────────────────

interface ShopifyInventoryLevel {
  inventory_item_id: number
  location_id: number
  available: number
}

async function handleInventoryUpdate(level: ShopifyInventoryLevel): Promise<void> {
  // Only care if available hit zero
  if (level.available > 0) return

  const { isLiveDealSoldOut, rotateDeal } = await import('../app/lib/deal-rotator.server.js')
  const { soldOut } = await isLiveDealSoldOut()

  if (soldOut) {
    console.log('[webhook:inventory-update] Live deal sold out — rotating to next deal')
    const result = await rotateDeal()
    console.log('[webhook:inventory-update] Rotation result:', result)
  }
}

// ─── Returns: tracking + auto-refund ──────────────────────────────────────
//
// Shopify fires `returns/update` when a return's status changes AND when the
// attached reverse delivery's tracking updates. We refetch the return on each
// fire to get current state, then:
//   - update tracking info on our row
//   - if the reverse delivery is "delivered" OR Shopify marks the return as
//     "received" / processed, kick the refund + close pipeline
// Idempotent — markReceivedAndRefund short-circuits on already-refunded rows.

interface ShopifyReturnWebhook {
  id: number
  admin_graphql_api_id?: string
  status?: string
  order_id?: number
}

async function handleReturnsUpdate(payload: ShopifyReturnWebhook): Promise<void> {
  const returnGid =
    payload.admin_graphql_api_id ?? `gid://shopify/Return/${payload.id}`

  const { getReturn } = await import('../app/lib/shopify.server.js')
  const { recordLabelTracking, markReceivedAndRefund } =
    await import('../app/lib/returns.server.js')

  const current = await getReturn(returnGid).catch(() => null)
  if (!current) {
    console.warn('[webhook:returns-update] return not found in Shopify:', returnGid)
    return
  }

  // Update tracking from the first reverse delivery (we only buy one per RMA).
  const rd = current.reverseDeliveries[0]
  if (rd?.trackingNumber) {
    await recordLabelTracking(returnGid, {
      trackingNumber: rd.trackingNumber,
      // Shopify's Return query doesn't expose granular tracking states;
      // we just flip status → in_transit. Actual delivery triggers refund below.
      trackingStatus: 'in_transit',
    }).catch(err => console.error('[webhook:returns-update] tracking update failed:', err))
  }

  // Terminal state → refund + close. Shopify return statuses we care about:
  //   OPEN → nothing to do
  //   CLOSED → already refunded, nothing to do (our row will also be closed)
  //   DECLINED / CANCELED → mark row, no refund
  //   processed (via reverse delivery delivered) → fire refund
  const status = (current.status ?? '').toUpperCase()
  if (status === 'DECLINED' || status === 'CANCELED') {
    const { db } = await import('../app/lib/db.server.js')
    const { returns } = await import('../db/schema.js')
    await db.update(returns)
      .set({ status: status === 'DECLINED' ? 'denied' : 'canceled', updatedAt: new Date() })
      .where(eq(returns.shopifyReturnId, returnGid))
    return
  }

  // Fire refund when Shopify signals the return is complete. We check both
  // the top-level status AND (defensively) the webhook payload status.
  const terminalSignals = ['CLOSED', 'RECEIVED', 'PROCESSED']
  const webhookStatus = (payload.status ?? '').toUpperCase()
  if (terminalSignals.includes(status) || terminalSignals.includes(webhookStatus)) {
    const result = await markReceivedAndRefund(returnGid, { currencyCode: 'USD' })
    if (!result.ok) {
      console.error('[webhook:returns-update] refund failed:', result.error)
    }
  }
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

  router.post('/product-updated', async (req: Request, res: Response) => {
    if (!verifyShopifyWebhook(req)) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    let product: ShopifyProductWebhook | null = null
    try {
      product = JSON.parse((req.body as Buffer).toString()) as ShopifyProductWebhook
    } catch (err) {
      console.error('[webhook:product-updated] malformed payload, skipping:', err)
    }

    // Ack immediately regardless of parse outcome — a malformed payload should
    // never cause Shopify to retry-storm this endpoint.
    res.json({ ok: true })

    if (product) {
      handleProductUpdated(product).catch(err =>
        console.error('[webhook:product-updated]', err),
      )
    }
  })

  router.post('/inventory-update', async (req: Request, res: Response) => {
    if (!verifyShopifyWebhook(req)) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const level = JSON.parse((req.body as Buffer).toString()) as ShopifyInventoryLevel

    res.json({ ok: true })

    handleInventoryUpdate(level).catch(err =>
      console.error('[webhook:inventory-update]', err),
    )
  })

  router.post('/returns-update', async (req: Request, res: Response) => {
    if (!verifyShopifyWebhook(req)) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const payload = JSON.parse((req.body as Buffer).toString()) as ShopifyReturnWebhook

    res.json({ ok: true })

    handleReturnsUpdate(payload).catch(err =>
      console.error('[webhook:returns-update]', err),
    )
  })

  return router
}
