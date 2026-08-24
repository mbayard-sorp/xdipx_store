/**
 * Meta CAPI Purchase: delivery, ledger, and reconciliation.
 *
 * Why this module exists. Purchase is the only conversion event with no browser
 * pixel counterpart (the shopper is on Shopify's checkout domain when it
 * happens), so the order webhook is the sole real-time path. On 2026-07-31 an
 * audit found zero Purchase events had ever reached Meta: the webhook has never
 * fired at all, order_line_items was empty for every order ever placed, and no
 * failure row was ever written because the send is never attempted.
 *
 * That failure mode is the design constraint. A webhook that was never
 * registered cannot be fixed by making the webhook handler better, so delivery
 * is built on two independent legs:
 *
 *   1. The webhook calls sendPurchaseWithLedger before responding to Shopify.
 *   2. A reconciler sweeps paid Shopify orders and sends whatever the ledger
 *      has no resolved row for.
 *
 * Both produce the identical deterministic event id, so Meta dedupes them and
 * running both is free. The ledger is written BEFORE the send, not only on
 * failure, so "we tried" is recorded even when the process dies mid-flight.
 *
 * Server-only. Never throws; every entry point returns a result object.
 */
import { eq, inArray } from 'drizzle-orm'
import { db } from './db.server'
import { metaCapiOutbox } from '../../db/schema'
import { sendCapiEvent, type CapiEvent } from './meta-capi.server'

/** Meta rejects events older than this, so reconciliation cannot help beyond it. */
const META_MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * A Purchase in the shape this module needs, normalized away from whichever
 * Shopify surface it came from. The webhook delivers REST snake_case; the
 * reconciler delivers GraphQL camelCase. Neither shape leaks past its adapter.
 */
export interface PurchaseOrder {
  /** Numeric Shopify order id as a string. Drives the dedup event id. */
  id:           string
  totalPrice:   number
  currency:     string
  /** Shopify product ids (not variant ids), matching the catalog feed. */
  productIds:   string[]
  numItems:     number
  fbp:          string | null
  fbc:          string | null
  clientIp:     string | null
  userAgent:    string | null
  /** Order creation time in ms. Reconciliation must report when the sale
   *  happened, not when the sweep noticed it. */
  createdAtMs:  number
}

// ─── Event construction ───────────────────────────────────────────────────────

/**
 * Build the CAPI payload. Pure, so the dedup contract is testable without
 * network or database.
 *
 * The event id is `purchase_<orderId>` and nothing else. That is what makes the
 * webhook leg and the reconciler leg collapse into one conversion on Meta's
 * side, and what makes a Shopify webhook retry idempotent.
 */
export function buildPurchaseEvent(order: PurchaseOrder): CapiEvent {
  const user_data: CapiEvent['user_data'] = {
    fbp: order.fbp,
    fbc: order.fbc,
  }
  // Omit rather than send a placeholder. A junk value reads as 100% coverage in
  // Event Match Quality while matching nobody, which is worse than a gap.
  if (order.clientIp)  user_data.client_ip_address = order.clientIp
  if (order.userAgent) user_data.client_user_agent = order.userAgent

  return {
    event_name:    'Purchase',
    event_id:      `purchase_${order.id}`,
    event_time:    Math.floor(order.createdAtMs / 1000),
    action_source: 'website',
    user_data,
    custom_data: {
      content_ids:  order.productIds,
      content_type: 'product',
      value:        order.totalPrice,
      currency:     order.currency,
      num_items:    order.numItems,
    },
  }
}

/** True when the order is still inside Meta's accepted event window. */
export function isWithinMetaEventWindow(order: PurchaseOrder, nowMs: number = Date.now()): boolean {
  return nowMs - order.createdAtMs < META_MAX_EVENT_AGE_MS
}

// ─── Durable failure surfacing ─────────────────────────────────────────────────

/** KV key for the per-UTC-day count of Purchase (Meta CAPI) ledger writes that failed. */
function ledgerWriteFailureKey(utcDate: string): string {
  return `purchase-capi:write-failures:${utcDate}`
}

/**
 * Record one Purchase ledger write that failed. The ledger insert/update is
 * best-effort so it never unwinds a conversion send, but a *persistent* failure
 * (a missing/renamed table, or repeated Neon errors) must not stay a swallowed
 * console.error: it bumps a per-UTC-day KV counter the owner digest reads, so the
 * gap shows up within hours instead of hiding in logs for days.
 *
 * Kept in KV (independent of the Neon table that just failed) and mirrors
 * token-log.server.ts's recordTokenWriteFailure. This is exactly the signal that
 * was missing when migration 082's unapplied rename left meta_capi_outbox absent
 * and every Purchase ledger write failed for ~2 days with the only loud symptom
 * being the /api/team/conversion-status 500 (#5061/#5092). A one-off transient
 * blip bumps the counter by 1; a real outage bumps it once per order, so the
 * magnitude tells the two apart without a per-call retry.
 *
 * BEST-EFFORT: kvIncrBy degrades to the in-memory fallback and never throws, and
 * the whole body is guarded so recording a miss cannot itself unwind the caller.
 */
async function recordLedgerWriteFailure(): Promise<void> {
  try {
    const { kvIncrBy } = await import('./kv.server')
    const day = new Date().toISOString().slice(0, 10)
    // One small integer per UTC day. kvIncrBy is atomic but sets no expiry; the
    // digest reads today's and yesterday's buckets, and older buckets are stale
    // but harmless.
    await kvIncrBy(ledgerWriteFailureKey(day), 1)
  } catch (err) {
    console.error('[purchase-capi] failed to record ledger write-failure counter (ignored):', err)
  }
}

/**
 * Count of Purchase ledger writes that failed over the trailing ~24-48h (current
 * and previous UTC-day buckets summed), read from KV by the owner digest. Zero
 * when healthy or when KV is cold. BEST-EFFORT: never throws.
 */
export async function getPurchaseCapiWriteFailureCount(): Promise<number> {
  try {
    const { kvGet } = await import('./kv.server')
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    const prev = new Date(now.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10)
    const [a, b] = await Promise.all([
      kvGet<number>(ledgerWriteFailureKey(today)),
      kvGet<number>(ledgerWriteFailureKey(prev)),
    ])
    return (Number(a) || 0) + (Number(b) || 0)
  } catch (err) {
    console.error('[purchase-capi] failed to read ledger write-failure counter (ignored):', err)
    return 0
  }
}

// ─── Ledger-backed send ───────────────────────────────────────────────────────

export interface PurchaseSendResult {
  ok:       boolean
  orderId:  string
  /** Set when the send was deliberately not attempted. */
  skipped?: string
  error?:   string
}

/**
 * Send one Purchase, recording the attempt in `meta_capi_outbox` first.
 *
 * The table name reads as a failure log because that is all it used to hold.
 * It is now the outbox: a row appears when a send is attempted and gets
 * `resolvedAt` when it lands. An unresolved row is therefore either in flight
 * or genuinely stuck, and the reconciler can tell the difference from a gap.
 *
 * Every ledger write is individually guarded. The ledger is bookkeeping; it
 * must never be the reason a conversion goes unreported.
 */
export async function sendPurchaseWithLedger(order: PurchaseOrder): Promise<PurchaseSendResult> {
  // A payload with no usable order id is not a sale. Without this guard a
  // malformed or probe request produced event_id "purchase_undefined" and sent
  // it: observed on 2026-07-31, where Meta rejected it with a 400 for having no
  // usable customer information. Meta catching it is luck, not a design. An id
  // is also the dedup key, so a send without one could never be reconciled.
  if (!order.id || order.id === 'undefined' || order.id === 'null') {
    return { ok: false, orderId: order.id || '(missing)', skipped: 'no order id' }
  }

  const event = buildPurchaseEvent(order)

  try {
    await db.insert(metaCapiOutbox)
      .values({
        orderId:   order.id,
        eventId:   event.event_id,
        payload:   event,
        attempts:  0,
        lastError: null,
      })
      .onConflictDoNothing({ target: metaCapiOutbox.orderId })
  } catch (err) {
    console.error('[purchase-capi] ledger insert failed, sending anyway', order.id, err)
    await recordLedgerWriteFailure()
  }

  const result = await sendCapiEvent(event, { consentGranted: false })

  try {
    if (result.ok) {
      await db.update(metaCapiOutbox)
        .set({ resolvedAt: new Date(), lastError: null })
        .where(eq(metaCapiOutbox.orderId, order.id))
    } else {
      await db.update(metaCapiOutbox)
        .set({ lastError: result.error ?? result.skipped ?? 'unknown' })
        .where(eq(metaCapiOutbox.orderId, order.id))
    }
  } catch (err) {
    console.error('[purchase-capi] ledger update failed', order.id, err)
    await recordLedgerWriteFailure()
  }

  if (result.ok) return { ok: true, orderId: order.id }
  return {
    ok:      false,
    orderId: order.id,
    ...(result.skipped ? { skipped: result.skipped } : {}),
    ...(result.error   ? { error: result.error }     : {}),
  }
}

// ─── Webhook adapter ──────────────────────────────────────────────────────────

/** The REST orders/create fields this module reads. */
export interface WebhookOrderShape {
  id:               number
  total_price:      string
  currency?:        string
  created_at?:      string
  browser_ip?:      string
  client_details?:  { user_agent?: string; browser_ip?: string } | null
  line_items?:      { product_id?: number; quantity?: number }[]
  note_attributes?: { name: string; value: string }[]
}

export function fromWebhookOrder(order: WebhookOrderShape, nowMs: number = Date.now()): PurchaseOrder {
  const noteAttr = (name: string) =>
    order.note_attributes?.find(a => a.name === name)?.value || null

  const lineItems = order.line_items ?? []
  const createdAt = order.created_at ? Date.parse(order.created_at) : NaN

  return {
    id:          String(order.id),
    totalPrice:  parseFloat(order.total_price) || 0,
    currency:    order.currency || 'USD',
    productIds:  lineItems.map(li => (li.product_id ? String(li.product_id) : '')).filter(Boolean),
    numItems:    lineItems.reduce((n, li) => n + (li.quantity || 0), 0),
    fbp:         noteAttr('_fbp'),
    fbc:         noteAttr('_fbc'),
    // Shopify records the checkout session's IP and UA. Same shopper, same
    // browser, and action_source is 'website', so these are the correct values
    // for this event. No new data is collected to obtain them.
    clientIp:    order.client_details?.browser_ip || order.browser_ip || null,
    userAgent:   order.client_details?.user_agent || null,
    createdAtMs: Number.isFinite(createdAt) ? createdAt : nowMs,
  }
}

// ─── Reconciliation ───────────────────────────────────────────────────────────

/** adminGraphQL unwraps the GraphQL envelope and returns `data` directly. */
interface AdminOrdersResponse {
  orders: {
    nodes: Array<{
      id:              string
      createdAt:       string
      currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } }
      customAttributes: Array<{ key: string; value: string }>
      clientIp:        string | null
      lineItems: { nodes: Array<{ quantity: number; product: { id: string } | null }> }
    }>
  }
}

const RECONCILE_ORDERS_QUERY = `
  query PurchaseReconcile($query: String!) {
    orders(first: 50, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        createdAt
        clientIp
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        customAttributes { key value }
        lineItems(first: 100) { nodes { quantity product { id } } }
      }
    }
  }
`

/** `gid://shopify/Order/123` -> `123`. */
export function numericOrderId(gid: string): string {
  const tail = gid.split('/').pop() ?? gid
  return tail
}

export interface ReconcileResult {
  scanned:   number
  gaps:      string[]
  sent:      string[]
  failed:    Array<{ orderId: string; error: string }>
  tooOld:    string[]
  dryRun:    boolean
}

/**
 * Find paid orders with no resolved ledger row and send their Purchase events.
 *
 * This is the leg that works when the webhook does not, which as of 2026-07-31
 * is the actual production state. It is safe to run on a short interval: the
 * deterministic event id means a double send is a no-op on Meta's side, and the
 * ledger keeps the Shopify query result from turning into repeated traffic.
 */
/**
 * The reconcile's single Shopify query, with a throttle-aware retry.
 *
 * adminGraphQL already retries THROTTLED four times with a backoff capped at 5s
 * per attempt, so it rides out about 20 seconds. That was not enough: the
 * discovery index rebuild held the rate-limit bucket near zero for ~60s at a
 * time, and because it ran on the same 15-minute cron tick as this sweep, the
 * collision was not occasional — the reconcile was throttled on every single
 * run (19:45, 20:15, 20:45, 21:15, 21:30, 21:45, 22:01 UTC on 2026-08-05).
 *
 * The rebuild's own oversizing is fixed separately and is the real cure; this
 * is the seatbelt. The sweep is the safety net for Purchase events the webhook
 * missed, so it is the last thing that should be taken out by someone else's
 * burst. Escalating 5s/10s/15s/20s costs nothing on a 15-minute cadence.
 *
 * Same shape and reason as fetchPricingPageWithBackoff in shopify.server.ts.
 */
const RECONCILE_THROTTLE_RETRIES = 4
const RECONCILE_THROTTLE_BACKOFF_MS = 5000

async function fetchReconcileOrders(search: string): Promise<AdminOrdersResponse> {
  const { adminGraphQL } = await import('./shopify.server')
  for (let attempt = 1; ; attempt++) {
    try {
      return await adminGraphQL<AdminOrdersResponse>(RECONCILE_ORDERS_QUERY, { query: search })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // A non-throttle error still fails fast and unchanged: retrying a bad
      // query or an auth failure just delays the log line.
      if (attempt > RECONCILE_THROTTLE_RETRIES || !/throttl/i.test(message)) throw err
      await new Promise(r => setTimeout(r, attempt * RECONCILE_THROTTLE_BACKOFF_MS))
    }
  }
}

export async function reconcilePurchases(
  opts: { sinceHours?: number; dryRun?: boolean } = {},
): Promise<ReconcileResult> {
  const sinceHours = opts.sinceHours ?? 26
  const dryRun     = opts.dryRun ?? false
  const out: ReconcileResult = { scanned: 0, gaps: [], sent: [], failed: [], tooOld: [], dryRun }

  const sinceIso = new Date(Date.now() - sinceHours * 3600_000).toISOString()
  const search   = `created_at:>='${sinceIso}' financial_status:paid status:any`

  type AdminOrderNode = AdminOrdersResponse['orders']['nodes'][number]
  let orders: AdminOrderNode[]
  try {
    orders = (await fetchReconcileOrders(search))?.orders?.nodes ?? []
  } catch (err) {
    console.error('[purchase-capi] reconcile: Shopify query failed', err)
    return out
  }

  out.scanned = orders.length
  if (orders.length === 0) return out

  const ids = orders.map(o => numericOrderId(o.id))

  // Only a RESOLVED row proves delivery. An unresolved row means a previous
  // attempt did not land, so it stays a gap and gets retried here.
  let resolved = new Set<string>()
  try {
    const rows = await db
      .select({ orderId: metaCapiOutbox.orderId, resolvedAt: metaCapiOutbox.resolvedAt })
      .from(metaCapiOutbox)
      .where(inArray(metaCapiOutbox.orderId, ids))
    resolved = new Set(rows.filter(r => r.resolvedAt != null).map(r => r.orderId))
  } catch (err) {
    // A ledger read failure must not cause a send storm. Bail rather than
    // treat every order as a gap.
    console.error('[purchase-capi] reconcile: ledger read failed, skipping run', err)
    return out
  }

  for (const o of orders) {
    const id = numericOrderId(o.id)
    if (resolved.has(id)) continue

    const attr = (key: string) => o.customAttributes.find(a => a.key === key)?.value || null
    const order: PurchaseOrder = {
      id,
      totalPrice:  parseFloat(o.currentTotalPriceSet.shopMoney.amount) || 0,
      currency:    o.currentTotalPriceSet.shopMoney.currencyCode || 'USD',
      productIds:  o.lineItems.nodes.map(li => (li.product ? numericOrderId(li.product.id) : '')).filter(Boolean),
      numItems:    o.lineItems.nodes.reduce((n, li) => n + (li.quantity || 0), 0),
      fbp:         attr('_fbp'),
      fbc:         attr('_fbc'),
      clientIp:    o.clientIp,
      userAgent:   null, // Not exposed on the Admin order object.
      createdAtMs: Date.parse(o.createdAt),
    }

    out.gaps.push(id)

    if (!isWithinMetaEventWindow(order)) {
      out.tooOld.push(id)
      continue
    }
    if (dryRun) continue

    const result = await sendPurchaseWithLedger(order)
    if (result.ok) out.sent.push(id)
    else out.failed.push({ orderId: id, error: result.error ?? result.skipped ?? 'unknown' })
  }

  // A gap is not just something to fix, it is evidence the real-time path is
  // broken. Say so loudly; the reconciler papering over it is what let this go
  // unnoticed for months.
  if (out.gaps.length > 0) {
    console.warn(
      `[purchase-capi] reconcile found ${out.gaps.length} unreported purchase(s): ${out.gaps.join(', ')}` +
      ' — the order-created webhook is not delivering.',
    )
  }

  return out
}
