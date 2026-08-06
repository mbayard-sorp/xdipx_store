import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// conv-audit B5: the pre-agent Twilio <Record> gates must persist a voicemails
// row + fire the admin notify at record time, otherwise after-hours / fallback
// messages are invisible and their recording never attaches. These tests cover
// the shared helper both routes use.

const { trackEvent, dbInsert, values, onConflictDoNothing, returning } = vi.hoisted(() => {
  const returning = vi.fn()
  const onConflictDoNothing = vi.fn((_target?: unknown) => ({ returning }))
  const values = vi.fn((_row?: Record<string, unknown>) => ({ onConflictDoNothing }))
  const dbInsert = vi.fn((_table?: unknown) => ({ values }))
  return { trackEvent: vi.fn(), dbInsert, values, onConflictDoNothing, returning }
})

vi.mock('./klaviyo.server', () => ({ trackEvent }))
vi.mock('./db.server', () => ({ db: { insert: dbInsert } }))

import { notifyVoicemailReceived, persistPlaceholderVoicemail } from './ivr-voicemail.server'

const ORIG_EMAIL = process.env['ADMIN_NOTIFICATION_EMAIL']

beforeEach(() => {
  trackEvent.mockReset()
  dbInsert.mockClear()
  values.mockClear()
  onConflictDoNothing.mockClear()
  returning.mockReset()
  process.env['ADMIN_NOTIFICATION_EMAIL'] = 'ops@xdipx.com'
})

afterEach(() => {
  if (ORIG_EMAIL === undefined) delete process.env['ADMIN_NOTIFICATION_EMAIL']
  else process.env['ADMIN_NOTIFICATION_EMAIL'] = ORIG_EMAIL
})

describe('notifyVoicemailReceived', () => {
  it('fires the Klaviyo event with the expected shape and returns true', async () => {
    trackEvent.mockResolvedValue(undefined)
    const ok = await notifyVoicemailReceived({
      callSid: 'CA1',
      fromNumber: '+16025551234',
      callbackNumber: '+16025551234',
      summary: 'Voicemail left after hours. No live transcript, listen to the recording.',
      contextOrderNumber: null,
    })
    expect(ok).toBe(true)
    expect(trackEvent).toHaveBeenCalledWith('ops@xdipx.com', 'IVR Voicemail Received', expect.objectContaining({
      call_sid: 'CA1',
      from_number: '+16025551234',
      callback_number: '+16025551234',
      admin_url: 'https://xdipx.com/admin/voicemails',
    }))
  })

  it('skips and returns false when ADMIN_NOTIFICATION_EMAIL is unset', async () => {
    delete process.env['ADMIN_NOTIFICATION_EMAIL']
    const ok = await notifyVoicemailReceived({
      callSid: 'CA1', fromNumber: 'x', callbackNumber: null, summary: 's', contextOrderNumber: null,
    })
    expect(ok).toBe(false)
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('swallows a Klaviyo failure and returns false', async () => {
    trackEvent.mockRejectedValue(new Error('klaviyo 500'))
    const ok = await notifyVoicemailReceived({
      callSid: 'CA1', fromNumber: 'x', callbackNumber: null, summary: 's', contextOrderNumber: null,
    })
    expect(ok).toBe(false)
  })
})

describe('persistPlaceholderVoicemail', () => {
  it('inserts a placeholder row and notifies when the row is new', async () => {
    returning.mockResolvedValue([{ id: 7 }])
    trackEvent.mockResolvedValue(undefined)

    await persistPlaceholderVoicemail({
      callSid: 'CA2',
      fromNumber: '+16025550000',
      reason: 'after_hours',
      callbackNumber: '+16025550000',
    })

    expect(dbInsert).toHaveBeenCalledTimes(1)
    const inserted = values.mock.calls[0]![0]!
    expect(inserted).toMatchObject({
      callSid: 'CA2',
      fromNumber: '+16025550000',
      callbackNumber: '+16025550000',
      transcript: '',
      contextOrderNumber: null,
    })
    // Placeholder summary, not an empty/NULL value (both are NOT NULL columns).
    expect(String(inserted['summary'])).toContain('after hours')
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledTimes(1)
  })

  it('does NOT notify when the row already existed (conflict → empty returning)', async () => {
    returning.mockResolvedValue([])

    await persistPlaceholderVoicemail({ callSid: 'CA3', fromNumber: '+1602', reason: 'fallback' })

    expect(dbInsert).toHaveBeenCalledTimes(1)
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('defaults a blank caller to "anonymous" for the NOT NULL from_number', async () => {
    returning.mockResolvedValue([{ id: 9 }])
    trackEvent.mockResolvedValue(undefined)

    await persistPlaceholderVoicemail({ callSid: 'CA4', fromNumber: '', reason: 'anonymous', callbackNumber: null })

    const inserted = values.mock.calls[0]![0]!
    expect(inserted['fromNumber']).toBe('anonymous')
    expect(inserted['callbackNumber']).toBeNull()
  })

  it('skips entirely when callSid is empty (unjoinable row)', async () => {
    await persistPlaceholderVoicemail({ callSid: '', fromNumber: '+1602', reason: 'unavailable' })
    expect(dbInsert).not.toHaveBeenCalled()
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('never throws when the DB insert rejects', async () => {
    returning.mockRejectedValue(new Error('db down'))
    await expect(
      persistPlaceholderVoicemail({ callSid: 'CA5', fromNumber: '+1602', reason: 'after_hours' }),
    ).resolves.toBeUndefined()
    expect(trackEvent).not.toHaveBeenCalled()
  })
})
