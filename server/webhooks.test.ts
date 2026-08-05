import { describe, it, expect } from 'vitest'
import { isRestockCrossing, parseWebhookBody } from './webhooks'

// Guards the inventory webhook's back-in-stock branch: a notification must fire
// only on a genuine sold-out -> in-stock transition, never on routine positive
// updates or on the first time an item is ever observed.

describe('isRestockCrossing', () => {
  it('fires when a known sold-out item goes positive', () => {
    expect(isRestockCrossing(0, 5)).toBe(true)
  })

  it('fires from a negative (oversold) prior level to positive', () => {
    expect(isRestockCrossing(-2, 1)).toBe(true)
  })

  it('does not fire on a routine positive decrement (50 -> 49)', () => {
    expect(isRestockCrossing(50, 49)).toBe(false)
  })

  it('does not fire when the item is still sold out', () => {
    expect(isRestockCrossing(0, 0)).toBe(false)
    expect(isRestockCrossing(3, 0)).toBe(false)
    expect(isRestockCrossing(0, -1)).toBe(false)
  })

  it('does not fire on the first observation (unknown prior)', () => {
    expect(isRestockCrossing(null, 5)).toBe(false)
    expect(isRestockCrossing(null, 0)).toBe(false)
  })
})

// Every webhook route must ANSWER a malformed body. `JSON.parse` throwing
// inside an async Express handler writes no response at all, so the request
// hangs until Shopify's 5s budget expires, and Shopify then retry-storms an
// endpoint that can never succeed. A signed-but-malformed probe against
// production found four routes doing exactly that: order-fulfilled,
// product-created, inventory-update and returns-update.

/** Minimal Express res double: records status and the body written. */
function resDouble() {
  const sent: { status: number; body: unknown }[] = []
  const res = {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this },
    json(body: unknown) { sent.push({ status: this.statusCode, body }); return this },
  }
  return { res, sent }
}

const reqWith = (raw: string) => ({ body: Buffer.from(raw) })

describe('parseWebhookBody', () => {
  it('returns the parsed payload and writes nothing on a good body', () => {
    const { res, sent } = resDouble()
    const out = parseWebhookBody<{ id: number }>(
      reqWith('{"id":42}') as never, res as never, 'order-created',
    )
    expect(out).toEqual({ id: 42 })
    expect(sent).toEqual([])
  })

  it('answers 400 instead of hanging on a malformed body', () => {
    const { res, sent } = resDouble()
    const out = parseWebhookBody(reqWith('not-json') as never, res as never, 'inventory-update')
    expect(out).toBeNull()
    // The response is what matters: returning null alone would still hang.
    expect(sent).toEqual([{ status: 400, body: { error: 'Bad Request' } }])
  })

  it('answers on an empty body too', () => {
    const { res, sent } = resDouble()
    expect(parseWebhookBody(reqWith('') as never, res as never, 'returns-update')).toBeNull()
    expect(sent[0]!.status).toBe(400)
  })

  it('never throws, whatever the body is', () => {
    for (const raw of ['', 'not-json', '{', '[1,', 'undefined', ' ']) {
      const { res } = resDouble()
      expect(() => parseWebhookBody(reqWith(raw) as never, res as never, 'x')).not.toThrow()
    }
  })
})
