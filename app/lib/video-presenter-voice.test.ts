/**
 * resolvePresenterVoiceId (ticket #6584): resolution order — a friend cast
 * member's Sanity voiceId, then a dedicated Emma video voice, then a hard
 * refusal rather than silently substituting the IVR or Emma voice.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const castMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/sanity.server', () => ({ getApprovedCastMembers: castMock }))

const ivrVoiceMock = vi.hoisted(() => vi.fn())
vi.mock('~/lib/ivr-voice.server', () => ({ getActiveIvrVoiceId: ivrVoiceMock }))

import { resolvePresenterVoiceId } from '~/lib/video-presenter-voice.server'

const member = (overrides: Record<string, unknown> = {}) => ({
  slug: 'maya',
  name: 'Maya',
  role: null,
  photoUrl: 'https://example.com/maya.jpg',
  photoAlt: null,
  shortBio: null,
  personaNotes: null,
  archetype: null,
  ageRange: null,
  description: null,
  emotionTags: [],
  editorialPhotoUrl: null,
  voiceId: null,
  ...overrides,
})

describe('resolvePresenterVoiceId', () => {
  const originalEmmaVoice = process.env['ELEVENLABS_VOICE_ID_EMMA']

  beforeEach(() => {
    vi.clearAllMocks()
    castMock.mockResolvedValue([])
    ivrVoiceMock.mockResolvedValue('ivr-voice-abc')
    delete process.env['ELEVENLABS_VOICE_ID_EMMA']
  })

  afterEach(() => {
    if (originalEmmaVoice === undefined) delete process.env['ELEVENLABS_VOICE_ID_EMMA']
    else process.env['ELEVENLABS_VOICE_ID_EMMA'] = originalEmmaVoice
  })

  it("resolves a friend's own castMember.voiceId, first in the order", async () => {
    castMock.mockResolvedValue([member({ slug: 'maya', voiceId: 'maya-voice-1' })])
    await expect(resolvePresenterVoiceId('friend:maya')).resolves.toBe('maya-voice-1')
    expect(ivrVoiceMock).not.toHaveBeenCalled()
  })

  it("refuses a friend with no voiceId assigned, rather than substituting the IVR voice", async () => {
    castMock.mockResolvedValue([member({ slug: 'maya', voiceId: null })])
    await expect(resolvePresenterVoiceId('friend:maya')).rejects.toThrow(/no voiceId assigned/i)
    expect(ivrVoiceMock).not.toHaveBeenCalled()
  })

  it('refuses a friend who is not found or not approved for use', async () => {
    castMock.mockResolvedValue([])
    await expect(resolvePresenterVoiceId('friend:ghost')).rejects.toThrow(/not found or not approved/i)
  })

  it("prefers the dedicated Emma voice constant for presenter 'emma' when configured", async () => {
    process.env['ELEVENLABS_VOICE_ID_EMMA'] = 'emma-video-voice'
    await expect(resolvePresenterVoiceId('emma')).resolves.toBe('emma-video-voice')
    expect(ivrVoiceMock).not.toHaveBeenCalled()
  })

  it("falls back to the IVR voice for 'emma' when no dedicated Emma voice is configured (no behavior change for existing jobs)", async () => {
    await expect(resolvePresenterVoiceId('emma')).resolves.toBe('ivr-voice-abc')
    expect(ivrVoiceMock).toHaveBeenCalledTimes(1)
  })

  it("presenter 'none' (narration, no on-screen presenter) resolves the same as 'emma'", async () => {
    process.env['ELEVENLABS_VOICE_ID_EMMA'] = 'emma-video-voice'
    await expect(resolvePresenterVoiceId('none')).resolves.toBe('emma-video-voice')
  })

  it('refuses an unknown presenter format', async () => {
    await expect(resolvePresenterVoiceId('bogus')).rejects.toThrow(/unknown presenter/i)
  })
})
