// Unit tests for the RunPod Pods management client. Mirrors
// runpod-video.server.test.ts's fetch-stub style: no network, assert the
// exact request and the RUNNING-filter/shape mapping.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { listRunningRunpodPods } from './runpod-pods.server'

function stubEnv() {
  vi.stubEnv('RUNPOD_API_KEY', 'test-runpod-key')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('listRunningRunpodPods', () => {
  it('throws when RUNPOD_API_KEY is missing', async () => {
    vi.stubEnv('RUNPOD_API_KEY', '')
    await expect(listRunningRunpodPods()).rejects.toThrow(/RUNPOD_API_KEY/)
  })

  it('calls GET /v2/pods with a bearer token', async () => {
    stubEnv()
    const calls: Array<{ url: string; method: string | undefined; headers: Record<string, string> | undefined }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method, headers: init?.headers as Record<string, string> | undefined })
      return new Response(JSON.stringify({ pods: [] }), { status: 200 })
    }))
    await listRunningRunpodPods()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.runpod.io/v2/pods')
    expect(calls[0]?.headers?.['Authorization']).toBe('Bearer test-runpod-key')
  })

  it('filters to RUNNING pods only, and maps id/name/cost/gpu/startedAt', async () => {
    stubEnv()
    const now = Date.now()
    const startedAt = new Date(now - 3 * 3_600_000).toISOString() // 3h ago
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      pods: [
        {
          id: 'pod-run', name: 'bootstrap-box', status: 'RUNNING', cost: 0.74,
          gpu: { id: 'NVIDIA A40', count: 1 }, startedAt, createdAt: startedAt,
        },
        { id: 'pod-exited', name: 'old-one', status: 'EXITED', cost: 0.0, startedAt },
        { id: 'pod-terminated', name: 'gone', status: 'TERMINATED', cost: 0.0 },
      ],
    }), { status: 200 })))

    const pods = await listRunningRunpodPods()
    expect(pods).toHaveLength(1)
    expect(pods[0]).toMatchObject({
      id: 'pod-run', name: 'bootstrap-box', status: 'RUNNING', costPerHour: 0.74, gpu: 'NVIDIA A40', startedAt,
    })
    expect(pods[0]?.hoursRunning).toBeGreaterThan(2.9)
    expect(pods[0]?.hoursRunning).toBeLessThan(3.1)
  })

  it('returns an empty array when no pods are running', async () => {
    stubEnv()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      pods: [{ id: 'p1', name: 'idle', status: 'EXITED', cost: 0 }],
    }), { status: 200 })))
    expect(await listRunningRunpodPods()).toEqual([])
  })

  it('falls back to id for name and to createdAt for startedAt when absent', async () => {
    stubEnv()
    const createdAt = new Date(Date.now() - 3_600_000).toISOString()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      pods: [{ id: 'pod-noname', status: 'RUNNING', cost: 0.5, createdAt }],
    }), { status: 200 })))
    const pods = await listRunningRunpodPods()
    expect(pods[0]?.name).toBe('pod-noname')
    expect(pods[0]?.startedAt).toBe(createdAt)
  })

  it('throws a scope-specific error on 401/403', async () => {
    stubEnv()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
    await expect(listRunningRunpodPods()).rejects.toThrow(/pods-management scope/)
  })

  it('throws a generic error on other non-2xx responses', async () => {
    stubEnv()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    await expect(listRunningRunpodPods()).rejects.toThrow(/runpod pods list error: 500/)
  })
})
