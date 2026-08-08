import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IvrConfig } from '~/lib/ivr-config.server'

// conv-p2-webhook-tests (ticket #628): the voice webhook has three pre-agent
// gates (anonymous / rate-limit / after-hours), a missing-config voicemail
// fallback, and a hard never-throw guarantee (a thrown action becomes a Twilio
// "application error" or a Vercel 500). These tests cover that gate matrix
// against the emitted TwiML shapes, with db/config/voice/voicemail mocked.

const dbState = vi.hoisted(() => ({ selects: [] as unknown[][] }))
const mocks = vi.hoisted(() => ({
  getIvrConfig: vi.fn(),
  getActiveIvrVoiceId: vi.fn(),
  persistPlaceholderVoicemail: vi.fn(),
}))

vi.mock('~/lib/db.server', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve(dbState.selects.shift() ?? []) }) }),
    insert: () => ({ values: () => ({ onConflictDoNothing: () => Promise.resolve() }) }),
  },
}))
vi.mock('~/lib/ivr-config.server', () => ({ getIvrConfig: mocks.getIvrConfig }))
vi.mock('~/lib/ivr-voice.server', () => ({ getActiveIvrVoiceId: mocks.getActiveIvrVoiceId }))
vi.mock('~/lib/ivr-voicemail.server', () => ({ persistPlaceholderVoicemail: mocks.persistPlaceholderVoicemail }))

import { action } from '~/routes/api.twilio.voice'

const ENV_KEYS = ['IVR_WS_URL', 'IVR_WS_SECRET', 'APP_URL', 'TWILIO_AUTH_TOKEN', 'NODE_ENV'] as const
const savedEnv: Record<string, string | undefined> = {}

function baseConfig(overrides: Partial<IvrConfig> = {}): IvrConfig {
  return {
    maxCallsPerHour: 0, // disabled → no rate-limit db query unless a test opts in
    rateLimitAllowlist: new Set<string>(),
    smsMaxPerHour: 0,
    businessHours: '', // empty → always open unless a test sets a window
    businessTz: 'UTC',
    initialSilenceMs: 5000,
    interTurnSilenceMs: 3000,
    maxCallDurationMs: 600000,
    voicemailMaxLengthSec: 120,
    smsHistoryWindowHours: 24,
    smsHistoryTurns: 6,
    maxPrompts: 8,
    reEngageAttempts: 2,
    softTokenBudget: 4000,
    ...overrides,
  }
}

/** A business-hours window that provably excludes the current UTC hour. */
function afterHoursWindow(): string {
  const h = new Date().getUTCHours()
  return `${(h + 2) % 24}-${(h + 3) % 24}`
}

function post(params: Record<string, string>, headers: Record<string, string> = {}): Promise<Response> {
  const request = new Request('https://xdipx.com/api/twilio/voice', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(params).toString(),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  // Non-production + no signature → verifyTwilioRequest bypass, so tests focus
  // on the gate logic rather than signing.
  process.env['NODE_ENV'] = 'test'
  process.env['IVR_WS_URL'] = 'wss://ivr.example/relay'
  process.env['IVR_WS_SECRET'] = 'sekret'
  process.env['APP_URL'] = 'https://xdipx.com'
  dbState.selects = []
  mocks.getIvrConfig.mockReset().mockResolvedValue(baseConfig())
  mocks.getActiveIvrVoiceId.mockReset().mockResolvedValue('voice_abc')
  mocks.persistPlaceholderVoicemail.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]!
  }
})

async function text(res: Response): Promise<string> {
  return res.text()
}

describe('voice webhook — signature gate', () => {
  it('returns 403 when a signature is present but invalid', async () => {
    delete process.env['TWILIO_AUTH_TOKEN'] // fail-closed
    const res = await post({ From: '+16025551234', CallSid: 'CA1' }, { 'x-twilio-signature': 'bogus' })
    expect(res.status).toBe(403)
  })
})

describe('voice webhook — anonymous gate', () => {
  it('routes a blocked caller to voicemail with the anonymous intro', async () => {
    const res = await post({ From: 'anonymous', CallSid: 'CA_anon' })
    const xml = await text(res)
    expect(res.status).toBe(200)
    expect(xml).toContain('<Record')
    expect(xml).toContain('blocked number')
    expect(mocks.persistPlaceholderVoicemail).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'anonymous', callbackNumber: null }),
    )
    // Never reaches the live agent.
    expect(xml).not.toContain('<ConversationRelay')
  })

  it('treats a missing From as anonymous', async () => {
    const res = await post({ CallSid: 'CA_empty' })
    const xml = await text(res)
    expect(xml).toContain('<Record')
    expect(mocks.persistPlaceholderVoicemail).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'anonymous' }),
    )
  })
})

describe('voice webhook — rate-limit gate', () => {
  it('rejects a caller over the hourly cap with the reject TwiML', async () => {
    mocks.getIvrConfig.mockResolvedValue(baseConfig({ maxCallsPerHour: 5 }))
    dbState.selects = [[{ n: 10 }]] // count query returns 10 >= 5
    const res = await post({ From: '+16025551234', CallSid: 'CA_rl' })
    const xml = await text(res)
    expect(res.status).toBe(200)
    expect(xml).toContain('<Hangup')
    expect(xml).toContain('too many calls')
    expect(xml).not.toContain('<ConversationRelay')
  })

  it('lets an allowlisted number through the rate-limit gate', async () => {
    mocks.getIvrConfig.mockResolvedValue(
      baseConfig({ maxCallsPerHour: 1, rateLimitAllowlist: new Set(['+16025551234']) }),
    )
    dbState.selects = [[]] // getGreeting select
    const res = await post({ From: '+16025551234', CallSid: 'CA_allow' })
    const xml = await text(res)
    expect(xml).toContain('<ConversationRelay')
  })
})

describe('voice webhook — after-hours gate', () => {
  it('routes to voicemail with the after-hours intro outside business hours', async () => {
    mocks.getIvrConfig.mockResolvedValue(
      baseConfig({ businessHours: afterHoursWindow(), businessTz: 'UTC' }),
    )
    const res = await post({ From: '+16025551234', CallSid: 'CA_ah' })
    const xml = await text(res)
    expect(res.status).toBe(200)
    expect(xml).toContain('<Record')
    expect(xml).toContain('closed right now') // after-hours intro (apostrophe is XML-escaped)
    expect(mocks.persistPlaceholderVoicemail).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'after_hours' }),
    )
  })
})

describe('voice webhook — happy path', () => {
  it('emits ConversationRelay TwiML when config and gates are clear', async () => {
    dbState.selects = [[]] // getGreeting select
    const res = await post({ From: '+16025551234', CallSid: 'CA_ok' })
    const xml = await text(res)
    expect(res.status).toBe(200)
    expect(xml).toContain('<Connect>')
    expect(xml).toContain('<ConversationRelay')
    expect(xml).toContain('ttsProvider="ElevenLabs"')
    expect(xml).toContain('voice="voice_abc"')
    expect(mocks.persistPlaceholderVoicemail).not.toHaveBeenCalled()
  })
})

describe('voice webhook — missing ConversationRelay config → voicemail', () => {
  it('falls back to voicemail when IVR_WS_URL is unset', async () => {
    delete process.env['IVR_WS_URL']
    dbState.selects = [[]] // getGreeting select
    const res = await post({ From: '+16025551234', CallSid: 'CA_nocfg' })
    const xml = await text(res)
    expect(res.status).toBe(200)
    expect(xml).toContain('<Record')
    expect(xml).toContain('as soon as we can') // "unavailable" intro
    expect(mocks.persistPlaceholderVoicemail).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'unavailable' }),
    )
    expect(xml).not.toContain('<ConversationRelay')
  })

  it('falls back to voicemail when no active voice id is configured', async () => {
    mocks.getActiveIvrVoiceId.mockResolvedValue('')
    dbState.selects = [[]]
    const res = await post({ From: '+16025551234', CallSid: 'CA_novoice' })
    const xml = await text(res)
    expect(xml).toContain('<Record')
    expect(mocks.persistPlaceholderVoicemail).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'unavailable' }),
    )
  })
})

describe('voice webhook — never throws', () => {
  it('returns a valid voicemail TwiML when the config load throws', async () => {
    mocks.getIvrConfig.mockRejectedValue(new Error('neon is down'))
    const res = await post({ From: '+16025551234', CallSid: 'CA_boom' })
    const xml = await text(res)
    expect(res.status).toBe(200)
    expect(xml).toContain('<Response>')
    expect(xml).toContain('<Record')
    // Crash-path still tries to persist so the message is visible.
    expect(mocks.persistPlaceholderVoicemail).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'unavailable', callSid: 'CA_boom' }),
    )
  })
})
