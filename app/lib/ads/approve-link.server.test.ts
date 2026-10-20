import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { APPROVE_LINK_TTL_SECONDS, buildApproveLink, signApproval, verifyApproveLink } from './approve-link.server'

const SECRET = 'test-secret'
const NOW = new Date('2026-10-19T15:00:00Z')
const nowSec = Math.floor(NOW.getTime() / 1000)

function params(link: string) {
  const u = new URL(link)
  return [u.searchParams.get('id'), u.searchParams.get('exp'), u.searchParams.get('sig')] as const
}

describe('approve links', () => {
  it('signs HMAC-SHA256(CRON_SECRET, "id.exp")', () => {
    expect(signApproval(42, 1_760_000_000, SECRET))
      .toBe(createHmac('sha256', SECRET).update('42.1760000000').digest('hex'))
  })

  it('a fresh link verifies, and lives 24 hours', () => {
    const link = buildApproveLink(42, { now: NOW, secret: SECRET, baseUrl: 'https://xdipx.com' })!
    expect(link).toMatch(/^https:\/\/xdipx\.com\/admin\/ads\/approve\?id=42&exp=\d+&sig=[0-9a-f]{64}$/)
    const [id, exp, sig] = params(link)
    expect(Number(exp)).toBe(nowSec + APPROVE_LINK_TTL_SECONDS)
    expect(verifyApproveLink(id, exp, sig, { now: NOW, secret: SECRET })).toEqual({ ok: true, id: 42, exp: Number(exp) })
    const almost = new Date(NOW.getTime() + (APPROVE_LINK_TTL_SECONDS - 1) * 1000)
    expect(verifyApproveLink(id, exp, sig, { now: almost, secret: SECRET }).ok).toBe(true)
  })

  it('refuses a tampered id, exp or signature', () => {
    const [id, exp, sig] = params(buildApproveLink(42, { now: NOW, secret: SECRET })!)
    expect(verifyApproveLink('43', exp, sig, { now: NOW, secret: SECRET })).toMatchObject({ ok: false, code: 'tampered' })
    expect(verifyApproveLink(id, String(Number(exp) + 3600), sig, { now: NOW, secret: SECRET })).toMatchObject({ ok: false, code: 'tampered' })
    const flipped = (sig![0] === 'a' ? 'b' : 'a') + sig!.slice(1)
    expect(verifyApproveLink(id, exp, flipped, { now: NOW, secret: SECRET })).toMatchObject({ ok: false, code: 'tampered' })
    expect(verifyApproveLink(id, exp, sig, { now: NOW, secret: 'other-secret' })).toMatchObject({ ok: false, code: 'tampered' })
  })

  it('refuses a correctly signed link that asks for more than 24 hours', () => {
    const exp = nowSec + 7 * 86_400
    const sig = signApproval(42, exp, SECRET)
    expect(verifyApproveLink('42', String(exp), sig, { now: NOW, secret: SECRET })).toMatchObject({ ok: false, code: 'tampered' })
  })

  it('refuses an expired link', () => {
    const [id, exp, sig] = params(buildApproveLink(42, { now: NOW, secret: SECRET })!)
    const later = new Date(NOW.getTime() + (APPROVE_LINK_TTL_SECONDS + 1) * 1000)
    const v = verifyApproveLink(id, exp, sig, { now: later, secret: SECRET })
    expect(v).toMatchObject({ ok: false, code: 'expired' })
    expect(v.ok ? '' : v.message).toMatch(/more than a day old, so nothing was approved/)
  })

  it('refuses missing or malformed parameters, and every link when there is no secret', () => {
    expect(verifyApproveLink(null, '1', 'a'.repeat(64), { now: NOW, secret: SECRET })).toMatchObject({ code: 'malformed' })
    expect(verifyApproveLink('1', 'soon', 'a'.repeat(64), { now: NOW, secret: SECRET })).toMatchObject({ code: 'malformed' })
    expect(verifyApproveLink('1', '1', 'xyz', { now: NOW, secret: SECRET })).toMatchObject({ code: 'malformed' })
    expect(verifyApproveLink('0', '1', 'a'.repeat(64), { now: NOW, secret: SECRET })).toMatchObject({ code: 'malformed' })
    expect(verifyApproveLink('1', '1', 'a'.repeat(64), { now: NOW, secret: '' })).toMatchObject({ code: 'no_secret' })
    expect(buildApproveLink(1, { now: NOW, secret: '' })).toBeNull()
  })
})
