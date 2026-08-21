import { describe, expect, it } from 'vitest'
import {
  WEBHOOK_TOPICS,
  registeredWebhookRoutes,
  webhookRegistrationDrift,
  callbackUrl,
} from './register-shopify-webhooks'

describe('shopify webhook registration map (tickets #4361 / #4594)', () => {
  it('has zero drift from the routes the server actually mounts', () => {
    // The guard against the silent-failure class: a new webhook route added to
    // createWebhookRoutes() without a WEBHOOK_TOPICS entry (or a topic left
    // behind after a route is removed) fails here, before it can ship a handler
    // that no subscription will ever deliver to.
    expect(webhookRegistrationDrift()).toEqual({ unmappedRoutes: [], staleTopics: [] })
  })

  it('maps every served route to a slash-form Shopify topic', () => {
    for (const route of registeredWebhookRoutes()) {
      const topic = WEBHOOK_TOPICS[route]
      expect(topic, `route "${route}" has no WEBHOOK_TOPICS entry`).toBeDefined()
      expect(topic).toMatch(/^[a-z_]+\/[a-z_]+$/)
    }
  })

  it('covers the currently-served topic set', () => {
    // A sanity anchor so the correspondence above cannot be satisfied by an
    // empty map on both sides.
    expect(Object.values(WEBHOOK_TOPICS).sort()).toEqual([
      'inventory_levels/update',
      'orders/create',
      'orders/fulfilled',
      'products/create',
      'products/update',
      'returns/update',
    ])
  })

  it('builds callback URLs under the /webhooks mount with no double slash', () => {
    expect(callbackUrl('https://xdipx.com', 'order-created')).toBe('https://xdipx.com/webhooks/order-created')
    expect(callbackUrl('https://xdipx.com/', 'inventory-update')).toBe('https://xdipx.com/webhooks/inventory-update')
  })
})
