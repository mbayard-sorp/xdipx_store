import { describe, it, expect } from 'vitest'
import {
  buildPurchaseEvent,
  fromWebhookOrder,
  isWithinMetaEventWindow,
  numericOrderId,
  type PurchaseOrder,
} from './purchase-capi.server'

const BASE: PurchaseOrder = {
  id:          '6959092301995',
  totalPrice:  29.18,
  currency:    'USD',
  productIds:  ['111', '222'],
  numItems:    3,
  fbp:         'fb.1.1785000000000.42',
  fbc:         'fb.1.1785000000000.CLICKID',
  clientIp:    '184.101.132.3',
  userAgent:   'Mozilla/5.0',
  createdAtMs: 1785000000000,
}

describe('buildPurchaseEvent', () => {
  it('derives a deterministic event id from the order id', () => {
    // This is the whole dedup contract: the webhook leg and the reconcile leg
    // must produce the same id or Meta counts one sale twice.
    expect(buildPurchaseEvent(BASE).event_id).toBe('purchase_6959092301995')
    expect(buildPurchaseEvent(BASE).event_id).toBe(buildPurchaseEvent({ ...BASE }).event_id)
  })

  it('reports the sale time, not the send time', () => {
    // Reconciliation can run days later; backdating keeps attribution correct.
    expect(buildPurchaseEvent(BASE).event_time).toBe(1785000000)
  })

  it('omits IP and user agent when unknown rather than sending placeholders', () => {
    const e = buildPurchaseEvent({ ...BASE, clientIp: null, userAgent: null })
    expect(e.user_data).not.toHaveProperty('client_ip_address')
    expect(e.user_data).not.toHaveProperty('client_user_agent')
  })

  it('includes IP and user agent when Shopify supplied them', () => {
    const e = buildPurchaseEvent(BASE)
    expect(e.user_data.client_ip_address).toBe('184.101.132.3')
    expect(e.user_data.client_user_agent).toBe('Mozilla/5.0')
  })

  it('carries value, currency and contents', () => {
    const e = buildPurchaseEvent(BASE)
    expect(e.custom_data).toMatchObject({
      value: 29.18, currency: 'USD', content_ids: ['111', '222'], num_items: 3, content_type: 'product',
    })
  })
})

describe('fromWebhookOrder', () => {
  it('normalizes a REST orders/create payload', () => {
    const o = fromWebhookOrder({
      id:          6959092301995,
      total_price: '29.18',
      currency:    'USD',
      created_at:  '2026-07-23T21:10:59Z',
      browser_ip:  '1.2.3.4',
      client_details: { user_agent: 'UA/1.0', browser_ip: '5.6.7.8' },
      line_items: [
        { product_id: 111, quantity: 2 },
        { product_id: 222, quantity: 1 },
      ],
      note_attributes: [
        { name: '_fbp', value: 'fb.1.1.1' },
        { name: '_fbc', value: 'fb.1.2.C' },
      ],
    })

    expect(o.id).toBe('6959092301995')
    expect(o.totalPrice).toBe(29.18)
    expect(o.productIds).toEqual(['111', '222'])
    expect(o.numItems).toBe(3)
    expect(o.fbp).toBe('fb.1.1.1')
    expect(o.fbc).toBe('fb.1.2.C')
    expect(o.createdAtMs).toBe(Date.parse('2026-07-23T21:10:59Z'))
  })

  it('prefers client_details.browser_ip over the top-level browser_ip', () => {
    const o = fromWebhookOrder({
      id: 1, total_price: '1.00',
      browser_ip: '1.1.1.1',
      client_details: { browser_ip: '2.2.2.2' },
    })
    expect(o.clientIp).toBe('2.2.2.2')
  })

  it('survives an order with no line items and no attributes', () => {
    const o = fromWebhookOrder({ id: 7, total_price: 'not-a-number' })
    expect(o.productIds).toEqual([])
    expect(o.numItems).toBe(0)
    expect(o.totalPrice).toBe(0)
    expect(o.fbp).toBeNull()
    expect(o.currency).toBe('USD')
  })

  it('drops line items with no product id', () => {
    const o = fromWebhookOrder({
      id: 1, total_price: '5.00',
      line_items: [{ quantity: 1 }, { product_id: 42, quantity: 2 }],
    })
    expect(o.productIds).toEqual(['42'])
    expect(o.numItems).toBe(3)
  })
})

describe('isWithinMetaEventWindow', () => {
  const now = 1785000000000

  it('accepts a fresh order', () => {
    expect(isWithinMetaEventWindow({ ...BASE, createdAtMs: now - 3600_000 }, now)).toBe(true)
  })

  it('rejects an order older than Meta 7 day limit', () => {
    // Guards the reconciler against sending events Meta will reject anyway.
    expect(isWithinMetaEventWindow({ ...BASE, createdAtMs: now - 8 * 86400_000 }, now)).toBe(false)
  })
})

describe('numericOrderId', () => {
  it('extracts the numeric id from a Shopify gid', () => {
    expect(numericOrderId('gid://shopify/Order/6959092301995')).toBe('6959092301995')
    expect(numericOrderId('gid://shopify/Product/111')).toBe('111')
  })

  it('passes through an already numeric id', () => {
    expect(numericOrderId('123')).toBe('123')
  })
})
