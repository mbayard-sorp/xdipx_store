/**
 * Wavespeed video adapter (ADR-016 mirror). The Wavespeed shapes are
 * UNVERIFIED against the live API (see the adapter's header); these tests pin
 * the adapter's own contract so a correction is a deliberate, visible change.
 * fetch is mocked throughout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WAVESPEED_API,
  buildWavespeedVideoBody,
  getWavespeedVideoResult,
  getWavespeedVideoStatus,
  submitWavespeedVideo,
  wavespeedConfigured,
  wavespeedMirrorFor,
  wavespeedVideoProvider,
} from './wavespeed-video.server'

const FRAME = 'https://x.public.blob.vercel-storage.com/video/j/frame.jpg'
const SPEECH = 'https://x.public.blob.vercel-storage.com/video/j/speech-0.mp3'
const ID = 'ws0123456789abcdef'
const RESULT_URL = `https://api.wavespeed.ai/api/v3/predictions/${ID}/result`

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubEnv('WAVESPEED_API_KEY', 'test-ws-key')
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('mirror map', () => {
  it('mirrors only like-for-like tiers', () => {
    expect(wavespeedMirrorFor('italk-atlas')).toBe('wavespeed-ai/infinitetalk')
    expect(wavespeedMirrorFor('wan22turbo-atlas')).toBe('wavespeed-ai/wan-2.2/i2v-720p')
    expect(wavespeedMirrorFor('grok-atlas')).toBeNull()
    expect(wavespeedMirrorFor('wan27-atlas')).toBeNull()
  })

  it('configured() is false when WAVESPEED_API_KEY is absent', () => {
    expect(wavespeedConfigured()).toBe(true)
    vi.stubEnv('WAVESPEED_API_KEY', '')
    expect(wavespeedConfigured()).toBe(false)
    expect(wavespeedVideoProvider.configured()).toBe(false)
  })
})

describe('buildWavespeedVideoBody', () => {
  it('maps a tier id to its mirror endpoint and body', () => {
    expect(buildWavespeedVideoBody('italk-atlas', { prompt: 'warm', imageUrl: FRAME, audioUrl: SPEECH, durationSeconds: 9 })).toEqual({
      model: 'wavespeed-ai/infinitetalk',
      body: { image: FRAME, audio: SPEECH, prompt: 'warm', resolution: '720p', seed: -1 },
    })
    expect(buildWavespeedVideoBody('wan22turbo-atlas', { prompt: 'p', imageUrl: FRAME, durationSeconds: 5 })).toEqual({
      model: 'wavespeed-ai/wan-2.2/i2v-720p',
      body: { image: FRAME, prompt: 'p', duration: 5, seed: -1 },
    })
  })

  it('accepts the speech-to-video endpoint by its own id', () => {
    const { model, body } = buildWavespeedVideoBody('wavespeed-ai/wan-2.2/speech-to-video', { prompt: '', imageUrl: FRAME, audioUrl: SPEECH, durationSeconds: 9 })
    expect(model).toBe('wavespeed-ai/wan-2.2/speech-to-video')
    expect(body).toMatchObject({ image: FRAME, audio: SPEECH })
  })

  it('refuses an unmirrored tier and an audio-driven call with no audio', () => {
    expect(() => buildWavespeedVideoBody('grok-atlas', { prompt: 'p', imageUrl: FRAME, durationSeconds: 5 })).toThrow(/no Wavespeed endpoint/)
    expect(() => buildWavespeedVideoBody('italk-atlas', { prompt: '', imageUrl: FRAME, durationSeconds: 9 })).toThrow(/audioUrl/)
  })
})

describe('submit / status / result', () => {
  it('POSTs to {base}/{model} with bearer auth and a User-Agent, and returns a handle built from the id', async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 200, message: 'success', data: { id: ID, status: 'created', urls: { get: 'https://evil.example/x' } } }))
    const handle = await submitWavespeedVideo('italk-atlas', { prompt: '', imageUrl: FRAME, audioUrl: SPEECH, durationSeconds: 9 })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${WAVESPEED_API.base}/wavespeed-ai/infinitetalk`)
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer test-ws-key')
    expect(headers['User-Agent']).toBeTruthy()
    expect(handle).toEqual({ requestId: ID, statusUrl: RESULT_URL, responseUrl: RESULT_URL })
  })

  it('throws on a non-OK submit', async () => {
    fetchMock.mockResolvedValueOnce(new Response('insufficient credits', { status: 402 }))
    await expect(submitWavespeedVideo('wan22turbo-atlas', { prompt: 'p', imageUrl: FRAME, durationSeconds: 5 })).rejects.toThrow(/402/)
  })

  const handle = { requestId: ID, statusUrl: RESULT_URL, responseUrl: RESULT_URL }

  it.each([
    ['created', 'IN_QUEUE'],
    ['processing', 'IN_PROGRESS'],
    ['pending', 'IN_PROGRESS'],
    ['completed', 'COMPLETED'],
  ])('status %s -> %s', async (ws, ours) => {
    fetchMock.mockResolvedValueOnce(json({ code: 200, data: { id: ID, status: ws } }))
    expect((await getWavespeedVideoStatus(handle)).status).toBe(ours)
    expect(fetchMock.mock.calls[0]![0]).toBe(RESULT_URL)
  })

  it('status failed -> FAILED with the provider message', async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 200, data: { id: ID, status: 'failed', error: 'worker crashed' } }))
    expect(await getWavespeedVideoStatus(handle)).toEqual({ status: 'FAILED', error: 'wavespeed: worker crashed' })
  })

  it('result returns outputs[0]', async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 200, data: { id: ID, status: 'completed', outputs: ['https://cdn.wavespeed.ai/out.mp4'] } }))
    expect(await getWavespeedVideoResult(handle)).toEqual({ videoUrl: 'https://cdn.wavespeed.ai/out.mp4', contentType: 'video/mp4' })
  })

  it('owns only Wavespeed handles', () => {
    expect(wavespeedVideoProvider.ownsHandle?.(handle)).toBe(true)
    expect(wavespeedVideoProvider.ownsHandle?.({ requestId: 'a', statusUrl: 'https://api.atlascloud.ai/api/v1/model/prediction/a', responseUrl: '' })).toBe(false)
  })
})
