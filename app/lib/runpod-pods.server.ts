/**
 * RunPod Pods management client. Lists hourly-billed pod machines so a cron
 * can catch one left running by mistake.
 *
 * Distinct from runpod-video.server.ts: that file talks to a Serverless
 * ENDPOINT (`api.runpod.ai/v2/{endpointId}/...`), which scales to zero and is
 * billed per job. This file talks to the Pods MANAGEMENT api
 * (`api.runpod.io/v2/pods`), which lists standalone GPU machines billed by the
 * hour whether or not anything is running on them. Pods are only ever used
 * for one-time model bootstraps; a forgotten one is a silent $0.74/hr leak.
 *
 * REST protocol (verified live against api.runpod.io/v2/openapi.json
 * 2026-08-23):
 *   GET https://api.runpod.io/v2/pods -> { pods: Pod[] }
 *   Auth: `Authorization: Bearer {RUNPOD_API_KEY}`.
 *   Pod.status is one of PROVISIONING | STARTING | RUNNING | EXITED | ERROR |
 *   TERMINATED. Pod.cost is "current cost in USD per hour (0.0 when EXITED or
 *   TERMINATED)". Pod.startedAt is nullable date-time. A 401/403 on this
 *   endpoint means the key lacks the pods-management scope (a Serverless-only
 *   key is not enough), see requireKey below and the error text it throws.
 */

const RUNPOD_MANAGEMENT_API_BASE = 'https://api.runpod.io/v2'

function requireKey(): string {
  const key = process.env['RUNPOD_API_KEY']
  if (!key) throw new Error('RUNPOD_API_KEY env var is required for RunPod pod-management calls')
  return key
}

interface RunpodPodApi {
  id?: string
  name?: string
  status?: string
  cost?: number
  gpu?: { id?: string; count?: number } | null
  startedAt?: string | null
  createdAt?: string
}

interface ListPodsApiResponse {
  pods?: RunpodPodApi[]
}

export interface RunningRunpodPod {
  id: string
  name: string
  status: 'RUNNING'
  /** USD per hour, per Pod.cost in the RunPod v2 schema. */
  costPerHour: number
  /** GPU model, e.g. "NVIDIA GeForce RTX 4090". Empty string for CPU pods. */
  gpu: string
  startedAt: string
  hoursRunning: number
}

function hoursSince(iso: string): number {
  const started = Date.parse(iso)
  if (Number.isNaN(started)) return 0
  return Math.max(0, (Date.now() - started) / 3_600_000)
}

/**
 * Lists every pod currently in RUNNING state (i.e. actively billing on the
 * hourly Pods product, as opposed to the scale-to-zero Serverless endpoint).
 * Throws on a missing key or a non-2xx response. This is a probe input, and
 * a probe must be able to tell "could not ask" (throw -> caller maps to null)
 * apart from "asked and got zero" (empty array, a real answer).
 */
export async function listRunningRunpodPods(): Promise<RunningRunpodPod[]> {
  const key = requireKey()

  const res = await fetch(`${RUNPOD_MANAGEMENT_API_BASE}/pods`, {
    headers: { Authorization: `Bearer ${key}` },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `runpod pods list error: ${res.status} ${text.slice(0, 200)}, the RUNPOD_API_KEY likely lacks the ` +
        `pods-management scope (api.runpod.io/graphql permission); a Serverless-only key returns this`,
      )
    }
    throw new Error(`runpod pods list error: ${res.status} ${text.slice(0, 400)}`)
  }

  const json = (await res.json()) as ListPodsApiResponse
  const pods = json.pods ?? []

  return pods
    .filter((p): p is RunpodPodApi & { id: string; status: string } => p.status === 'RUNNING' && !!p.id)
    .map(p => {
      const startedAt = p.startedAt ?? p.createdAt ?? new Date().toISOString()
      return {
        id: p.id,
        name: p.name ?? p.id,
        status: 'RUNNING' as const,
        costPerHour: typeof p.cost === 'number' ? p.cost : 0,
        gpu: p.gpu?.id ?? '',
        startedAt,
        hoursRunning: hoursSince(startedAt),
      }
    })
}
