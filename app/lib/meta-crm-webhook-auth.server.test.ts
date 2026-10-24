import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./db.server', () => ({ db: {} }))

const { verifySubscription, verifyWebhookSignature } = await import('./meta-crm.server')

describe('verifyWebhookSignature', () => {
  beforeEach(() => { vi.stubEnv('META_APP_SECRET', 'shh'); vi.stubEnv('FACEBOOK_APP_SECRET', '') })
  afterEach(() => vi.unstubAllEnvs())

  const body = '{"object":"page","entry":[]}'
  const sign = (b: string, secret = 'shh') => `sha256=${createHmac('sha256', secret).update(b).digest('hex')}`

  it('accepts a body signed with the app secret', () => {
    expect(verifyWebhookSignature(body, sign(body))).toBe(true)
  })

  it('rejects a wrong secret, a tampered body, or no header', () => {
    expect(verifyWebhookSignature(body, sign(body, 'other'))).toBe(false)
    expect(verifyWebhookSignature(`${body} `, sign(body))).toBe(false)
    expect(verifyWebhookSignature(body, null)).toBe(false)
    expect(verifyWebhookSignature(body, 'sha1=abc')).toBe(false)
  })

  it('refuses everything when no secret is configured', () => {
    vi.stubEnv('META_APP_SECRET', '')
    expect(verifyWebhookSignature(body, sign(body, ''))).toBe(false)
  })
})

describe('verifySubscription', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('echoes the challenge only for the right verify token', () => {
    vi.stubEnv('META_WEBHOOK_VERIFY_TOKEN', 'tok')
    const ok = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '42' })
    expect(verifySubscription(ok)).toBe('42')
    expect(verifySubscription(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '42' }))).toBeNull()
  })

  it('refuses when no verify token is configured', () => {
    vi.stubEnv('META_WEBHOOK_VERIFY_TOKEN', '')
    expect(verifySubscription(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '42' }))).toBeNull()
  })
})
