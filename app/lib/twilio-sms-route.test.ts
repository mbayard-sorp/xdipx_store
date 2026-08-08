import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// conv-p2-webhook-tests (ticket #628): the SMS webhook routes each message
// through pipeline selection (v1/v2), a kill-switch branch that must still honor
// carrier compliance keywords, and a never-throw guard that degrades to empty
// TwiML. These tests cover that matrix with the processors, kill switch, and
// pipeline flag mocked.

const mocks = vi.hoisted(() => ({
  processSmsMessage: vi.fn(),
  isComplianceKeyword: vi.fn(),
  isOptedOut: vi.fn(),
  getKillSwitch: vi.fn(),
  processSmsMessageV2: vi.fn(),
  withTurnLogging: vi.fn(),
  pickPipelineVersion: vi.fn(),
}))

vi.mock('~/lib/sms-processor.server', () => ({
  processSmsMessage: mocks.processSmsMessage,
  isComplianceKeyword: mocks.isComplianceKeyword,
  isOptedOut: mocks.isOptedOut,
}))
vi.mock('~/lib/team.server', () => ({ getKillSwitch: mocks.getKillSwitch }))
vi.mock('~/lib/sms-v2/processor.server', () => ({ processSmsMessageV2: mocks.processSmsMessageV2 }))
vi.mock('~/lib/sms-v2/turn-logger.server', () => ({ withTurnLogging: mocks.withTurnLogging }))
vi.mock('~/lib/sms-v2/pipeline-flag.server', () => ({ pickPipelineVersion: mocks.pickPipelineVersion }))

import { action } from '~/routes/api.twilio.sms'

const ORIG_NODE_ENV = process.env['NODE_ENV']

function post(params: Record<string, string>, headers: Record<string, string> = {}): Promise<Response> {
  const request = new Request('https://xdipx.com/api/twilio/sms', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(params).toString(),
  })
  return action({ request, params: {}, context: {} } as never) as Promise<Response>
}

beforeEach(() => {
  process.env['NODE_ENV'] = 'test' // no signature → verify bypass
  for (const m of Object.values(mocks)) m.mockReset()
  // Sensible defaults; individual tests override.
  mocks.pickPipelineVersion.mockReturnValue('v1')
  mocks.getKillSwitch.mockResolvedValue(true) // agent ON
  mocks.isComplianceKeyword.mockReturnValue(false)
  mocks.isOptedOut.mockResolvedValue(false)
  mocks.withTurnLogging.mockResolvedValue({ replies: [] })
  mocks.processSmsMessageV2.mockResolvedValue({ replies: [] })
})

afterEach(() => {
  if (ORIG_NODE_ENV === undefined) delete process.env['NODE_ENV']
  else process.env['NODE_ENV'] = ORIG_NODE_ENV
})

describe('sms webhook — signature gate', () => {
  it('returns 403 on an invalid signature', async () => {
    delete process.env['TWILIO_AUTH_TOKEN']
    const res = await post({ From: '+1', Body: 'hi' }, { 'x-twilio-signature': 'bogus' })
    expect(res.status).toBe(403)
  })
})

describe('sms webhook — pipeline routing (agent on)', () => {
  it('routes to v1 via withTurnLogging when the flag picks v1', async () => {
    mocks.pickPipelineVersion.mockReturnValue('v1')
    mocks.withTurnLogging.mockResolvedValue({ replies: [{ body: 'reply from v1' }] })
    const res = await post({ From: '+16025551234', Body: 'hello', MessageSid: 'SM1' })
    const xml = await res.text()
    expect(xml).toContain('<Message><Body>reply from v1</Body></Message>')
    expect(mocks.withTurnLogging).toHaveBeenCalledWith(
      expect.objectContaining({ from: '+16025551234', body: 'hello', twilioSid: 'SM1' }),
      mocks.processSmsMessage,
      'v1',
    )
    expect(mocks.processSmsMessageV2).not.toHaveBeenCalled()
  })

  it('routes to v2 when the flag picks v2', async () => {
    mocks.pickPipelineVersion.mockReturnValue('v2')
    mocks.processSmsMessageV2.mockResolvedValue({ replies: [{ body: 'reply from v2' }] })
    const res = await post({ From: '+16025551234', Body: 'hello', MessageSid: 'SM2' })
    const xml = await res.text()
    expect(xml).toContain('reply from v2')
    expect(mocks.processSmsMessageV2).toHaveBeenCalledTimes(1)
    expect(mocks.withTurnLogging).not.toHaveBeenCalled()
  })

  it('attaches a <Media> child for MMS segments', async () => {
    mocks.processSmsMessageV2.mockResolvedValue({
      replies: [{ body: 'check this out', mediaUrl: 'https://cdn.example/pic.jpg' }],
    })
    mocks.pickPipelineVersion.mockReturnValue('v2')
    const xml = await (await post({ From: '+1', Body: 'x' })).text()
    expect(xml).toContain('<Media>https://cdn.example/pic.jpg</Media>')
  })

  it('returns empty TwiML when the pipeline produces no replies', async () => {
    mocks.withTurnLogging.mockResolvedValue({ replies: [] })
    const xml = await (await post({ From: '+1', Body: 'x' })).text()
    expect(xml).toContain('<Response></Response>')
    expect(xml).not.toContain('<Message>')
  })
})

describe('sms webhook — kill switch off', () => {
  beforeEach(() => {
    mocks.getKillSwitch.mockResolvedValue(false) // agent OFF
  })

  it('still routes carrier compliance keywords through v1', async () => {
    mocks.isComplianceKeyword.mockReturnValue(true)
    mocks.withTurnLogging.mockResolvedValue({ replies: [{ body: 'You are unsubscribed.' }] })
    const res = await post({ From: '+1', Body: 'STOP' })
    const xml = await res.text()
    expect(xml).toContain('You are unsubscribed.')
    expect(mocks.withTurnLogging).toHaveBeenCalledWith(expect.anything(), mocks.processSmsMessage, 'v1')
    // The conversational v2 agent must stay silent while off.
    expect(mocks.processSmsMessageV2).not.toHaveBeenCalled()
    // Compliance is checked before the opt-out silence branch.
    expect(mocks.isOptedOut).not.toHaveBeenCalled()
  })

  it('returns empty TwiML when a compliance keyword yields no reply', async () => {
    mocks.isComplianceKeyword.mockReturnValue(true)
    mocks.withTurnLogging.mockResolvedValue({ replies: [] })
    const xml = await (await post({ From: '+1', Body: 'STOP' })).text()
    expect(xml).toContain('<Response></Response>')
  })

  it('stays silent for an opted-out number that is not sending a keyword', async () => {
    mocks.isComplianceKeyword.mockReturnValue(false)
    mocks.isOptedOut.mockResolvedValue(true)
    const xml = await (await post({ From: '+1', Body: 'hey' })).text()
    expect(xml).toContain('<Response></Response>')
    expect(xml).not.toContain('<Message>')
  })

  it('sends the static holding reply to everyone else', async () => {
    mocks.isComplianceKeyword.mockReturnValue(false)
    mocks.isOptedOut.mockResolvedValue(false)
    const xml = await (await post({ From: '+1', Body: 'do you sell lube' })).text()
    expect(xml).toContain('text back right now') // holding reply (apostrophe is XML-escaped)
    expect(xml).toContain('hello@xdipx.com')
    // Holding reply is static — no AI processor runs.
    expect(mocks.withTurnLogging).not.toHaveBeenCalled()
    expect(mocks.processSmsMessageV2).not.toHaveBeenCalled()
  })
})

describe('sms webhook — never throws', () => {
  it('returns empty TwiML (200) when the handler throws', async () => {
    mocks.getKillSwitch.mockRejectedValue(new Error('team.server exploded'))
    const res = await post({ From: '+1', Body: 'x' })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<Response></Response>')
  })
})
