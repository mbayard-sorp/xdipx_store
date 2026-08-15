/**
 * app/lib/sms-v2/__tests__/conversation-agent-ungrounded-price.test.ts
 *
 * Ticket #3216: a voice/SMS turn may not speak a product price that did not come
 * from a logged tool result. The verified failure was turn 1551 — a
 * RECONNECT→DISCOVERY turn with tool_calls NULL that spoke three named products
 * with exact prices (one accidentally real, two invented). The fabrication guard
 * only stripped URLs, so a spoken price sailed through.
 *
 * isUngroundedPricePitch is the invariant that closes it: when the Sonnet loop
 * surfaced zero product cards, any $-price in the reply is ungrounded and the
 * caller-facing reply is replaced with the recovery line. Heavy server-only
 * imports are mocked so the pure guard can be imported and exercised directly.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('~/lib/db.server', () => ({ db: {} }))
vi.mock('~/lib/shopify.server', () => ({}))
vi.mock('~/lib/ai-agent/prompt', () => ({ BRAND_VOICE: 'BRAND_VOICE_STUB' }))
vi.mock('../token-log.server', () => ({ logApiTokens: vi.fn() }))
vi.mock('../conversation-history.server', () => ({ loadConversationHistory: vi.fn(async () => []) }))
vi.mock('../slot-extractor.server', () => ({ extractSlots: vi.fn(async () => null) }))

import { isUngroundedPricePitch } from '../conversation-agent.server'

describe('isUngroundedPricePitch (#3216)', () => {
  // turn 1551, verbatim shape: a pitch with exact prices and no tool call.
  const turn1551 =
    'The Prowler Prostate Rechargeable Remote Control Massager is $137.99, ' +
    'the Prowler Plus with Dual Cock Ring is $134.99, and the Rechargeable Revo Extreme is $198.99.'

  it('catches a priced pitch spoken with zero tool cards (the verified bug)', () => {
    expect(isUngroundedPricePitch(turn1551, 0)).toBe(true)
  })

  it('does NOT fire once a tool surfaced at least one card', () => {
    // Same prose, but a searchProducts/getProductDetails result backs it this turn.
    expect(isUngroundedPricePitch(turn1551, 1)).toBe(false)
    expect(isUngroundedPricePitch(turn1551, 3)).toBe(false)
  })

  it('is silent when a no-tool turn quotes no price (normal discovery)', () => {
    expect(isUngroundedPricePitch('What matters most to you — power, quiet, or something beginner-friendly?', 0)).toBe(false)
    expect(isUngroundedPricePitch('Tell me a little about what you are hoping for.', 0)).toBe(false)
  })

  it('matches common price shapes', () => {
    expect(isUngroundedPricePitch('It runs $198.99.', 0)).toBe(true)
    expect(isUngroundedPricePitch('Around $60 even.', 0)).toBe(true)
    expect(isUngroundedPricePitch('That one is $1,299.50.', 0)).toBe(true)
    expect(isUngroundedPricePitch('Just $ 45.', 0)).toBe(true)
  })

  it('does not trip on a bare dollar sign or a dollar word', () => {
    expect(isUngroundedPricePitch('Worth every dollar in my book.', 0)).toBe(false)
    expect(isUngroundedPricePitch('It is a great value.', 0)).toBe(false)
  })

  it('tolerates empty/nullish prose', () => {
    expect(isUngroundedPricePitch('', 0)).toBe(false)
    // @ts-expect-error exercising the nullish guard
    expect(isUngroundedPricePitch(undefined, 0)).toBe(false)
  })
})
