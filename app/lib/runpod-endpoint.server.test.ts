/**
 * RunPod Serverless endpoint health (ticket #5932).
 *
 * This module had no direct coverage, which is how it shipped counting warm
 * FlashBoot slots as billing workers: `active` summed `ready` while the doc
 * comment claimed warm workers were excluded. RunPod reports the SAME warm
 * slots under both `idle` and `ready`, so excluding only `idle` excluded
 * nothing, and the endpoint-idle alarm could never clear.
 *
 * The payload in `LIVE_2026_08_27` is the real body from endpoint
 * 1cnxz75c71177q, read four days after its last job, during four days of $0
 * RunPod billing. It is the regression this file exists to hold.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRunpodEndpointHealth } from './runpod-endpoint.server'

/** The live body that produced the false alarm. Three warm workers, zero spend. */
const LIVE_2026_08_27 = {
  jobs: { completed: 6, failed: 4, inProgress: 0, inQueue: 0, retried: 0 },
  workers: { idle: 3, initializing: 0, ready: 3, running: 0, throttled: 0, unhealthy: 0 },
}

function stubHealth(body: unknown, status = 200) {
  vi.stubEnv('RUNPOD_API_KEY', 'test-key')
  vi.stubEnv('RUNPOD_VIDEO_ENDPOINT_ID', 'ep-123')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('getRunpodEndpointHealth — active worker accounting', () => {
  it('reports ZERO active on the live payload that billed nothing for four days', async () => {
    stubHealth(LIVE_2026_08_27)
    const health = await getRunpodEndpointHealth()
    expect(health.workers.active).toBe(0)
  })

  it('still reports the warm slots, so the owner can see them in the probe json', async () => {
    stubHealth(LIVE_2026_08_27)
    const health = await getRunpodEndpointHealth()
    expect(health.workers.idle).toBe(3)
    expect(health.workers.ready).toBe(3)
  })

  it('counts a running worker', async () => {
    stubHealth({ workers: { ...LIVE_2026_08_27.workers, running: 1 }, jobs: {} })
    expect((await getRunpodEndpointHealth()).workers.active).toBe(1)
  })

  it('counts initializing, throttled and unhealthy — every state that holds a GPU', async () => {
    stubHealth({ workers: { idle: 0, ready: 0, running: 0, initializing: 1, throttled: 2, unhealthy: 3 }, jobs: {} })
    expect((await getRunpodEndpointHealth()).workers.active).toBe(6)
  })

  it('does not let ready alone raise the alarm, however many warm slots there are', async () => {
    stubHealth({ workers: { idle: 0, ready: 9, running: 0, initializing: 0, throttled: 0, unhealthy: 0 }, jobs: {} })
    expect((await getRunpodEndpointHealth()).workers.active).toBe(0)
  })

  it('reads the queue depth, which is the other half of "is it busy"', async () => {
    stubHealth({ workers: LIVE_2026_08_27.workers, jobs: { inQueue: 2, inProgress: 1 } })
    const health = await getRunpodEndpointHealth()
    expect(health.jobs).toEqual({ inQueue: 2, inProgress: 1 })
  })
})

describe('getRunpodEndpointHealth — never fabricates a zero', () => {
  it('throws on a non-2xx rather than reporting idle', async () => {
    stubHealth({}, 500)
    await expect(getRunpodEndpointHealth()).rejects.toThrow(/health error: 500/)
  })

  it('throws on a malformed body', async () => {
    vi.stubEnv('RUNPOD_API_KEY', 'test-key')
    vi.stubEnv('RUNPOD_VIDEO_ENDPOINT_ID', 'ep-123')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(getRunpodEndpointHealth()).rejects.toThrow(/malformed body/)
  })

  it('throws when the endpoint id is missing', async () => {
    vi.stubEnv('RUNPOD_API_KEY', 'test-key')
    vi.stubEnv('RUNPOD_VIDEO_ENDPOINT_ID', '')
    await expect(getRunpodEndpointHealth()).rejects.toThrow(/RUNPOD_VIDEO_ENDPOINT_ID/)
  })

  it('treats missing worker fields as 0 rather than NaN', async () => {
    stubHealth({ workers: { running: 1 }, jobs: {} })
    const health = await getRunpodEndpointHealth()
    expect(health.workers.active).toBe(1)
    expect(health.workers.idle).toBe(0)
  })
})
