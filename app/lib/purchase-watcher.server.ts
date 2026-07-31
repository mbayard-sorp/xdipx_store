/**
 * Conversion-delivery watcher (ticket #590).
 *
 * Nothing watched whether Purchase conversions were actually delivered, which
 * is how Meta CAPI Purchase stayed dead for two months undetected. This runs
 * from the /cron/log-monitor handler (every 15 min) and checks four signals
 * that the server-side conversion path is broken:
 *
 *   1. unresolved `meta_capi_failures` rows older than STALE_MINUTES;
 *   2. the same for `ga4_purchase_failures`;
 *   3. a recent-order gap: Shopify reports paid orders in the last window, but
 *      one or more of them left no `order_line_items` row, which the webhook
 *      writes on every processed order. Absence of that row means the webhook
 *      path never processed the order, i.e. it is dead right now;
 *   4. the fallback-stub marker in recent logs (a misconfigured Shopify webhook
 *      subscription hitting the React Router stub route).
 *
 * CRITICAL DESIGN CONSTRAINT: this store does single-digit daily orders, so a
 * day with zero Purchase events is a normal day and must never page anyone. We
 * distinguish no-sales from sales-not-reported using Shopify ground truth: the
 * scanned count of paid orders in the window. We only treat a recent-order gap
 * as P0 when scanned > 0 AND the gap survives GAP_STRIKE_THRESHOLD consecutive
 * runs, to avoid both false alarms from webhook processing lag and the alarm
 * fatigue that killed the earlier healthcheck.
 *
 * Routing: P0 (webhook dead with live orders, checks 3 and 4) pages by email
 * AND SMS; P1 (historical / individual send failures, checks 1 and 2) is email
 * only. Neither opens a GitHub issue: these are operational alerts, not bug
 * reports. Both channels are non-throwing by contract and each alert fires at
 * most once per episode.
 */

import { and, inArray, isNull, lt } from 'drizzle-orm'

import { db } from './db.server'
import { kvGet, kvSet } from './kv.server'
import { ga4PurchaseFailures, metaCapiFailures, orderLineItems } from '../../db/schema'

/** Recent-order window for the ground-truth scan (check 3), minutes. */
const RECENT_WINDOW_MINUTES = 60
/** A failure row must be older than this to count as "stuck" (checks 1 and 2). */
const STALE_MINUTES = 60
/** Consecutive runs a recent-order gap must survive before it pages (check 3). */
const GAP_STRIKE_THRESHOLD = 2
/** Cap the strike counter so it never grows unbounded while a fault persists. */
const GAP_STRIKE_CAP = GAP_STRIKE_THRESHOLD + 1
/** KV key holding the cross-run watcher state. */
const STATE_KEY = 'purchase-watcher:state'
/**
 * Substring of the fallback-stub log line emitted by
 * app/routes/api.webhooks.order-created.tsx. Matched as a prefix so a change to
 * the trailing guidance text cannot silence the check.
 */
const STUB_MARKER = '[rr-webhook] orders/create hit the fallback stub'

export interface PurchaseWatchState {
  /** Consecutive runs a recent-order gap has been observed. */
  gapStrikes: number
  /** Whether the current P0 episode has already paged (dedupe). */
  p0Alerted: boolean
  /** Fingerprint of the stale-failure order-id set we last emailed about. */
  p1Fingerprint: string
}

const EMPTY_STATE: PurchaseWatchState = { gapStrikes: 0, p0Alerted: false, p1Fingerprint: '' }

export interface PurchaseWatchInputs {
  /**
   * Paid Shopify orders in the recent window (ground-truth "scanned"). `null`
   * means the Shopify query failed and the count is unknown this run — the
   * gap check then makes no claim and carries the prior strike count forward.
   */
  recentPaidOrders: number | null
  /** Ids of recent paid orders with no `order_line_items` row (the gap set). */
  gapOrderIds: string[]
  /** Unresolved, stale `meta_capi_failures` order ids. */
  staleCapiOrderIds: string[]
  /** Unresolved, stale `ga4_purchase_failures` order ids. */
  staleGa4OrderIds: string[]
  /** True when the fallback-stub marker appeared in recent logs. */
  stubMarkerSeen: boolean
  /** Prior persisted state. */
  prior: PurchaseWatchState
}

export interface PurchaseWatchDecision {
  /** State to persist for the next run. */
  next: PurchaseWatchState
  /** Fire a P0 alert (email + SMS) this run. */
  p0Alert: boolean
  p0Reason: string
  /** Fire a P1 alert (email only) this run. */
  p1Alert: boolean
  p1Reason: string
}

/** Stable fingerprint of an order-id set, order-independent. */
function fingerprint(ids: string[]): string {
  return [...new Set(ids)].sort().join(',')
}

/**
 * Pure decision core. Given this run's observations and the prior state,
 * decide what to persist and which alerts to fire. Kept side-effect free so it
 * can be exercised in isolation (no Shopify, DB, KV, or alert IO).
 */
export function evaluatePurchaseWatch(input: PurchaseWatchInputs): PurchaseWatchDecision {
  const { recentPaidOrders, gapOrderIds, staleCapiOrderIds, staleGa4OrderIds, stubMarkerSeen, prior } = input

  // ── Check 3: recent-order gap (only when Shopify confirmed live sales) ──────
  // `null` scanned = unknown this run; leave the strike count untouched rather
  // than resetting it, so a transient Shopify hiccup cannot mask a real gap.
  let gapStrikes = prior.gapStrikes
  const gapPresent = recentPaidOrders !== null && recentPaidOrders > 0 && gapOrderIds.length > 0
  if (recentPaidOrders !== null) {
    gapStrikes = gapPresent ? Math.min(prior.gapStrikes + 1, GAP_STRIKE_CAP) : 0
  }

  // ── P0: webhook path dead with live orders (check 3 sustained, or check 4) ──
  const gapSustained = gapStrikes >= GAP_STRIKE_THRESHOLD
  const webhookDead = gapSustained || stubMarkerSeen
  const p0Alert = webhookDead && !prior.p0Alerted

  const p0Reasons: string[] = []
  if (stubMarkerSeen) {
    p0Reasons.push('Shopify orders/create is hitting the React Router fallback stub — a webhook subscription is misconfigured and orders are being swallowed (no profit metafields, no CAPI, no GA4).')
  }
  if (gapSustained) {
    p0Reasons.push(
      `Shopify reports ${recentPaidOrders} paid order(s) in the last ${RECENT_WINDOW_MINUTES} min, but ${gapOrderIds.length} left no order_line_items row across ${GAP_STRIKE_THRESHOLD} consecutive runs — the order-created webhook is not processing live orders. Missing: ${gapOrderIds.slice(0, 10).join(', ')}.`,
    )
  }

  // ── P1: stuck individual send failures (checks 1 and 2), email only ─────────
  const staleAll = [...staleCapiOrderIds, ...staleGa4OrderIds]
  const p1Fingerprint = fingerprint(staleAll)
  const p1HasNews = staleAll.length > 0 && p1Fingerprint !== prior.p1Fingerprint
  // A live P0 already pages the urgent owner; don't stack a P1 email on top of
  // it in the same run. P1 will surface on a later run if it persists.
  const p1Alert = p1HasNews && !p0Alert

  const p1Reasons: string[] = []
  if (staleCapiOrderIds.length > 0) {
    p1Reasons.push(`${staleCapiOrderIds.length} Meta CAPI Purchase send(s) unresolved for over ${STALE_MINUTES} min (orders ${staleCapiOrderIds.slice(0, 10).join(', ')}).`)
  }
  if (staleGa4OrderIds.length > 0) {
    p1Reasons.push(`${staleGa4OrderIds.length} GA4 Purchase send(s) unresolved for over ${STALE_MINUTES} min (orders ${staleGa4OrderIds.slice(0, 10).join(', ')}).`)
  }

  return {
    next: {
      gapStrikes,
      // Latch the P0 flag while the fault persists so we page once per episode;
      // clearing it on recovery re-arms the alert for the next episode.
      p0Alerted: webhookDead,
      // Advance the P1 fingerprint only when we actually emailed, so a set that
      // grows later still re-alerts, but the identical set does not.
      p1Fingerprint: p1Alert ? p1Fingerprint : (staleAll.length > 0 ? prior.p1Fingerprint : ''),
    },
    p0Alert,
    p0Reason: p0Reasons.join(' '),
    p1Alert,
    p1Reason: p1Reasons.join(' '),
  }
}

export interface PurchaseWatchRunResult {
  scanned: number | null
  gapOrderIds: string[]
  staleCapi: number
  staleGa4: number
  stubMarkerSeen: boolean
  gapStrikes: number
  p0Alerted: boolean
  p1Alerted: boolean
}

/** Load persisted state, tolerating a cold or evicted KV. */
async function loadState(): Promise<PurchaseWatchState> {
  const raw = await kvGet<Partial<PurchaseWatchState>>(STATE_KEY).catch(() => null)
  if (!raw) return { ...EMPTY_STATE }
  return {
    gapStrikes: typeof raw.gapStrikes === 'number' ? raw.gapStrikes : 0,
    p0Alerted: raw.p0Alerted === true,
    p1Fingerprint: typeof raw.p1Fingerprint === 'string' ? raw.p1Fingerprint : '',
  }
}

/**
 * Paid Shopify orders created in the last RECENT_WINDOW_MINUTES, by legacy
 * (REST) id — the same id the webhook stores as `order_line_items.shopify_order_id`.
 * Returns `null` on any failure so the caller treats the count as unknown
 * rather than as zero.
 */
async function fetchRecentPaidOrderIds(now: number): Promise<string[] | null> {
  try {
    const { adminGraphQL } = await import('./shopify.server')
    const sinceIso = new Date(now - RECENT_WINDOW_MINUTES * 60_000).toISOString()
    const query = `created_at:>='${sinceIso}' financial_status:paid status:any`
    const res = await adminGraphQL<{
      orders?: { nodes?: Array<{ legacyResourceId?: string | null }> }
    }>(
      `query RecentPaidOrders($query: String!) {
        orders(first: 50, query: $query, sortKey: CREATED_AT, reverse: true) {
          nodes { legacyResourceId }
        }
      }`,
      { query },
    )
    return (res.orders?.nodes ?? [])
      .map(n => (n.legacyResourceId ? String(n.legacyResourceId) : ''))
      .filter(Boolean)
  } catch (err) {
    console.warn('[purchase-watcher] recent-orders scan failed (treating scanned as unknown):', String(err).slice(0, 200))
    return null
  }
}

/** Which of the given order ids have no `order_line_items` row (the gap set). */
async function findGapOrderIds(orderIds: string[]): Promise<string[]> {
  if (orderIds.length === 0) return []
  const rows = await db
    .selectDistinct({ id: orderLineItems.shopifyOrderId })
    .from(orderLineItems)
    .where(inArray(orderLineItems.shopifyOrderId, orderIds))
  const processed = new Set(rows.map(r => r.id))
  return orderIds.filter(id => !processed.has(id))
}

/** True if the fallback-stub marker appears in recent Vercel logs (check 4). */
async function detectStubMarker(): Promise<boolean> {
  try {
    const { fetchRecentLogs } = await import('./log-monitor.server')
    const logs = await fetchRecentLogs({ windowMinutes: RECENT_WINDOW_MINUTES })
    return logs.some(l => l.message.includes(STUB_MARKER))
  } catch (err) {
    console.warn('[purchase-watcher] log scan for stub marker failed (skipping check 4):', String(err).slice(0, 200))
    return false
  }
}

/**
 * Run the conversion-delivery watcher once. Non-throwing by contract: any
 * gathering failure degrades that single check rather than breaking the cron.
 */
export async function runPurchaseWatcher(now: number = Date.now()): Promise<PurchaseWatchRunResult> {
  const staleBefore = new Date(now - STALE_MINUTES * 60_000)

  const [prior, recentIds, staleCapiRows, staleGa4Rows] = await Promise.all([
    loadState(),
    fetchRecentPaidOrderIds(now),
    db.select({ id: metaCapiFailures.orderId })
      .from(metaCapiFailures)
      .where(and(isNull(metaCapiFailures.resolvedAt), lt(metaCapiFailures.createdAt, staleBefore)))
      .catch((err): Array<{ id: string }> => {
        console.warn('[purchase-watcher] meta_capi_failures query failed:', String(err).slice(0, 200))
        return []
      }),
    db.select({ id: ga4PurchaseFailures.orderId })
      .from(ga4PurchaseFailures)
      .where(and(isNull(ga4PurchaseFailures.resolvedAt), lt(ga4PurchaseFailures.createdAt, staleBefore)))
      .catch((err): Array<{ id: string }> => {
        console.warn('[purchase-watcher] ga4_purchase_failures query failed:', String(err).slice(0, 200))
        return []
      }),
  ])

  const gapOrderIds = recentIds && recentIds.length > 0 ? await findGapOrderIds(recentIds) : []
  const stubMarkerSeen = await detectStubMarker()

  const staleCapiOrderIds = staleCapiRows.map(r => r.id)
  const staleGa4OrderIds = staleGa4Rows.map(r => r.id)

  const decision = evaluatePurchaseWatch({
    recentPaidOrders: recentIds === null ? null : recentIds.length,
    gapOrderIds,
    staleCapiOrderIds,
    staleGa4OrderIds,
    stubMarkerSeen,
    prior,
  })

  await kvSet(STATE_KEY, decision.next).catch(err =>
    console.warn('[purchase-watcher] KV state write failed:', String(err).slice(0, 200)),
  )

  if (decision.p0Alert) {
    const { sendOwnerEmail, sendOwnerSms, escapeHtml } = await import('./owner-alerts.server')
    await sendOwnerSms(`xdipx P0: purchase webhook path appears DEAD with live orders. ${decision.p0Reason}`.slice(0, 300))
    await sendOwnerEmail(
      '[P0] xdipx conversion tracking: purchase webhook path appears dead',
      `<p>The server-side Purchase conversion path is not delivering while the store has live orders.</p><p>${escapeHtml(decision.p0Reason)}</p>`,
      { fromName: 'xdipx ops' },
    )
  } else if (decision.p1Alert) {
    const { sendOwnerEmail, escapeHtml } = await import('./owner-alerts.server')
    await sendOwnerEmail(
      '[P1] xdipx conversion tracking: unresolved Purchase send failures',
      `<p>Individual Purchase conversions have failed to send and remain unresolved.</p><p>${escapeHtml(decision.p1Reason)}</p>`,
      { fromName: 'xdipx ops' },
    )
  }

  return {
    scanned: recentIds === null ? null : recentIds.length,
    gapOrderIds,
    staleCapi: staleCapiOrderIds.length,
    staleGa4: staleGa4OrderIds.length,
    stubMarkerSeen,
    gapStrikes: decision.next.gapStrikes,
    p0Alerted: decision.p0Alert,
    p1Alerted: decision.p1Alert,
  }
}
