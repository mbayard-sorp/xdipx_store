/**
 * Purchase customer information (ticket #16688): what reaches Meta, and when not.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildPurchaseEvent,
  customerFromAttributes,
  fromWebhookOrder,
  purchasePiiAllowed,
  type PurchaseOrder,
} from './purchase-capi.server'

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

const BASE: PurchaseOrder = {
  id:          '7147336040619',
  totalPrice:  18.98,
  currency:    'USD',
  productIds:  ['9042911232171'],
  numItems:    1,
  fbp:         null,
  fbc:         null,
  clientIp:    '2607:fb90::1',
  userAgent:   'Mozilla/5.0',
  createdAtMs: 1792440036000,
}

const attrs = (o: Record<string, string>) => (k: string) => o[k] ?? null

describe('purchasePiiAllowed', () => {
  it('follows _consent_state when the cart has it', () => {
    expect(purchasePiiAllowed(attrs({ _consent_state: 'granted' }))).toBe(true)
    expect(purchasePiiAllowed(attrs({ _consent_state: 'unset' }))).toBe(true)
    expect(purchasePiiAllowed(attrs({ _consent_state: 'denied' }))).toBe(false)
  })

  it('reads a legacy _marketing_consent=false as a decline, and silence as allowed', () => {
    expect(purchasePiiAllowed(attrs({ _marketing_consent: 'false' }))).toBe(false)
    expect(purchasePiiAllowed(attrs({ _marketing_consent: 'true' }))).toBe(true)
    expect(purchasePiiAllowed(attrs({}))).toBe(true)
  })
})

describe('customerFromAttributes', () => {
  it('prefers the logged-in customer email over the lead hash', () => {
    expect(customerFromAttributes(attrs({ _customer_email: 'a@b.com', _em_h: sha('c@d.com') })).email).toBe('a@b.com')
    expect(customerFromAttributes(attrs({ _em_h: sha('c@d.com'), _xid: 'x1.a.b' }))).toEqual({ email: sha('c@d.com'), externalIds: ['x1.a.b'] })
  })
})

describe('buildPurchaseEvent customer information', () => {
  it('hashes whatever customer information the order carries', () => {
    const e = buildPurchaseEvent({
      ...BASE,
      customer: { email: 'Jane@Example.com', city: 'Austin', state: 'TX', zip: '78701', country: 'US', externalIds: ['x1.a.b', 'shopify:42'] },
      piiAllowed: true,
    })
    expect(e.user_data.em).toBe(sha('jane@example.com'))
    expect(e.user_data.ct).toBe(sha('austin'))
    expect(e.user_data.st).toBe(sha('tx'))
    expect(e.user_data.zp).toBe(sha('78701'))
    expect(e.user_data.country).toBe(sha('us'))
    expect(e.user_data.external_id).toEqual([sha('x1.a.b'), sha('shopify:42')])
  })

  it('passes a lead email hash from the cart through without re-hashing it', () => {
    const h = sha('lead@example.com')
    expect(buildPurchaseEvent({ ...BASE, customer: { email: h } }).user_data.em).toBe(h)
  })

  it('builds no customer information at all for a shopper who declined', () => {
    const e = buildPurchaseEvent({ ...BASE, customer: { email: 'a@b.com', externalIds: ['x'] }, piiAllowed: false })
    expect(e.user_data.em).toBeUndefined()
    expect(e.user_data.external_id).toBeUndefined()
    expect(e.user_data.client_ip_address).toBe('2607:fb90::1')
  })
})

describe('fromWebhookOrder customer information', () => {
  it('reads cart attributes when Shopify redacts the order (Basic plan)', () => {
    const order = fromWebhookOrder({
      id: 7147336040619,
      total_price: '18.98',
      email: '',
      note_attributes: [
        { name: '_fbp', value: 'fb.1.1.2' },
        { name: '_xid', value: 'x1.a.b' },
        { name: '_em_h', value: sha('lead@example.com') },
        { name: '_consent_state', value: 'unset' },
      ],
    })
    expect(order.piiAllowed).toBe(true)
    const e = buildPurchaseEvent(order)
    expect(e.user_data.em).toBe(sha('lead@example.com'))
    expect(e.user_data.external_id).toBe(sha('x1.a.b'))
    expect(e.user_data.fbp).toBe('fb.1.1.2')
  })

  it('uses order fields and the customer id when Shopify does send them', () => {
    const e = buildPurchaseEvent(fromWebhookOrder({
      id: 1,
      total_price: '10.00',
      email: 'Buyer@Example.com',
      phone: '+1 (512) 555-0100',
      customer: { id: 42, first_name: 'Ana', last_name: 'Ruiz' },
      billing_address: { city: 'Austin', province_code: 'TX', zip: '78701-1111', country_code: 'US' },
    }))
    expect(e.user_data.em).toBe(sha('buyer@example.com'))
    expect(e.user_data.ph).toBe(sha('15125550100'))
    expect(e.user_data.fn).toBe(sha('ana'))
    expect(e.user_data.ln).toBe(sha('ruiz'))
    expect(e.user_data.zp).toBe(sha('78701'))
    expect(e.user_data.external_id).toBe(sha('shopify:42'))
  })

  it('sends nothing personal for a shopper who chose Essential only', () => {
    const e = buildPurchaseEvent(fromWebhookOrder({
      id: 2,
      total_price: '10.00',
      email: 'buyer@example.com',
      note_attributes: [{ name: '_consent_state', value: 'denied' }, { name: '_xid', value: 'x1.a.b' }],
    }))
    expect(e.user_data.em).toBeUndefined()
    expect(e.user_data.external_id).toBeUndefined()
  })
})
