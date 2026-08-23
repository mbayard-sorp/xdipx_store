/**
 * The `runpod_no_pods` probe runner.
 *
 * Separate from owner-blockers.test.ts because that file deliberately imports
 * only `owner-blockers-core` (pure, no Neon client). This one needs the server
 * module, where the runner lives. Mirrors owner-blockers-webhook-probe.test.ts.
 */
import { afterEach, describe, it, expect, vi } from 'vitest'
import { PROBES } from '~/lib/owner-blockers.server'

type Probe = { describe: (a: string) => string; run: (a: string) => Promise<boolean | null> }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('runpod_no_pods runner', () => {
  const probe = () => (PROBES as unknown as Record<string, Probe>)['runpod_no_pods']!

  it('is wired into PROBES', () => {
    expect(probe()).toBeDefined()
    expect(typeof probe().run).toBe('function')
  })

  it('describes itself', () => {
    expect(probe().describe('')).toContain('no RunPod pod is left running')
  })

  it('returns true when zero pods are RUNNING', async () => {
    vi.stubEnv('RUNPOD_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ pods: [] }), { status: 200 })))
    await expect(probe().run('')).resolves.toBe(true)
  })

  it('returns false when a pod is RUNNING', async () => {
    vi.stubEnv('RUNPOD_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      pods: [{ id: 'p1', name: 'stray', status: 'RUNNING', cost: 0.74, startedAt: new Date().toISOString() }],
    }), { status: 200 })))
    await expect(probe().run('')).resolves.toBe(false)
  })

  it('returns null, NOT false, when RUNPOD_API_KEY is missing', async () => {
    vi.stubEnv('RUNPOD_API_KEY', '')
    // "I could not ask" must never be reported as "all clear": a missing key
    // must age the row open, never silently clear it.
    await expect(probe().run('')).resolves.toBeNull()
  })

  it('returns null, NOT false, on a non-2xx API response', async () => {
    vi.stubEnv('RUNPOD_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
    await expect(probe().run('')).resolves.toBeNull()
  })
})
