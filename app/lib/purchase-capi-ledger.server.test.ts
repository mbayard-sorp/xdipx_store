/**
 * Ledger and reconciliation behavior for the Purchase sender.
 *
 * The pure payload helpers are covered in purchase-capi.server.test.ts. What is
 * exercised here is the part that actually failed in production: whether a
 * conversion still goes out when the bookkeeping around it misbehaves.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sendCapiEvent = vi.fn()
const adminGraphQL = vi.fn()
const kvIncrBy = vi.fn()
const kvGet = vi.fn()

// Chainable drizzle stubs. Each terminal call resolves, and the whole query
// builder is replaceable per test so we can make the ledger throw on demand.
const insertValues = vi.fn()
const updateWhere = vi.fn()
const selectWhere = vi.fn()

const db = {
  insert: () => ({ values: (...a: unknown[]) => insertValues(...a) }),
  update: () => ({ set: () => ({ where: (...a: unknown[]) => updateWhere(...a) }) }),
  select: () => ({ from: () => ({ where: (...a: unknown[]) => selectWhere(...a) }) }),
}

vi.mock('./db.server', () => ({ db: new Proxy({}, { get: (_t, k) => (db as never)[k] }) }))
vi.mock('../../db/schema', () => ({
  metaCapiOutbox: { orderId: 'order_id', resolvedAt: 'resolved_at' },
}))
vi.mock('./meta-capi.server', () => ({ sendCapiEvent: (...a: unknown[]) => sendCapiEvent(...a) }))
vi.mock('./shopify.server', () => ({ adminGraphQL: (...a: unknown[]) => adminGraphQL(...a) }))
vi.mock('./kv.server', () => ({
  kvIncrBy: (...a: unknown[]) => kvIncrBy(...a),
  kvGet: (...a: unknown[]) => kvGet(...a),
}))

import {
  sendPurchaseWithLedger,
  reconcilePurchases,
  getPurchaseCapiWriteFailureCount,
  type PurchaseOrder,
} from './purchase-capi.server'

const ORDER: PurchaseOrder = {
  id: '123', totalPrice: 10, currency: 'USD', productIds: ['9'], numItems: 1,
  fbp: null, fbc: null, clientIp: null, userAgent: null, createdAtMs: Date.now(),
}

beforeEach(() => {
  vi.clearAllMocks()
  insertValues.mockReturnValue({ onConflictDoNothing: () => Promise.resolve() })
  updateWhere.mockResolvedValue(undefined)
  selectWhere.mockResolvedValue([])
  sendCapiEvent.mockResolvedValue({ ok: true })
  kvIncrBy.mockResolvedValue(1)
  kvGet.mockResolvedValue(0)
})

describe('sendPurchaseWithLedger', () => {
  it('sends even when the ledger insert throws', async () => {
    // The exact production shape this guards: migration 041 unapplied, so the
    // table does not exist. Bookkeeping must never cost a conversion.
    insertValues.mockImplementation(() => { throw new Error('relation "meta_capi_outbox" does not exist') })

    const res = await sendPurchaseWithLedger(ORDER)

    expect(sendCapiEvent).toHaveBeenCalledTimes(1)
    expect(res.ok).toBe(true)
  })

  it('sends even when the ledger update throws afterwards', async () => {
    updateWhere.mockRejectedValue(new Error('connection reset'))
    const res = await sendPurchaseWithLedger(ORDER)
    expect(res.ok).toBe(true)
  })

  it('durably records a ledger-write failure so the outage is not just a swallowed console.error', async () => {
    // The production shape from #5061: migration 082's rename was unapplied, so
    // meta_capi_outbox did not exist and every ledger insert threw. Before this
    // counter the only signal was a console.error that hid the outage for ~2
    // days. A failed insert must now bump the per-UTC-day KV counter the owner
    // digest reads.
    insertValues.mockImplementation(() => { throw new Error('relation "meta_capi_outbox" does not exist') })

    const res = await sendPurchaseWithLedger(ORDER)

    expect(res.ok).toBe(true) // bookkeeping never costs a conversion
    expect(kvIncrBy).toHaveBeenCalledWith(
      expect.stringMatching(/^purchase-capi:write-failures:\d{4}-\d{2}-\d{2}$/),
      1,
    )
  })

  it('does not record a failure when the ledger writes cleanly', async () => {
    await sendPurchaseWithLedger(ORDER)
    expect(kvIncrBy).not.toHaveBeenCalled()
  })

  it('writes the ledger row BEFORE calling Meta', async () => {
    // Ordering is the whole point: a row written only on failure cannot tell
    // you that a send was ever attempted.
    const order: string[] = []
    insertValues.mockImplementation(() => { order.push('ledger'); return { onConflictDoNothing: () => Promise.resolve() } })
    sendCapiEvent.mockImplementation(() => { order.push('send'); return Promise.resolve({ ok: true }) })

    await sendPurchaseWithLedger(ORDER)

    expect(order).toEqual(['ledger', 'send'])
  })

  it('refuses to send a payload with no order id', async () => {
    // Observed 2026-07-31: a probe body produced event_id "purchase_undefined"
    // and was actually transmitted. Meta rejected it with a 400, which was luck
    // rather than design. An id is also the dedup key, so a send without one
    // could never be reconciled.
    const res = await sendPurchaseWithLedger({ ...ORDER, id: '' })

    expect(sendCapiEvent).not.toHaveBeenCalled()
    expect(insertValues).not.toHaveBeenCalled()
    expect(res.ok).toBe(false)
    expect(res.skipped).toBe('no order id')
  })

  it('refuses the literal string undefined, which is what String(undefined) yields', async () => {
    const res = await sendPurchaseWithLedger({ ...ORDER, id: 'undefined' })
    expect(sendCapiEvent).not.toHaveBeenCalled()
    expect(res.skipped).toBe('no order id')
  })

  it('reports a failed send and does not claim success', async () => {
    sendCapiEvent.mockResolvedValue({ ok: false, error: 'Meta CAPI 400' })
    const res = await sendPurchaseWithLedger(ORDER)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('400')
  })

  it('surfaces a skipped send distinctly from a failed one', async () => {
    sendCapiEvent.mockResolvedValue({ ok: false, skipped: 'no META_PIXEL_ID' })
    const res = await sendPurchaseWithLedger(ORDER)
    expect(res.ok).toBe(false)
    expect(res.skipped).toContain('META_PIXEL_ID')
  })
})

describe('getPurchaseCapiWriteFailureCount', () => {
  it('sums the current and previous UTC-day buckets', async () => {
    kvGet.mockResolvedValueOnce(4).mockResolvedValueOnce(3)
    expect(await getPurchaseCapiWriteFailureCount()).toBe(7)
  })

  it('reads zero when KV is cold and never throws', async () => {
    kvGet.mockResolvedValue(null)
    expect(await getPurchaseCapiWriteFailureCount()).toBe(0)
    kvGet.mockRejectedValue(new Error('kv down'))
    expect(await getPurchaseCapiWriteFailureCount()).toBe(0)
  })
})

describe('reconcilePurchases', () => {
  const shopifyOrder = (id: string, createdAt: string) => ({
    id: `gid://shopify/Order/${id}`,
    createdAt,
    clientIp: '1.2.3.4',
    currentTotalPriceSet: { shopMoney: { amount: '25.00', currencyCode: 'USD' } },
    customAttributes: [{ key: '_fbp', value: 'fb.1.1.1' }],
    lineItems: { nodes: [{ quantity: 1, product: { id: 'gid://shopify/Product/9' } }] },
  })

  it('skips orders that already have a resolved ledger row', async () => {
    adminGraphQL.mockResolvedValue({ orders: { nodes: [shopifyOrder('111', new Date().toISOString())] } })
    selectWhere.mockResolvedValue([{ orderId: '111', resolvedAt: new Date() }])

    const r = await reconcilePurchases()

    expect(r.gaps).toEqual([])
    expect(sendCapiEvent).not.toHaveBeenCalled()
  })

  it('treats an unresolved row as a gap and retries it', async () => {
    adminGraphQL.mockResolvedValue({ orders: { nodes: [shopifyOrder('222', new Date().toISOString())] } })
    selectWhere.mockResolvedValue([{ orderId: '222', resolvedAt: null }])

    const r = await reconcilePurchases()

    expect(r.gaps).toEqual(['222'])
    expect(r.sent).toEqual(['222'])
  })

  it('sends nothing in dryRun but still reports the gap', async () => {
    adminGraphQL.mockResolvedValue({ orders: { nodes: [shopifyOrder('333', new Date().toISOString())] } })

    const r = await reconcilePurchases({ dryRun: true })

    expect(r.gaps).toEqual(['333'])
    expect(r.sent).toEqual([])
    expect(sendCapiEvent).not.toHaveBeenCalled()
  })

  it('refuses to send orders outside Meta 7 day window', async () => {
    const old = new Date(Date.now() - 9 * 86400_000).toISOString()
    adminGraphQL.mockResolvedValue({ orders: { nodes: [shopifyOrder('444', old)] } })

    const r = await reconcilePurchases()

    expect(r.tooOld).toEqual(['444'])
    expect(r.sent).toEqual([])
    expect(sendCapiEvent).not.toHaveBeenCalled()
  })

  it('reuses the webhook event id exactly, which is the dedup guarantee', async () => {
    adminGraphQL.mockResolvedValue({ orders: { nodes: [shopifyOrder('555', new Date().toISOString())] } })

    await reconcilePurchases()

    expect(sendCapiEvent.mock.calls[0]![0]).toMatchObject({ event_id: 'purchase_555' })
  })

  it('bails without sending when the ledger read fails', async () => {
    // A ledger read failure must not be read as "every order is a gap" and
    // trigger a send storm.
    adminGraphQL.mockResolvedValue({ orders: { nodes: [shopifyOrder('666', new Date().toISOString())] } })
    selectWhere.mockRejectedValue(new Error('db down'))

    const r = await reconcilePurchases()

    expect(sendCapiEvent).not.toHaveBeenCalled()
    expect(r.sent).toEqual([])
  })

  it('returns an empty result when the Shopify query fails', async () => {
    adminGraphQL.mockRejectedValue(new Error('Shopify 500'))
    const r = await reconcilePurchases()
    expect(r).toMatchObject({ scanned: 0, gaps: [], sent: [] })
  })
})

/**
 * The reconcile is the safety net for Purchase events the webhook missed, so it
 * is the last thing that should be taken out by someone else's rate-limit
 * burst. It was: the discovery index rebuild held Shopify's bucket near zero
 * for ~60s at a time on the same 15-minute tick, and adminGraphQL's own retry
 * (4 attempts, 5s cap) only covers ~20s, so the sweep was throttled on every
 * single run through 2026-08-05.
 */
describe('reconcilePurchases throttle resilience', () => {
  const okResponse = { orders: { nodes: [] } }

  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  const flush = async <T>(p: Promise<T>): Promise<T> => {
    await vi.runAllTimersAsync()
    return p
  }

  it('retries a THROTTLED query instead of giving up on the first one', async () => {
    adminGraphQL
      .mockRejectedValueOnce(new Error('Throttled'))
      .mockResolvedValueOnce(okResponse)

    const r = await flush(reconcilePurchases())

    expect(adminGraphQL).toHaveBeenCalledTimes(2)
    expect(r.scanned).toBe(0)
  })

  it('rides out a burst that outlasts adminGraphQL own retry budget', async () => {
    adminGraphQL
      .mockRejectedValueOnce(new Error('Throttled'))
      .mockRejectedValueOnce(new Error('Throttled'))
      .mockRejectedValueOnce(new Error('Throttled'))
      .mockResolvedValueOnce(okResponse)

    await flush(reconcilePurchases())

    // 5s + 10s + 15s of extra rest: past the ~60s the rebuild used to hold the
    // bucket down, which 4 x 5s alone never reached.
    expect(adminGraphQL).toHaveBeenCalledTimes(4)
  })

  it('gives up after the retry budget rather than looping forever', async () => {
    adminGraphQL.mockRejectedValue(new Error('Throttled'))

    const r = await flush(reconcilePurchases())

    expect(adminGraphQL).toHaveBeenCalledTimes(5) // 1 attempt + 4 retries
    expect(r.scanned).toBe(0) // failure is swallowed, the sweep reports nothing
  })

  it('does not retry a non-throttle error', async () => {
    // Retrying a bad query or an auth failure just delays the log line.
    adminGraphQL.mockRejectedValue(new Error('Field \'orders\' doesn\'t exist'))

    await flush(reconcilePurchases())

    expect(adminGraphQL).toHaveBeenCalledTimes(1)
  })
})
