import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// conv-audit B1: the v2 processor must never reply with silence, and a Twilio
// webhook retry (same MessageSid) must not re-enter the pipeline.
//
// We force the turn to throw by mocking the compliance/v1 module so both the
// v2 stage path AND its v1 fallback reject. Any unguarded throw inside
// runV2Turn therefore surfaces to the public wrapper, which is exactly the
// failure mode this ticket guards. kvSetNX runs for real against its in-memory
// fallback (KV_DISABLE=1), so the SID dedup is deterministic across calls.

const processSmsMessage = vi.fn(async () => {
  throw new Error('v1 down')
})

vi.mock('~/lib/sms-processor.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/sms-processor.server')>()
  return {
    ...actual,
    isComplianceKeyword: () => false,
    // Throwing here trips the compliance short-circuit's catch, which falls
    // back to processSmsMessage (v1) — mocked above to also throw.
    isOptedOut: async () => {
      throw new Error('db down')
    },
    processSmsMessage,
  }
})

beforeAll(() => {
  // Force the in-memory KV fallback so kvSetNX is deterministic in tests.
  process.env['KV_DISABLE'] = '1'
})

afterEach(() => {
  processSmsMessage.mockClear()
})

const FRIENDLY_REPLY =
  "Something hiccuped on my end. Text me that again in a minute and I'll take another look."

async function load() {
  return import('../processor.server')
}

describe('processSmsMessageV2 reliability guards (conv-audit B1)', () => {
  it('returns a friendly reply instead of silence when the turn throws', async () => {
    const { processSmsMessageV2 } = await load()
    const result = await processSmsMessageV2({
      from: '+15550001111',
      body: 'help me pick a wand',
      twilioSid: 'SM-throw-unique-1',
      simulated: false,
    })

    expect(result.replies).toHaveLength(1)
    expect(result.reply).toBe(FRIENDLY_REPLY)
    // The route only emits EMPTY_TWIML when replies is empty — a non-empty
    // reply is precisely what keeps the customer from getting dead air.
    expect(result.replies.length).toBeGreaterThan(0)
  })

  it('treats a duplicate MessageSid as a no-op without re-entering the pipeline', async () => {
    const { processSmsMessageV2 } = await load()
    const sid = 'SM-dup-unique-1'
    const input = {
      from: '+15550002222',
      body: 'show me lubes',
      twilioSid: sid,
      simulated: false,
    }

    // First delivery: pipeline throws, so we get the friendly reply, and the
    // SID is now claimed. The mocked v1 fallback ran once.
    const first = await processSmsMessageV2(input)
    expect(first.reply).toBe(FRIENDLY_REPLY)
    const callsAfterFirst = processSmsMessage.mock.calls.length
    expect(callsAfterFirst).toBeGreaterThan(0)

    // Retry with the same SID: no-op, empty result, and the pipeline is NOT
    // re-entered (no additional v1 fallback call).
    const retry = await processSmsMessageV2(input)
    expect(retry.replies).toHaveLength(0)
    expect(retry.reply).toBeNull()
    expect(retry.outcome).toBe('empty')
    expect(processSmsMessage.mock.calls.length).toBe(callsAfterFirst)
  })

  it('does not dedupe when there is no MessageSid (simulator/web path)', async () => {
    const { processSmsMessageV2 } = await load()
    const input = {
      from: '+15550003333',
      body: 'anything',
      twilioSid: '',
      simulated: true,
    }

    // Both calls run the pipeline (and both throw → friendly reply); with no
    // SID there is nothing to dedupe on, so neither is short-circuited.
    const a = await processSmsMessageV2(input)
    const b = await processSmsMessageV2(input)
    expect(a.reply).toBe(FRIENDLY_REPLY)
    expect(b.reply).toBe(FRIENDLY_REPLY)
  })
})
