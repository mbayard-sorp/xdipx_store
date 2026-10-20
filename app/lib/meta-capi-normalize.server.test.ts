/**
 * Meta normalization, hashing and the PII policy (ticket #16688).
 */
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildHashedUserData,
  leadEmailHashCookie,
  normalizeCountry,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizeState,
  normalizeZip,
  piiAllowed,
  PII_KEYS,
  requestUserData,
  sendCapiEvent,
  type CapiEvent,
} from './meta-capi.server'

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

const EVENT: CapiEvent = {
  event_name:    'Lead',
  event_id:      'lead-1',
  event_time:    1792500000,
  action_source: 'website',
  user_data:     { fbp: 'fb.1.1792500000000.42', fbc: null },
  custom_data:   { content_name: 'curious-hello' },
}

const OLD_ENV = { ...process.env }

function mockFetch() {
  const fn = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ events_received: 1 }),
    text: async () => '{"events_received":1}',
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function sentUserData(fn: ReturnType<typeof mockFetch>): Record<string, unknown> {
  return JSON.parse((fn.mock.calls[0]![1] as { body: string }).body).data[0].user_data
}

beforeEach(() => {
  process.env['META_PIXEL_ID'] = '1619122322498289'
  process.env['META_CAPI_TOKEN'] = 'test-token'
  delete process.env['META_TEST_EVENT_CODE']
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...OLD_ENV }
})

describe('Meta normalization', () => {
  it('lowercases and trims emails, and rejects non-emails', () => {
    expect(normalizeEmail('  Jane.Doe@Example.COM ')).toBe('jane.doe@example.com')
    expect(normalizeEmail('not-an-email')).toBeNull()
    expect(normalizeEmail('')).toBeNull()
  })

  it('reduces phones to digits with a country code', () => {
    expect(normalizePhone('(415) 555-0123')).toBe('14155550123')
    expect(normalizePhone('+1 415 555 0123')).toBe('14155550123')
    expect(normalizePhone('+44 20 7946 0958')).toBe('442079460958')
    expect(normalizePhone('00 44 20 7946 0958')).toBe('442079460958')
    expect(normalizePhone('555')).toBeNull()
  })

  it('keeps only lowercase letters in names, accents included', () => {
    expect(normalizeName("  O'Brien ")).toBe('obrien')
    expect(normalizeName('Mary-Ann')).toBe('maryann')
    expect(normalizeName('José')).toBe('josé')
    expect(normalizeName('  ')).toBeNull()
  })

  it('normalizes state, zip and country per Meta', () => {
    expect(normalizeState('CA')).toBe('ca')
    expect(normalizeZip('94107-1234')).toBe('94107')
    expect(normalizeZip('941071234')).toBe('94107')
    expect(normalizeZip('SW1A 1AA')).toBe('sw1a1aa')
    expect(normalizeCountry('US')).toBe('us')
    expect(normalizeCountry('USA')).toBeNull()
  })
})

describe('buildHashedUserData', () => {
  it('hashes each normalized field and omits empty ones', () => {
    expect(buildHashedUserData({
      email: 'Jane@Example.com',
      phone: '415-555-0123',
      firstName: 'Jane',
      lastName: '',
      city: 'San Francisco',
      state: 'CA',
      zip: '94107-1234',
      country: 'US',
    })).toEqual({
      em: sha('jane@example.com'),
      ph: sha('14155550123'),
      fn: sha('jane'),
      ct: sha('sanfrancisco'),
      st: sha('ca'),
      zp: sha('94107'),
      country: sha('us'),
    })
  })

  it('never hashes an existing SHA-256 digest twice', () => {
    const h = sha('jane@example.com')
    expect(buildHashedUserData({ email: h.toUpperCase() }).em).toBe(h)
  })

  it('hashes external ids, de-duplicates them, and sends an array only for several', () => {
    expect(buildHashedUserData({ externalIds: ['x1.abc.def', null, 'x1.abc.def'] }).external_id).toBe(sha('x1.abc.def'))
    expect(buildHashedUserData({ externalIds: ['x1.abc.def', 'shopify:42'] }).external_id)
      .toEqual([sha('x1.abc.def'), sha('shopify:42')])
    expect(buildHashedUserData({ externalIds: [] }).external_id).toBeUndefined()
  })
})

describe('PII policy', () => {
  it('allows hashed PII unless the visitor explicitly declined', () => {
    expect(piiAllowed('granted')).toBe(true)
    expect(piiAllowed('unset')).toBe(true)
    expect(piiAllowed('denied')).toBe(false)
  })

  it('strips every customer-information key when PII is not allowed', async () => {
    const fetchFn = mockFetch()
    await sendCapiEvent({
      ...EVENT,
      user_data: {
        ...EVENT.user_data,
        client_ip_address: '1.2.3.4',
        ...buildHashedUserData({
          email: 'a@b.com', phone: '4155550123', firstName: 'a', lastName: 'b',
          city: 'c', state: 'ca', zip: '94107', country: 'us', externalIds: ['x'],
        }),
      },
    }, { consentGranted: false })
    const ud = sentUserData(fetchFn)
    for (const k of PII_KEYS) expect(ud[k]).toBeUndefined()
    expect(ud['client_ip_address']).toBe('1.2.3.4')
    expect(ud['fbp']).toBe('fb.1.1792500000000.42')
  })

  it('keeps them when PII is allowed', async () => {
    const fetchFn = mockFetch()
    await sendCapiEvent({ ...EVENT, user_data: { ...EVENT.user_data, ...buildHashedUserData({ email: 'a@b.com' }) } }, { consentGranted: true })
    expect(sentUserData(fetchFn)['em']).toBe(sha('a@b.com'))
  })

  it('omits a null fbc rather than sending JSON null', async () => {
    const fetchFn = mockFetch()
    await sendCapiEvent(EVENT, { consentGranted: true })
    expect('fbc' in sentUserData(fetchFn)).toBe(false)
  })

  it('sends a PageView with no custom_data at all', async () => {
    const fetchFn = mockFetch()
    await sendCapiEvent({ event_name: 'PageView', event_id: 'pv-12345678', event_time: 1, action_source: 'website', user_data: {} }, { consentGranted: true })
    const sent = JSON.parse((fetchFn.mock.calls[0]![1] as { body: string }).body).data[0]
    expect(sent.event_name).toBe('PageView')
    expect('custom_data' in sent).toBe(false)
  })
})

describe('request identity', () => {
  it('builds user_data from cookies, ip and ua, with the visitor id as external_id', () => {
    const req = new Request('https://xdipx.com/products/x', {
      headers: {
        cookie: '_fbp=fb.1.1.2; _fbc=fb.1.1.abc; _xid=x1.k.z',
        'x-forwarded-for': '9.9.9.9, 10.0.0.1',
        'user-agent': 'Mozilla/5.0 Chrome/126',
      },
    })
    expect(requestUserData(req, { email: 'A@B.com' })).toEqual({
      client_ip_address: '9.9.9.9',
      client_user_agent: 'Mozilla/5.0 Chrome/126',
      fbp: 'fb.1.1.2',
      fbc: 'fb.1.1.abc',
      em: sha('a@b.com'),
      external_id: sha('x1.k.z'),
    })
  })

  it('omits what the request does not have', () => {
    expect(requestUserData(new Request('https://xdipx.com/'))).toEqual({})
  })

  it('sets the lead email hash cookie with the hash only, across xdipx subdomains', () => {
    const req = new Request('https://curious.xdipx.com/api/lead', { method: 'POST' })
    const cookie = leadEmailHashCookie(req, ' Jane@Example.com ')!
    expect(cookie).toContain(`_xem=${sha('jane@example.com')}`)
    expect(cookie).toContain('Domain=.xdipx.com')
    expect(cookie).toContain('HttpOnly')
    expect(cookie.toLowerCase()).not.toContain('jane')
    expect(leadEmailHashCookie(req, 'nope')).toBeNull()
  })
})
