import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { safeCompare, isSanityWebhookRequest } from '~/lib/webhook-auth.server'

const req = (headers: Record<string, string> = {}) =>
  new Request('https://xdipx.com/api/revalidate/home-seo', { method: 'POST', headers })

describe('safeCompare', () => {
  it('matches identical strings', () => {
    expect(safeCompare('s3cret', 's3cret')).toBe(true)
  })

  it('rejects a different string of the same length', () => {
    expect(safeCompare('s3cret', 's3crea')).toBe(false)
  })

  it('rejects on a length mismatch without throwing', () => {
    expect(safeCompare('short', 'a-much-longer-secret')).toBe(false)
  })

  it('rejects empty input', () => {
    expect(safeCompare('', '')).toBe(true) // degenerate, but must not throw
    expect(safeCompare('s3cret', '')).toBe(false)
  })
})

describe('isSanityWebhookRequest', () => {
  const original = process.env['SANITY_WEBHOOK_SECRET']
  beforeEach(() => {
    process.env['SANITY_WEBHOOK_SECRET'] = 'hook-secret'
  })
  afterEach(() => {
    if (original === undefined) delete process.env['SANITY_WEBHOOK_SECRET']
    else process.env['SANITY_WEBHOOK_SECRET'] = original
  })

  it('accepts a request carrying the matching secret', () => {
    expect(isSanityWebhookRequest(req({ 'x-sanity-webhook-secret': 'hook-secret' }))).toBe(true)
  })

  it('rejects a wrong secret', () => {
    expect(isSanityWebhookRequest(req({ 'x-sanity-webhook-secret': 'nope' }))).toBe(false)
  })

  it('rejects a missing header', () => {
    expect(isSanityWebhookRequest(req())).toBe(false)
  })

  it('rejects everything when the secret is unset, rather than authorising', () => {
    delete process.env['SANITY_WEBHOOK_SECRET']
    expect(isSanityWebhookRequest(req({ 'x-sanity-webhook-secret': '' }))).toBe(false)
    expect(isSanityWebhookRequest(req({ 'x-sanity-webhook-secret': 'anything' }))).toBe(false)
  })
})
