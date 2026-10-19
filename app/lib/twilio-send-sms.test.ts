/**
 * sendSms posts through the A2P messaging service when
 * TWILIO_MESSAGING_SERVICE_SID is set (Twilio then picks From from the
 * service's pool) and falls back to From=TWILIO_PHONE_NUMBER when it is not.
 * fetch is stubbed; nothing here reaches Twilio.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function stubFetch(): { body: () => URLSearchParams } {
  let captured = ''
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    captured = String(init?.body ?? '')
    return new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 })
  }))
  return { body: () => new URLSearchParams(captured) }
}

describe('sendSms sender selection', () => {
  beforeEach(() => {
    process.env['TWILIO_ACCOUNT_SID'] = 'ACtest'
    process.env['TWILIO_AUTH_TOKEN'] = 'tok'
    process.env['TWILIO_PHONE_NUMBER'] = '+16239001188'
    delete process.env['TWILIO_MESSAGING_SERVICE_SID']
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env['TWILIO_MESSAGING_SERVICE_SID']
  })

  it('uses MessagingServiceSid and no From when the service sid is set', async () => {
    process.env['TWILIO_MESSAGING_SERVICE_SID'] = 'MGtest'
    const f = stubFetch()
    const { sendSms } = await import('./twilio.server')
    expect(await sendSms('+15555550100', 'hi')).toBe('SM123')
    const b = f.body()
    expect(b.get('MessagingServiceSid')).toBe('MGtest')
    expect(b.get('From')).toBeNull()
    expect(b.get('To')).toBe('+15555550100')
    expect(b.get('Body')).toBe('hi')
  })

  it('falls back to From=TWILIO_PHONE_NUMBER without a service sid', async () => {
    const f = stubFetch()
    const { sendSms } = await import('./twilio.server')
    await sendSms('+15555550100', 'hi')
    const b = f.body()
    expect(b.get('From')).toBe('+16239001188')
    expect(b.get('MessagingServiceSid')).toBeNull()
  })

  it('throws before posting when neither sender is configured', async () => {
    delete process.env['TWILIO_PHONE_NUMBER']
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { sendSms } = await import('./twilio.server')
    await expect(sendSms('+15555550100', 'hi')).rejects.toThrow('Twilio env vars not set')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
