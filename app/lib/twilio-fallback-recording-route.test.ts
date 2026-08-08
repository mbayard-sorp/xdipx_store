import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// conv-p2-webhook-tests (ticket #628): the fallback voicemail handler and the
// recording-status callback are the two smallest Twilio routes but still carry
// real invariants — the fallback must persist a voicemail row and emit a valid
// <Record> flow, and recording-status must only paint a URL onto a row for a
// completed recording. These tests cover both, plus the shared signature gate
// and the dev-only loader.

const dbState = vi.hoisted(() => ({ updates: [] as Record<string, unknown>[] }))
const mocks = vi.hoisted(() => ({ persistPlaceholderVoicemail: vi.fn() }))

vi.mock('~/lib/db.server', () => ({
  db: {
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          dbState.updates.push(v)
          return Promise.resolve()
        },
      }),
    }),
  },
}))
vi.mock('~/lib/ivr-voicemail.server', () => ({ persistPlaceholderVoicemail: mocks.persistPlaceholderVoicemail }))

import { action as fallbackAction, loader as fallbackLoader } from '~/routes/api.twilio.voice-fallback'
import { action as recordingAction } from '~/routes/api.twilio.recording-status'

const ORIG_NODE_ENV = process.env['NODE_ENV']

function post(url: string, params: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(params).toString(),
  })
}

beforeEach(() => {
  process.env['NODE_ENV'] = 'test' // no signature → verify bypass
  dbState.updates = []
  mocks.persistPlaceholderVoicemail.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  if (ORIG_NODE_ENV === undefined) delete process.env['NODE_ENV']
  else process.env['NODE_ENV'] = ORIG_NODE_ENV
})

describe('voice-fallback webhook', () => {
  it('persists a fallback voicemail row and emits a Record flow', async () => {
    const req = post('https://xdipx.com/api/twilio/voice-fallback', { From: '+16025551234', CallSid: 'CA_fb' })
    const res = await fallbackAction({ request: req, params: {}, context: {} } as never)
    const xml = await res.text()
    expect(res.status).toBe(200)
    expect(xml).toContain('<Record')
    expect(xml).toContain('<Hangup')
    expect(mocks.persistPlaceholderVoicemail).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'fallback', callSid: 'CA_fb', callbackNumber: '+16025551234' }),
    )
  })

  it('returns 403 on an invalid signature', async () => {
    delete process.env['TWILIO_AUTH_TOKEN']
    const req = post('https://xdipx.com/api/twilio/voice-fallback', { CallSid: 'CA1' }, { 'x-twilio-signature': 'bogus' })
    const res = await fallbackAction({ request: req, params: {}, context: {} } as never)
    expect(res.status).toBe(403)
    expect(mocks.persistPlaceholderVoicemail).not.toHaveBeenCalled()
  })

  it('loader returns 405 in production', async () => {
    process.env['NODE_ENV'] = 'production'
    const req = new Request('https://xdipx.com/api/twilio/voice-fallback')
    const res = await fallbackLoader({ request: req, params: {}, context: {} } as never)
    expect(res.status).toBe(405)
  })

  it('loader previews TwiML in non-production', async () => {
    const req = new Request('https://xdipx.com/api/twilio/voice-fallback')
    const res = await fallbackLoader({ request: req, params: {}, context: {} } as never)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<Record')
  })
})

describe('recording-status webhook', () => {
  function callRecording(params: Record<string, string>, headers: Record<string, string> = {}) {
    const req = post('https://xdipx.com/api/twilio/recording-status', params, headers)
    return recordingAction({ request: req, params: {}, context: {} } as never)
  }

  it('paints the recording URL onto the matching row when completed', async () => {
    const res = await callRecording({
      CallSid: 'CA_rec',
      RecordingUrl: 'https://api.twilio.com/rec/abc',
      RecordingStatus: 'completed',
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
    expect(dbState.updates).toHaveLength(1)
    expect(dbState.updates[0]).toMatchObject({ recordingUrl: 'https://api.twilio.com/rec/abc' })
  })

  it('does nothing when the recording is not completed', async () => {
    const res = await callRecording({
      CallSid: 'CA_rec',
      RecordingUrl: 'https://api.twilio.com/rec/abc',
      RecordingStatus: 'in-progress',
    })
    expect(res.status).toBe(200)
    expect(dbState.updates).toHaveLength(0)
  })

  it('does nothing when the recording URL is missing', async () => {
    const res = await callRecording({ CallSid: 'CA_rec', RecordingStatus: 'completed' })
    expect(res.status).toBe(200)
    expect(dbState.updates).toHaveLength(0)
  })

  it('returns 403 on an invalid signature', async () => {
    delete process.env['TWILIO_AUTH_TOKEN']
    const res = await callRecording(
      { CallSid: 'CA1', RecordingUrl: 'u', RecordingStatus: 'completed' },
      { 'x-twilio-signature': 'bogus' },
    )
    expect(res.status).toBe(403)
    expect(dbState.updates).toHaveLength(0)
  })
})
