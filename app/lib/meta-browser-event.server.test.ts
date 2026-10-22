import { describe, expect, it } from 'vitest'
import { isAllowedEventOrigin, isTrackablePath, parseBrowserEvent } from './meta-browser-event.server'

const ID = '3f2b8c1e-8a4d-4f0b-9d1e-2c3b4a5d6e7f'

describe('parseBrowserEvent', () => {
  it('accepts a PageView from the storefront and the bridge host', () => {
    expect(parseBrowserEvent({ event_name: 'PageView', event_id: ID, event_source_url: 'https://xdipx.com/collections/wands?x=1' }))
      .toEqual({ eventName: 'PageView', eventId: ID, eventSourceUrl: 'https://xdipx.com/collections/wands?x=1' })
    expect(parseBrowserEvent({ event_name: 'PageView', event_id: ID, event_source_url: 'https://curious.xdipx.com/hello' })).not.toBeNull()
  })

  it('accepts a bounded ViewContent and fixes content_type', () => {
    const ev = parseBrowserEvent({
      event_name: 'ViewContent',
      event_id: ID,
      event_source_url: 'https://xdipx.com/products/wand',
      custom_data: { content_ids: ['9042911232171'], content_type: 'anything', value: 39.5, currency: 'USD' },
    })
    expect(ev?.customData).toEqual({ content_ids: ['9042911232171'], content_type: 'product', value: 39.5, currency: 'USD' })
  })

  it('rejects event names the browser has no business sending', () => {
    for (const name of ['Purchase', 'Lead', 'AddToCart', 'InitiateCheckout']) {
      expect(parseBrowserEvent({ event_name: name, event_id: ID, event_source_url: 'https://xdipx.com/' })).toBeNull()
    }
  })

  it('rejects foreign or non-trackable source urls', () => {
    expect(parseBrowserEvent({ event_name: 'PageView', event_id: ID, event_source_url: 'https://evil.example/' })).toBeNull()
    expect(parseBrowserEvent({ event_name: 'PageView', event_id: ID, event_source_url: 'http://xdipx.com/' })).toBeNull()
    expect(parseBrowserEvent({ event_name: 'PageView', event_id: ID, event_source_url: 'https://xdipx.com/admin/ads' })).toBeNull()
    expect(parseBrowserEvent({ event_name: 'PageView', event_id: ID, event_source_url: 'not a url' })).toBeNull()
  })

  it('accepts a preview host only when the caller allows it', () => {
    const body = { event_name: 'PageView', event_id: ID, event_source_url: 'https://xdipx-git-x.vercel.app/' }
    expect(parseBrowserEvent(body)).toBeNull()
    expect(parseBrowserEvent(body, new Set(['xdipx-git-x.vercel.app']))).not.toBeNull()
  })

  it('rejects malformed ids and unbounded ViewContent payloads', () => {
    const base = { event_name: 'ViewContent', event_source_url: 'https://xdipx.com/products/x' }
    expect(parseBrowserEvent({ ...base, event_id: 'short', custom_data: { content_ids: ['1'], value: 1 } })).toBeNull()
    expect(parseBrowserEvent({ ...base, event_id: ID })).toBeNull()
    expect(parseBrowserEvent({ ...base, event_id: ID, custom_data: { content_ids: [], value: 1 } })).toBeNull()
    expect(parseBrowserEvent({ ...base, event_id: ID, custom_data: { content_ids: Array(21).fill('1'), value: 1 } })).toBeNull()
    expect(parseBrowserEvent({ ...base, event_id: ID, custom_data: { content_ids: ['<script>'], value: 1 } })).toBeNull()
    expect(parseBrowserEvent({ ...base, event_id: ID, custom_data: { content_ids: ['1'], value: -1 } })).toBeNull()
    expect(parseBrowserEvent({ ...base, event_id: ID, custom_data: { content_ids: ['1'], value: 1, currency: 'usd' } })).toBeNull()
    expect(parseBrowserEvent(null)).toBeNull()
  })
})

describe('isTrackablePath', () => {
  it('excludes admin, api, cron and webhook paths', () => {
    expect(isTrackablePath('/')).toBe(true)
    expect(isTrackablePath('/products/x')).toBe(true)
    expect(isTrackablePath('/administer')).toBe(true)
    expect(isTrackablePath('/admin')).toBe(false)
    expect(isTrackablePath('/admin/ads')).toBe(false)
    expect(isTrackablePath('/api/cart')).toBe(false)
    expect(isTrackablePath('/cron/warm')).toBe(false)
  })
})

describe('isAllowedEventOrigin', () => {
  it('allows the store hosts and xdipx previews in production, anything outside it', () => {
    expect(isAllowedEventOrigin('https://xdipx.com', true)).toBe(true)
    expect(isAllowedEventOrigin('https://curious.xdipx.com', true)).toBe(true)
    expect(isAllowedEventOrigin('https://xdipx-abc.vercel.app', true)).toBe(true)
    expect(isAllowedEventOrigin('https://evil.example', true)).toBe(false)
    expect(isAllowedEventOrigin(null, true)).toBe(false)
    expect(isAllowedEventOrigin(null, false)).toBe(true)
  })
})
