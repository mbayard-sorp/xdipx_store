import { Router, type Request, type Response } from 'express'
import crypto from 'node:crypto'
import { ga4PurchaseFailures, orderLineItems, productCopurchase, referrals } from '../db/schema.js'
import { eq, sql } from 'drizzle-orm'

/**
 * Ceiling on the pre-response conversion sends. Shopify gives a webhook 5s
 * before it counts as failed and starts retrying; two Graph API POSTs are
 * normally well under 300ms.
 */
const PURCHASE_SIGNAL_TIMEOUT_MS = 2500

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
  created_at?: string
  line_items: ShopifyLineItem[]
  note_attributes?: ShopifyNoteAttribute[]
  customer?: { id: number }
  // Shopify records the checkout session's network context. Forwarding it to
  // Meta costs nothing and no new data is collected: same shopper, same
  // browser, and the Purchase event's action_source is already 'website'.
  browser_ip?: string
  client_details?: { user_agent?: string; browser_ip?: string } | null
}

// ─── Handlers ─────────────────────────────────────────────────────────────

/**
 * The revenue-critical half of orders/create: tell Meta and GA4 a sale happened.
 *
 * This runs BEFORE the webhook responds, deliberately. It used to sit ~110
 * lines deep inside the fire-and-forget enrichment work that starts after
 * res.json(), which meant two independent ways to lose a conversion: any
 * unguarded await above it aborted the whole function, and Vercel makes no
 * promise that post-response work runs at all (there is no waitUntil here, and
 * the deployment is fluid compute).
 *
 * Kept deliberately small and dependency-light so it comfortably fits inside
 * Shopify's 5s webhook budget. Everything that can wait is in
 * handleOrderCreated.
 */
async function handlePurchaseSignals(order: ShopifyOrder): Promise<void> {
  // The two destinations are independent, so run them concurrently: serially
  // they stack latency against the pre-response ceiling for no reason.
  await Promise.allSettled([sendMetaPurchase(order), sendGa4Purchase_(order)])
}

async function sendMetaPurchase(order: ShopifyOrder): Promise<void> {
  // Meta CAPI. Dedup is by a stable event_id derived from the order id, so a
  // Shopify retry and the reconciliation sweep collapse into one conversion.
  // The webhook has no browser consent state, so this is the PII-free path.
  try {
    const { fromWebhookOrder, sendPurchaseWithLedger } = await import('../app/lib/purchase-capi.server.js')
    const result = await sendPurchaseWithLedger(fromWebhookOrder(order))
    if (!result.ok) {
      console.error('[webhook:order-created] Meta CAPI Purchase not delivered:', result.error ?? result.skipped)
    }
  } catch (err) {
    console.error('[webhook:order-created] Meta CAPI Purchase block error:', err)
  }
}

async function sendGa4Purchase_(order: ShopifyOrder): Promise<void> {
  // GA4 Measurement Protocol. GA4 is the stack's analytics of record for
  // strategy and ads decisions, but the client funnel ends at begin_checkout
  // (checkout is on Shopify's domain), so the conversion is sent server-side
  // alongside the CAPI event. GA4 dedupes ecommerce on transaction_id.
  try {
    const { sendGa4Purchase } = await import('../app/lib/ga4-mp.server.js')
    const gaCid = order.note_attributes?.find(a => a.name === '_ga_cid')?.value || null
    const lineItems = order.line_items ?? []
    const gaEvent = {
      transactionId: String(order.id),
      value:         parseFloat(order.total_price) || 0,
      currency:      order.currency || 'USD',
      items: lineItems.map(li => ({
        item_id:   li.product_id ? String(li.product_id) : (li.sku || String(li.variant_id ?? '')),
        item_name: li.title,
        price:     parseFloat(li.price) || 0,
        quantity:  li.quantity || 0,
      })),
      clientId: gaCid,
    }
    const gaResult = await sendGa4Purchase(gaEvent)
    if (!gaResult.ok && !gaResult.skipped) {
      const { db } = await import('../app/lib/db.server.js')
      await db.insert(ga4PurchaseFailures)
        .values({ orderId: String(order.id), payload: gaEvent, attempts: 1, lastError: gaResult.error ?? 'unknown' })
        .onConflictDoNothing({ target: ga4PurchaseFailures.orderId })
      console.error('[webhook:order-created] GA4 purchase failed, queued for retry:', gaResult.error)
    }
  } catch (err) {
    console.error('[webhook:order-created] GA4 purchase block error:', err)
  }
}

/**
 * orders/create — Item 1 (Day-1 non-negotiable): write wholesale cost per order.
 * Also captures referral code.
 *
 * Best-effort enrichment. Runs after the response, so a failure here costs
 * profit attribution and co-purchase data, never a conversion event.
 */
async function handleOrderCreated(order: ShopifyOrder): Promise<void> {
  // A module that fails to load is a deployment problem, not an order problem.
  // Unguarded, these two lines aborted every downstream step silently.
  let db: Awaited<typeof import('../app/lib/db.server.js')>['db']
  let getWholesaleCostBySKU: Awaited<typeof import('../app/lib/shopify.server.js')>['getWholesaleCostBySKU']
  let getHandleByProductId: Awaited<typeof import('../app/lib/shopify.server.js')>['getHandleByProductId']
  let shopifyAdmin: Awaited<typeof import('../app/lib/shopify.server.js')>['shopifyAdmin']
  try {
    ;({ db } = await import('../app/lib/db.server.js'))
    ;({ getWholesaleCostBySKU, getHandleByProductId, shopifyAdmin } = await import('../app/lib/shopify.server.js'))
  } catch (err) {
    console.error('[webhook:order-created] enrichment imports failed, skipping enrichment', err)
    return
  }

  const orderLines = order.line_items ?? []

  // Resolve handles for each line item (used for copurchase rollup).
  const resolvedHandles: (string | null)[] = await Promise.all(
    orderLines.map(li =>
      li.product_id ? getHandleByProductId(li.product_id).catch(() => null) : Promise.resolve(null),
    ),
  )

  // Per-line-item work is independent — parallelize to keep the webhook
  // inside Shopify's retry budget on multi-item orders. allSettled, not all:
  // one throwing line item must not take down the rest of the enrichment.
  await Promise.allSettled(orderLines.map(async lineItem => {
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

    // No deal_history rollup here. It used to write unitsSold from a COUNT of
    // deal_history rows matching the SKU (an aggregate that never meant units
    // sold) and overwrite, rather than accumulate, revenue and profit per line
    // item — so a two-item order left the totals reflecting only whichever
    // line finished last. Revenue and profit come from daily_profit_summary,
    // which is computed from Shopify's own paid orders.
    await metafieldWrite
  }))

  // Persist raw line items for analytics + copurchase rollups
  try {
    const rows = orderLines.map((li, i) => ({
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
    try {
      const { logTosAcceptance } = await import('../app/lib/consent.server.js')
      // We don't have the original Request here; stub IP
      const fakeRequest = new Request('https://xdipx.com')
      await logTosAcceptance(fakeRequest, {
        customerId: String(order.customer.id),
        email:      order.email,
        tosVersion,
        method:     'checkout',
      }).catch(() => {})
    } catch (err) {
      console.error('[webhook:order-created] ToS logging failed', err)
    }
  }

  // ─── Klaviyo Placed Order ──────────────────────────────────────────────────
  // Post-purchase flow trigger. The headless storefront never sent order events;
  // trackPlacedOrder dedupes on the order id so a retried webhook is safe.
  try {
    if (order.email) {
      const { trackPlacedOrder } = await import('../app/lib/klaviyo.server.js')
      // UTM + ref attribution stamped onto the cart by api.cart survives here
      // as note_attributes; forward whatever is present as event properties.
      const attribution: Record<string, string> = {}
      const attrMap: Record<string, string> = {
        _utm_source:   'utm_source',
        _utm_medium:   'utm_medium',
        _utm_campaign: 'utm_campaign',
        _utm_content:  'utm_content',
        _ref_code:     'ref_code',
      }
      for (const attr of order.note_attributes ?? []) {
        const prop = attrMap[attr.name]
        if (prop && attr.value) attribution[prop] = attr.value
      }
      await trackPlacedOrder(order.email, {
        orderId:     String(order.id),
        orderNumber: order.order_number,
        value:       parseFloat(order.total_price) || 0,
        currency:    order.currency || 'USD',
        ...(Object.keys(attribution).length > 0 ? { attribution } : {}),
        items: (order.line_items ?? []).map(li => ({
          productTitle: li.title,
          ...(li.variant_id ? { variantId: String(li.variant_id) } : {}),
          price:        parseFloat(li.price) || 0,
          quantity:     li.quantity || 0,
        })),
      })
    }
  } catch (err) {
    console.error('[webhook:order-created] Klaviyo Placed Order block error:', err)
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

  // Insert scheduled invite rows immediately; a serverless instance does not
  // live long enough for a days-long setTimeout (the previous approach, which
  // is why no delayed invite ever fired). The daily /cron/review-reminders
  // job sends invites whose send_after has passed and fires the Klaviyo
  // "Review Invite Sent" event at actual send time.
  const sendAfter = new Date(Date.now() + settings.inviteDelayDays * 24 * 60 * 60 * 1000)

  for (const lineItem of order.line_items) {
    if (!lineItem.sku) continue

    // The product id is already in the fulfillment payload. This used to call
    // `/products.json?limit=1&sku=...`, but REST `/products.json` has no `sku`
    // filter: Shopify ignored it and returned the first product in the shop, so
    // every invite was either attributed to an unrelated product or dropped.
    // `review_invites` is empty despite a real fulfilled order, which is also
    // why /cron/review-reminders has never had anything to send.
    const productId = lineItem.product_id
    if (!productId) {
      console.warn(`[webhook:order-fulfilled] line item ${lineItem.sku} has no product_id, skipping invite`)
      continue
    }

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

/** KV key holding the last-observed `available` for one inventory item, so the
 *  next update can tell a routine change apart from a sold-out -> in-stock
 *  crossing. */
function inventoryLevelKey(inventoryItemId: number): string {
  return `invlevel:${inventoryItemId}`
}

/**
 * Pure: did availability cross from sold-out to in-stock? True only when the
 * previous observed level was known and non-positive and the current level is
 * positive. A null `prev` (never observed) is deliberately NOT a crossing, so
 * the first webhook we ever see for an item, and routine positive updates
 * (e.g. 50 -> 49), never fire a back-in-stock notification.
 */
export function isRestockCrossing(prev: number | null, current: number): boolean {
  return prev !== null && prev <= 0 && current > 0
}

async function handleInventoryUpdate(level: ShopifyInventoryLevel): Promise<void> {
  const { kvGet, kvSet } = await import('../app/lib/kv.server.js')
  const key = inventoryLevelKey(level.inventory_item_id)
  const prev = await kvGet<number>(key)
  // Record the current level first so any future crossing is detectable, even
  // if the notification path below throws.
  await kvSet(key, level.available)

  // Sold-out path: nothing to do beyond recording the level above. This used to
  // rotate the daily deal off a sold-out live deal; daily deals are retired.
  if (level.available <= 0) return

  // Restock path: only on a genuine sold-out -> in-stock crossing, notify
  // everyone waiting on this product. Firing on every positive update would
  // spam; the crossing guard limits us to the transition that matters.
  if (!isRestockCrossing(prev, level.available)) return

  const { getProductByInventoryItemId } = await import('../app/lib/shopify.server.js')
  const product = await getProductByInventoryItemId(String(level.inventory_item_id))
  if (!product) {
    console.warn(`[webhook:inventory-update] restock crossing but no product for inventory_item ${level.inventory_item_id}`)
    return
  }

  const { triggerBackInStock } = await import('../app/lib/klaviyo.server.js')
  await triggerBackInStock(product)
  console.log(`[webhook:inventory-update] back-in-stock fired for ${product.handle} (available ${level.available})`)
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

    let order: ShopifyOrder
    try {
      order = JSON.parse((req.body as Buffer).toString()) as ShopifyOrder
    } catch (err) {
      // An unparseable body used to throw inside an async Express handler,
      // which writes no response at all and leaves Shopify to time out.
      console.error('[webhook:order-created] unparseable body', err)
      res.status(400).json({ error: 'Bad Request' })
      return
    }

    // Send the conversion signals BEFORE responding. Shopify's budget is 5s and
    // this is two HTTP POSTs, so the ceiling is a guard against a pathological
    // stall, not an expected path. If it does trip, the send keeps running and
    // the reconciliation sweep catches the order within 15 minutes anyway.
    await Promise.race([
      handlePurchaseSignals(order).catch(err =>
        console.error('[webhook:order-created] purchase signals', err),
      ),
      new Promise<void>(resolve => setTimeout(resolve, PURCHASE_SIGNAL_TIMEOUT_MS)),
    ])

    res.json({ ok: true })

    // Enrichment is best-effort and explicitly allowed to be lost.
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
