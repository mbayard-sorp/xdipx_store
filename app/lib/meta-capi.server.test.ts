import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendCapiEvent, hashPII, type CapiEvent } from './meta-capi.server'

const EVENT: CapiEvent = {
  event_name:    'Purchase',
  event_id:      'purchase_123',
  event_time:    1785000000,
  action_source: 'website',
  user_data:     { fbp: 'fb.1.1785000000000.42', fbc: null },
  custom_data:   { content_ids: ['9'], content_type: 'product', value: 29.18, currency: 'USD' },
}

const OLD_ENV = { ...process.env }

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  process.env['META_PIXEL_ID']   = '1619122322498289'
  process.env['META_CAPI_TOKEN'] = 'test-token'
  delete process.env['META_TEST_EVENT_CODE']
  delete process.env['VERCEL_ENV']
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...OLD_ENV }
})

describe('sendCapiEvent credentials', () => {
  it('reports missing credentials as not-ok rather than success', async () => {
    // The original bug: this returned { ok: true } and sent nothing, so a
    // misconfigured production environment looked exactly like a delivered
    // conversion.
    delete process.env['META_PIXEL_ID']
    const fetchFn = mockFetch(200, { events_received: 1 })

    const res = await sendCapiEvent(EVENT, { consentGranted: false })

    expect(res.ok).toBe(false)
    expect(res.skipped).toContain('META_PIXEL_ID')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('reports a missing token the same way', async () => {
    delete process.env['META_CAPI_TOKEN']
    const fetchFn = mockFetch(200, { events_received: 1 })

    const res = await sendCapiEvent(EVENT, { consentGranted: false })

    expect(res.ok).toBe(false)
    expect(res.skipped).toContain('META_CAPI_TOKEN')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('sendCapiEvent response handling', () => {
  it('succeeds when Meta confirms it received the event', async () => {
    mockFetch(200, { events_received: 1, fbtrace_id: 'abc' })
    await expect(sendCapiEvent(EVENT, { consentGranted: false })).resolves.toEqual({ ok: true })
  })

  it('treats HTTP 200 with events_received 0 as a failure', async () => {
    // Meta silently drops malformed events behind a 200.
    mockFetch(200, { events_received: 0, messages: ['Invalid parameter'] })

    const res = await sendCapiEvent(EVENT, { consentGranted: false })

    expect(res.ok).toBe(false)
    expect(res.error).toContain('0 events')
  })

  it('surfaces warning messages returned alongside a 200', async () => {
    mockFetch(200, { events_received: 1, messages: ['deprecated field'] })
    const res = await sendCapiEvent(EVENT, { consentGranted: false })
    expect(res.ok).toBe(false)
  })

  it('returns an error on a non-2xx', async () => {
    mockFetch(400, { error: { message: 'bad' } })
    const res = await sendCapiEvent(EVENT, { consentGranted: false })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('400')
  })

  it('never throws when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const res = await sendCapiEvent(EVENT, { consentGranted: false })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('network down')
  })
})

describe('sendCapiEvent consent and test mode', () => {
  it('strips hashed email when consent was not granted', async () => {
    const fetchFn = mockFetch(200, { events_received: 1 })
    const withEmail: CapiEvent = { ...EVENT, user_data: { ...EVENT.user_data, em: hashPII('a@b.com') } }

    await sendCapiEvent(withEmail, { consentGranted: false })

    const body = JSON.parse((fetchFn.mock.calls[0]![1] as { body: string }).body)
    expect(body.data[0].user_data.em).toBeUndefined()
  })

  it('keeps hashed email when consent was granted', async () => {
    const fetchFn = mockFetch(200, { events_received: 1 })
    const withEmail: CapiEvent = { ...EVENT, user_data: { ...EVENT.user_data, em: hashPII('a@b.com') } }

    await sendCapiEvent(withEmail, { consentGranted: true })

    const body = JSON.parse((fetchFn.mock.calls[0]![1] as { body: string }).body)
    expect(body.data[0].user_data.em).toBe(hashPII('a@b.com'))
  })

  it('does not attach test_event_code in production unless explicitly asked', async () => {
    // A stray META_TEST_EVENT_CODE in production used to divert every event
    // into Events Manager's Test Events tab and out of the live dataset.
    process.env['NODE_ENV'] = 'production'
    process.env['META_TEST_EVENT_CODE'] = 'TEST123'
    const fetchFn = mockFetch(200, { events_received: 1 })

    await sendCapiEvent(EVENT, { consentGranted: false })

    const body = JSON.parse((fetchFn.mock.calls[0]![1] as { body: string }).body)
    expect(body.test_event_code).toBeUndefined()
  })

  it('attaches test_event_code in production when testMode is requested', async () => {
    process.env['NODE_ENV'] = 'production'
    process.env['META_TEST_EVENT_CODE'] = 'TEST123'
    const fetchFn = mockFetch(200, { events_received: 1 })

    await sendCapiEvent(EVENT, { consentGranted: false, testMode: true })

    const body = JSON.parse((fetchFn.mock.calls[0]![1] as { body: string }).body)
    expect(body.test_event_code).toBe('TEST123')
  })

  it('treats a Vercel PREVIEW deploy as non-production despite NODE_ENV', async () => {
    // Vercel sets NODE_ENV=production on preview builds too. Gating on it alone
    // means a preview deployment holding real Meta credentials posts LIVE
    // conversions into the production dataset.
    process.env['NODE_ENV'] = 'production'
    process.env['VERCEL_ENV'] = 'preview'
    process.env['META_TEST_EVENT_CODE'] = 'TEST123'
    const fetchFn = mockFetch(200, { events_received: 1 })

    await sendCapiEvent(EVENT, { consentGranted: false })

    const body = JSON.parse((fetchFn.mock.calls[0]![1] as { body: string }).body)
    expect(body.test_event_code).toBe('TEST123')
  })

  it('treats a Vercel PRODUCTION deploy as live', async () => {
    process.env['NODE_ENV'] = 'production'
    process.env['VERCEL_ENV'] = 'production'
    process.env['META_TEST_EVENT_CODE'] = 'TEST123'
    const fetchFn = mockFetch(200, { events_received: 1 })

    await sendCapiEvent(EVENT, { consentGranted: false })

    const body = JSON.parse((fetchFn.mock.calls[0]![1] as { body: string }).body)
    expect(body.test_event_code).toBeUndefined()
  })
})
