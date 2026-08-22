// Unit tests for the RunPod Serverless video client (Wan 2.2 14B, Phase 2 of
// the video-provider work). Mirrors fal.server.test.ts's fetch-stub style:
// no network, assert the exact request shape and the status/result mapping.
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  runpodVideoConfigured,
  submitRunpodVideo,
  getRunpodStatus,
  getRunpodResult,
  cancelRunpod,
} from './runpod-video.server'

function stubEnv() {
  vi.stubEnv('RUNPOD_API_KEY', 'test-runpod-key')
  vi.stubEnv('RUNPOD_VIDEO_ENDPOINT_ID', 'ep-123')
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test-blob-token')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('runpodVideoConfigured', () => {
  it('is false when either env var is missing', () => {
    vi.stubEnv('RUNPOD_API_KEY', '')
    vi.stubEnv('RUNPOD_VIDEO_ENDPOINT_ID', '')
    expect(runpodVideoConfigured()).toBe(false)
    vi.stubEnv('RUNPOD_API_KEY', 'key-only')
    expect(runpodVideoConfigured()).toBe(false)
  })

  it('is true when both are set', () => {
    stubEnv()
    expect(runpodVideoConfigured()).toBe(true)
  })
})

describe('submitRunpodVideo', () => {
  it('posts { input } to /v2/{endpointId}/run with the worker contract, and returns a QueueHandle', async () => {
    stubEnv()
    const calls: Array<{ url: string; method: string | undefined; body: Record<string, unknown> | undefined; headers: Record<string, string> | undefined }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        headers: init?.headers as Record<string, string> | undefined,
      })
      return new Response(JSON.stringify({ id: 'job-abc', status: 'IN_QUEUE' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    const handle = await submitRunpodVideo({
      prompt: 'slow push toward the product',
      imageUrl: 'https://blob.test/frame.jpg',
      durationSeconds: 8,
      mode: 'i2v',
      blobPathPrefix: 'video/job-abc',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.runpod.ai/v2/ep-123/run')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.headers?.['Authorization']).toBe('Bearer test-runpod-key')
    expect(calls[0]?.body).toMatchObject({
      input: {
        prompt: 'slow push toward the product',
        imageUrl: 'https://blob.test/frame.jpg',
        durationSeconds: 8,
        mode: 'i2v',
        aspect: '9:16',
        blobToken: 'test-blob-token',
        blobPathPrefix: 'video/job-abc',
      },
    })
    expect(handle).toEqual({
      requestId: 'job-abc',
      statusUrl: 'https://api.runpod.ai/v2/ep-123/status/job-abc',
      responseUrl: 'https://api.runpod.ai/v2/ep-123/status/job-abc',
    })
  })

  it('omits optional fields (negativePrompt, seed, steps) when not provided', async () => {
    stubEnv()
    let body: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ id: 'j1', status: 'IN_QUEUE' }), { status: 200 })
    }))
    await submitRunpodVideo({
      prompt: 'p', imageUrl: 'https://x/y.jpg', durationSeconds: 5, mode: 'i2v', blobPathPrefix: 'video/j1',
    })
    const input = body?.['input'] as Record<string, unknown>
    expect(input).not.toHaveProperty('negativePrompt')
    expect(input).not.toHaveProperty('seed')
    expect(input).not.toHaveProperty('steps')
  })

  it('includes negativePrompt/seed/steps when provided', async () => {
    stubEnv()
    let body: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ id: 'j1', status: 'IN_QUEUE' }), { status: 200 })
    }))
    await submitRunpodVideo({
      prompt: 'p', imageUrl: 'https://x/y.jpg', durationSeconds: 5, mode: 'i2v', blobPathPrefix: 'video/j1',
      negativePrompt: 'blurry', seed: 42, steps: 30,
    })
    expect(body?.['input']).toMatchObject({ negativePrompt: 'blurry', seed: 42, steps: 30 })
  })

  it('rejects i2v mode without an imageUrl before hitting the network', async () => {
    stubEnv()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(submitRunpodVideo({
      prompt: 'p', durationSeconds: 5, mode: 'i2v', blobPathPrefix: 'video/j1',
    })).rejects.toThrow(/imageUrl/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows t2v mode without an imageUrl', async () => {
    stubEnv()
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ id: 'j2', status: 'IN_QUEUE' }), { status: 200 })))
    const handle = await submitRunpodVideo({
      prompt: 'p', durationSeconds: 5, mode: 't2v', blobPathPrefix: 'video/j2',
    })
    expect(handle.requestId).toBe('j2')
  })

  it('throws with the response body on a non-ok submit', async () => {
    stubEnv()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('endpoint not found', { status: 404 })))
    await expect(submitRunpodVideo({
      prompt: 'p', imageUrl: 'https://x/y.jpg', durationSeconds: 5, mode: 'i2v', blobPathPrefix: 'video/j1',
    })).rejects.toThrow(/404/)
  })

  it('throws when the submit response is missing an id', async () => {
    stubEnv()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'IN_QUEUE' }), { status: 200 })))
    await expect(submitRunpodVideo({
      prompt: 'p', imageUrl: 'https://x/y.jpg', durationSeconds: 5, mode: 'i2v', blobPathPrefix: 'video/j1',
    })).rejects.toThrow(/missing id/)
  })
})

const HANDLE = {
  requestId: 'job-abc',
  statusUrl: 'https://api.runpod.ai/v2/ep-123/status/job-abc',
  responseUrl: 'https://api.runpod.ai/v2/ep-123/status/job-abc',
}

describe('getRunpodStatus', () => {
  it.each(['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED'] as const)('passes %s through unchanged', async (s) => {
    stubEnv()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: s }), { status: 200 })))
    expect(await getRunpodStatus(HANDLE)).toEqual({ status: s })
  })

  it.each(['FAILED', 'CANCELLED', 'TIMED_OUT', 'SOMETHING_NEW'] as const)('collapses %s to FAILED', async (s) => {
    stubEnv()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: s }), { status: 200 })))
    expect(await getRunpodStatus(HANDLE)).toEqual({ status: 'FAILED' })
  })

  it('throws on a non-ok status response', async () => {
    stubEnv()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    await expect(getRunpodStatus(HANDLE)).rejects.toThrow(/500/)
  })
})

describe('getRunpodResult', () => {
  it('returns videoUrl/renderSeconds/executionMs from a completed job', async () => {
    stubEnv()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'COMPLETED',
      executionTime: 214000,
      output: {
        videoUrl: 'https://blob.vercel-storage.com/video/job-abc/clip.mp4',
        lastFrameUrl: 'https://blob.vercel-storage.com/video/job-abc/last.jpg',
        renderSeconds: 210,
      },
    }), { status: 200 })))
    const result = await getRunpodResult(HANDLE)
    expect(result).toEqual({
      videoUrl: 'https://blob.vercel-storage.com/video/job-abc/clip.mp4',
      lastFrameUrl: 'https://blob.vercel-storage.com/video/job-abc/last.jpg',
      renderSeconds: 210,
      executionMs: 214000,
    })
  })

  it('omits lastFrameUrl when the worker did not return one', async () => {
    stubEnv()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'COMPLETED',
      executionTime: 100,
      output: { videoUrl: 'https://blob.test/clip.mp4' },
    }), { status: 200 })))
    const result = await getRunpodResult(HANDLE)
    expect(result.lastFrameUrl).toBeUndefined();
    expect('lastFrameUrl' in result).toBe(false)
  })

  it('throws when requested before the job is COMPLETED', async () => {
    stubEnv()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'IN_PROGRESS' }), { status: 200 })))
    await expect(getRunpodResult(HANDLE)).rejects.toThrow(/before job completed/)
  })

  it('throws when output.videoUrl is missing on a COMPLETED job', async () => {
    stubEnv()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'COMPLETED', output: {} }), { status: 200 })))
    await expect(getRunpodResult(HANDLE)).rejects.toThrow(/videoUrl/)
  })
})

describe('cancelRunpod', () => {
  it('posts to /v2/{endpointId}/cancel/{requestId}', async () => {
    stubEnv()
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${String(url)}`)
      return new Response(JSON.stringify({ status: 'CANCELLED' }), { status: 200 })
    }))
    await cancelRunpod(HANDLE)
    expect(calls).toEqual(['POST https://api.runpod.ai/v2/ep-123/cancel/job-abc'])
  })

  it('throws on a non-ok cancel response', async () => {
    stubEnv()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 410 })))
    await expect(cancelRunpod(HANDLE)).rejects.toThrow(/410/)
  })
})
