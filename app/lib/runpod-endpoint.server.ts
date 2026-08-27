/**
 * RunPod Serverless ENDPOINT health (ticket #5717).
 *
 * Why this exists at all: the stray-pod watch (`runpod-pods.server.ts`) reads
 * `api.runpod.io/v2/pods`, the hourly-billed MACHINE product. Video renders
 * run on the Serverless endpoint at `api.runpod.ai/v2/{RUNPOD_VIDEO_ENDPOINT_ID}`,
 * which the pods list has never contained and never will, so "no pods running"
 * is a PERMANENT FALSE ALL-CLEAR about the render fleet. Confirming the GPU is
 * actually off after a video takes both reads: this one for the endpoint's
 * workers and queue, the pods list for stray bootstrap machines.
 *
 * Same honesty discipline as `runpod-pods.server.ts` and the owner-blocker
 * runners: throw on "could not ask" (missing env, non-2xx, malformed body) so
 * a failed read can never be mistaken for zero.
 */

const RUNPOD_API_BASE = 'https://api.runpod.ai/v2'

export interface RunpodEndpointWorkers {
  idle: number
  initializing: number
  ready: number
  running: number
  throttled: number
  unhealthy: number
  /**
   * Workers that are actually consuming GPU: initializing + running +
   * throttled + unhealthy.
   *
   * `ready` is excluded along with `idle` (ticket #5932). It used to be
   * counted, which made this a permanent false alarm: RunPod reports the SAME
   * warm FlashBoot slots under BOTH `idle` and `ready`, so excluding only
   * `idle` excluded nothing. Measured on endpoint 1cnxz75c71177q, 2026-08-27:
   * `idle 3 / ready 3 / running 0` for four straight days after the last job
   * on 08-23, against $0 of RunPod billing on 08-24 through 08-27. Three
   * "active" workers, zero dollars. That arithmetic is what kept owner blocker
   * 25 open and stopped confirmRunpodIdle from ever stamping a wan22 job.
   *
   * This is correct for a FLEX endpoint at `workers.min = 0`, which is what
   * the video endpoint is: a ready worker there is a warm cache reservation,
   * not compute. If the endpoint is ever moved to Active workers or a nonzero
   * min, those ARE billed while ready and this must count them again.
   *
   * Every raw count stays on the struct and in the probe json, so the owner
   * can still see the warm slots.
   */
  active: number
}

export interface RunpodEndpointJobs {
  inQueue: number
  inProgress: number
}

export interface RunpodEndpointHealth {
  workers: RunpodEndpointWorkers
  jobs: RunpodEndpointJobs
}

function requireKey(): string {
  const key = process.env['RUNPOD_API_KEY']
  if (!key) throw new Error('RUNPOD_API_KEY is not set')
  return key
}

function requireEndpointId(explicit?: string): string {
  const id = explicit ?? process.env['RUNPOD_VIDEO_ENDPOINT_ID']
  if (!id) throw new Error('RUNPOD_VIDEO_ENDPOINT_ID is not set')
  return id
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * GET /v2/{endpointId}/health -> worker counts by state plus queue depth.
 * Throws on any failure; never fabricates a zero.
 */
export async function getRunpodEndpointHealth(endpointId?: string): Promise<RunpodEndpointHealth> {
  const key = requireKey()
  const id = requireEndpointId(endpointId)
  const res = await fetch(`${RUNPOD_API_BASE}/${id}/health`, {
    headers: { Authorization: `Bearer ${key}` },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`runpod endpoint health error: ${res.status} ${text.slice(0, 300)}`)
  }
  const json = await res.json().catch(() => null) as {
    workers?: Record<string, unknown>
    jobs?: Record<string, unknown>
  } | null
  if (!json || typeof json !== 'object') throw new Error('runpod endpoint health: malformed body')

  const w = json.workers ?? {}
  const workers: RunpodEndpointWorkers = {
    idle: n(w['idle']),
    initializing: n(w['initializing']),
    ready: n(w['ready']),
    running: n(w['running']),
    throttled: n(w['throttled']),
    unhealthy: n(w['unhealthy']),
    active: 0,
  }
  workers.active = workers.initializing + workers.running + workers.throttled + workers.unhealthy

  const j = json.jobs ?? {}
  return {
    workers,
    jobs: { inQueue: n(j['inQueue']), inProgress: n(j['inProgress']) },
  }
}
