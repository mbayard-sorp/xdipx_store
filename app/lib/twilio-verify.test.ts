import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import {
  verifyTwilioSignature,
  verifyTwilioRequest,
  parseTwilioForm,
  xmlEscape,
} from '~/lib/twilio.server'

// conv-p2-webhook-tests (ticket #628): verifyTwilioRequest is the front door to
// every Twilio webhook route. These tests pin signature validation, the
// alphabetical-param concatenation Twilio signs, and the deliberate
// non-production bypass boundary — the one place a request is trusted without a
// signature, and only when no signature was sent at all.

const AUTH_TOKEN = 'test_auth_token_12345'
const ORIG_TOKEN = process.env['TWILIO_AUTH_TOKEN']
const ORIG_NODE_ENV = process.env['NODE_ENV']

/** Mirror Twilio's signing algorithm so we can forge a valid signature. */
function twilioSign(token: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('')
  return crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64')
}

function formRequest(
  params: Record<string, string>,
  headers: Record<string, string> = {},
): Request {
  const body = new URLSearchParams(params).toString()
  return new Request('https://xdipx.com/api/twilio/voice', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      // Pin the signed URL deterministically regardless of undici host defaults.
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'xdipx.com',
      ...headers,
    },
    body,
  })
}

beforeEach(() => {
  process.env['TWILIO_AUTH_TOKEN'] = AUTH_TOKEN
})

afterEach(() => {
  if (ORIG_TOKEN === undefined) delete process.env['TWILIO_AUTH_TOKEN']
  else process.env['TWILIO_AUTH_TOKEN'] = ORIG_TOKEN
  if (ORIG_NODE_ENV === undefined) delete process.env['NODE_ENV']
  else process.env['NODE_ENV'] = ORIG_NODE_ENV
})

describe('verifyTwilioSignature', () => {
  const url = 'https://xdipx.com/api/twilio/voice'
  const params = { From: '+16025551234', To: '+16025559999', CallSid: 'CA123' }

  it('accepts a correctly-signed request', () => {
    const sig = twilioSign(AUTH_TOKEN, url, params)
    expect(verifyTwilioSignature(sig, url, params)).toBe(true)
  })

  it('rejects a tampered signature of the right length', () => {
    const sig = twilioSign(AUTH_TOKEN, url, params)
    // Flip the first char but keep the length so we exercise timingSafeEqual,
    // not the length short-circuit.
    const tampered = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)
    expect(verifyTwilioSignature(tampered, url, params)).toBe(false)
  })

  it('rejects a signature of the wrong length (length guard)', () => {
    expect(verifyTwilioSignature('short', url, params)).toBe(false)
  })

  it('rejects a null signature', () => {
    expect(verifyTwilioSignature(null, url, params)).toBe(false)
  })

  it('fails closed when the auth token is unset', () => {
    delete process.env['TWILIO_AUTH_TOKEN']
    const sig = twilioSign(AUTH_TOKEN, url, params)
    expect(verifyTwilioSignature(sig, url, params)).toBe(false)
  })

  it('is sensitive to param order via alphabetical sorting', () => {
    // A signature computed over a different value must not validate.
    const good = twilioSign(AUTH_TOKEN, url, params)
    expect(verifyTwilioSignature(good, url, { ...params, CallSid: 'CA999' })).toBe(false)
  })
})

describe('verifyTwilioRequest — non-production bypass boundary', () => {
  const params = { From: '+16025551234', CallSid: 'CA1', Body: 'hi' }

  it('bypasses verification when NO signature is sent in non-production', async () => {
    process.env['NODE_ENV'] = 'development'
    const { ok, params: parsed } = await verifyTwilioRequest(formRequest(params))
    expect(ok).toBe(true)
    expect(parsed).toMatchObject(params)
  })

  it('does NOT bypass in production when no signature is sent', async () => {
    process.env['NODE_ENV'] = 'production'
    const { ok } = await verifyTwilioRequest(formRequest(params))
    expect(ok).toBe(false)
  })

  it('does NOT bypass in non-production once a signature IS present (a bad one still fails)', async () => {
    process.env['NODE_ENV'] = 'development'
    const { ok } = await verifyTwilioRequest(
      formRequest(params, { 'x-twilio-signature': 'not-a-real-signature' }),
    )
    expect(ok).toBe(false)
  })

  it('accepts a correctly-signed request in production', async () => {
    process.env['NODE_ENV'] = 'production'
    const sig = twilioSign(AUTH_TOKEN, 'https://xdipx.com/api/twilio/voice', params)
    const { ok, params: parsed } = await verifyTwilioRequest(
      formRequest(params, { 'x-twilio-signature': sig }),
    )
    expect(ok).toBe(true)
    expect(parsed).toMatchObject(params)
  })
})

describe('parseTwilioForm', () => {
  it('reads urlencoded fields and leaves the body re-readable', async () => {
    const req = formRequest({ From: '+1', Body: 'hello world' })
    const parsed = await parseTwilioForm(req)
    expect(parsed).toMatchObject({ From: '+1', Body: 'hello world' })
    // The helper clones, so the original request body is still consumable.
    const again = await parseTwilioForm(req)
    expect(again).toMatchObject({ From: '+1' })
  })
})

describe('xmlEscape', () => {
  it('escapes all five XML metacharacters', () => {
    expect(xmlEscape(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;')
  })
})
