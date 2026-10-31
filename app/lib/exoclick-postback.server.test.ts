import { describe, it, expect, vi } from 'vitest'
import { buildPostbackUrl, postbackValue, sendExoClickConversion } from './exoclick-postback.server'
import { captureExoClickId, getStoredExoClickId } from './attribution.server'
import { attributionCartAttrs } from './attribution-cart.server'

const tag = 'a'.repeat(200) + '+/='
const order = (attrs: Record<string, string> = { _exoclid: tag }) => ({
  total_price: '178.26',
  subtotal_price: '168.80',
  note_attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
})
const reply = (body: string, status = 200) => vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch
const env = { EXOCLICK_GOAL_ID: '12345' }

describe('postback url and value', () => {
  it('encodes the click id so it survives the trip', () => {
    const u = new URL(buildPostbackUrl('12345', tag, '168.80'))
    expect(u.origin + u.pathname).toBe('https://s.magsrv.com/tag.php')
    expect(u.searchParams.get('goal')).toBe('12345')
    expect(u.searchParams.get('tag')).toBe(tag)
    expect(u.searchParams.get('value')).toBe('168.80')
  })

  it('reports value before tax and shipping, falling back to the total', () => {
    expect(postbackValue(order())).toBe('168.80')
    expect(postbackValue({ total_price: '10' })).toBe('10.00')
  })
})

describe('sendExoClickConversion', () => {
  it('makes no request without a click, a goal, or consent', async () => {
    const f = reply('OK')
    expect(await sendExoClickConversion(order({}), env, f)).toEqual({ ok: true, skipped: 'no_click' })
    expect(await sendExoClickConversion(order(), {}, f)).toEqual({ ok: true, skipped: 'no_goal' })
    expect(await sendExoClickConversion(order({ _exoclid: tag, _consent_state: 'denied' }), env, f)).toEqual({ ok: true, skipped: 'no_consent' })
    expect(f).not.toHaveBeenCalled()
  })

  it('treats OK and a repeated conversion as delivered', async () => {
    expect(await sendExoClickConversion(order(), env, reply('OK'))).toEqual({ ok: true })
    expect(await sendExoClickConversion(order(), env, reply('ERROR: This conversion has already been notified and saved.'))).toEqual({ ok: true })
  })

  it('reports any other answer, even on a 200', async () => {
    expect(await sendExoClickConversion(order(), env, reply('ERROR: Tag is invalid!'))).toEqual({ ok: false, error: '200 ERROR: Tag is invalid!' })
  })

  it('never throws on a network failure', async () => {
    const f = vi.fn(async () => { throw new Error('timed out') }) as unknown as typeof fetch
    expect(await sendExoClickConversion(order(), env, f)).toEqual({ ok: false, error: 'timed out' })
  })
})

describe('click id capture', () => {
  const req = (qs: string, cookie = '') => new Request(`https://curious.xdipx.com/x${qs}`, { headers: { Cookie: cookie } })

  it('stores a real id and writes nothing without one', () => {
    expect(captureExoClickId(req(`?exoclid=${tag.slice(0, 200)}`))[0]).toContain('__xdipx_exoclid=')
    expect(captureExoClickId(req(''))).toEqual([])
  })

  it('ignores an unexpanded macro and an absurd length', () => {
    expect(captureExoClickId(req('?exoclid=%7Bconversions_tracking%7D'))).toEqual([])
    expect(captureExoClickId(req(`?exoclid=${'a'.repeat(1001)}`))).toEqual([])
  })

  it('rides onto the cart as _exoclid', () => {
    const r = req('', `__xdipx_exoclid=${encodeURIComponent(tag)}`)
    expect(getStoredExoClickId(r)).toBe(tag)
    expect(attributionCartAttrs(r)).toContainEqual({ key: '_exoclid', value: tag })
  })
})
