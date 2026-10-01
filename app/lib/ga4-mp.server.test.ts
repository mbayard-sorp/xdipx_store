import { describe, it, expect } from 'vitest'
import { buildGa4PurchaseBody, type Ga4PurchaseEvent } from './ga4-mp.server'

const BASE: Ga4PurchaseEvent = {
  transactionId: '7075802513579',
  value:         116.99,
  currency:      'USD',
  items:         [{ item_id: '111', item_name: 'Thing', price: 116.99, quantity: 1 }],
}

// ticket #12670: a Measurement Protocol purchase with no session_id is never
// joined to a session and lands in GA4's "Unassigned" channel, which is what
// hid every real purchase (including the two AI Assistant orders) from the
// strategy brief's channel reports.
describe('buildGa4PurchaseBody', () => {
  it('includes session_id and engagement_time_msec when a session id is present', () => {
    const body = buildGa4PurchaseBody({ ...BASE, sessionId: '1696152000' }, 'cid.1')
    expect(body.events[0]!.params).toMatchObject({
      session_id: '1696152000',
      engagement_time_msec: 1,
    })
  })

  it('omits session_id and engagement_time_msec when no session id is present', () => {
    const body = buildGa4PurchaseBody({ ...BASE, sessionId: null }, 'cid.1')
    expect(body.events[0]!.params).not.toHaveProperty('session_id')
    expect(body.events[0]!.params).not.toHaveProperty('engagement_time_msec')
  })

  it('still carries the core ecommerce params regardless of session id', () => {
    const body = buildGa4PurchaseBody(BASE, 'cid.1')
    expect(body.client_id).toBe('cid.1')
    expect(body.events[0]!.params).toMatchObject({
      transaction_id: '7075802513579',
      value:          116.99,
      currency:       'USD',
      items:          BASE.items,
    })
  })
})
