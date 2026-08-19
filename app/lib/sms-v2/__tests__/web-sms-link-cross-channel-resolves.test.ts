/**
 * app/lib/sms-v2/__tests__/web-sms-link-cross-channel-resolves.test.ts
 *
 * Ticket #3916 acceptance test: once a web_conversations row carries a
 * customer_gid (the thing this ticket's linker finally writes),
 * cross-channel.server.ts's findRecentCrossChannelActivity() must resolve it
 * from the SMS side. Before this ticket that customer_gid column was always
 * null on the web path, so this lookup was structurally dead — this test
 * exercises the real cross-channel.server.ts query against a mocked DB row
 * that looks exactly like what web-sms-link.server.ts now writes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
}))

vi.mock('~/lib/db.server', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(h.rows),
          }),
        }),
      }),
    }),
  },
}))

vi.mock('~/lib/shopify.server', () => ({
  getProductByHandle: vi.fn().mockResolvedValue({ title: 'Aurora Wand' }),
}))

vi.mock('../context-builder.server', () => ({
  buildEmmaContext: vi.fn(),
}))

import { findRecentCrossChannelActivity } from '../cross-channel.server'

describe('web-originated cross-channel handoff resolves once customer_gid is linked (#3916)', () => {
  afterEach(() => {
    h.rows = []
    vi.clearAllMocks()
  })

  it('an SMS-side lookup finds the linked web_conversations row by matching customer_gid', async () => {
    const gid = 'gid://shopify/Customer/42'
    h.rows = [
      {
        conversationId: 'conv-web-1',
        currentPitchHandle: 'aurora-wand',
        stage: 'DISCOVERY',
        lastActiveAt: new Date(),
        customerGid: gid,
      },
    ]

    // currentChannel='sms' → the function looks for recent WEB activity, which
    // is exactly the row web-sms-link.server.ts writes on opt-in.
    const hint = await findRecentCrossChannelActivity(gid, 'sms')

    expect(hint).not.toBeNull()
    expect(hint?.otherChannel).toBe('web')
    expect(hint?.conversationId).toBe('conv-web-1')
    expect(hint?.topic).toMatchObject({ kind: 'product', handle: 'aurora-wand', title: 'Aurora Wand' })
  })

  it('a null customer_gid (the pre-#3916 state) never resolves anything — the structural gap this ticket closes', async () => {
    h.rows = [
      {
        conversationId: 'conv-web-1',
        currentPitchHandle: 'aurora-wand',
        stage: 'DISCOVERY',
        lastActiveAt: new Date(),
        customerGid: null,
      },
    ]

    const hint = await findRecentCrossChannelActivity(null, 'sms')
    expect(hint).toBeNull()
  })
})
