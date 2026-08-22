/**
 * RunPod Serverless VIDEO client — Wan 2.2 14B on a rented GPU worker
 * (infra/video-worker/, built separately). Mirrors fal-video.server.ts's
 * queue-client shape and error-handling style so the clip stage in
 * video-pipeline.server.ts can branch on provider with minimal divergence.
 *
 * REST protocol (verified live against docs.runpod.io 2026-08-22):
 *   POST https://api.runpod.ai/v2/{endpointId}/run          -> { id, status }
 *   GET  https://api.runpod.ai/v2/{endpointId}/status/{id}  -> { id, status,
 *          output?, executionTime?, delayTime? }
 *   POST https://api.runpod.ai/v2/{endpointId}/cancel/{id}  -> { id, status }
 *   Auth: `Authorization: Bearer {RUNPOD_API_KEY}`.
 *   status is one of IN_QUEUE | IN_PROGRESS | COMPLETED | FAILED | CANCELLED
 *   | TIMED_OUT. RunPod merges status + result in one /status call — there is
 *   no separate response endpoint the way fal's queue splits status_url from
 *   response_url, so statusUrl and responseUrl below are the same URL; the
 *   QueueHandle shape is kept identical to fal's so a runpod handle round-
 *   trips through video_jobs.provider_request_ids (jsonb) the same way.
 *
 * The worker uploads its own mp4 straight to Vercel Blob (blobToken +
 * blobPathPrefix in the input), so this file never downloads or re-uploads
 * clip bytes — only submits, polls, and reads back the Blob URL the worker
 * already wrote.
 */

import type { QueueHandle } from '~/lib/fal-video.server'
import { requireBlobToken } from '~/lib/blob.server'

const RUNPOD_API_BASE = 'https://api.runpod.ai/v2'

function requireKey(): string {
  const key = process.env['RUNPOD_API_KEY']
  if (!key) throw new Error('RUNPOD_API_KEY env var is required for RunPod calls')
  return key
}

function requireEndpointId(): string {
  const id = process.env['RUNPOD_VIDEO_ENDPOINT_ID']
  if (!id) throw new Error('RUNPOD_VIDEO_ENDPOINT_ID env var is required for RunPod video calls')
  return id
}

export function runpodVideoConfigured(): boolean {
  return !!process.env['RUNPOD_API_KEY']?.trim() && !!process.env['RUNPOD_VIDEO_ENDPOINT_ID']?.trim()
}

function authHeaders(key: string): Record<string, string> {
  return { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

export interface RunpodVideoInput {
  prompt: string
  negativePrompt?: string
  /** Publicly fetchable first-frame / reference image. Required for mode 'i2v'. */
  imageUrl?: string
  durationSeconds: number
  seed?: number
  steps?: number
  mode: 'i2v' | 't2v'
  /** Blob path prefix the worker uploads its outputs under, e.g. `video/{jobId}`. */
  blobPathPrefix: string
  /**
   * Use the lightx2v 4-step LoRA path instead of the full 20-step Wan 2.2
   * pipeline. Measured live on the 1cnxz75c71177q endpoint 2026-08-22: the
   * 20-step path exceeds the 900s execution timeout on a 4090 (VRAM swapping
   * between the two 14B experts) and only finishes on an L40S/48GB card. The
   * fast path completed in 219669ms with a valid 720x1280 5.06s clip. Since
   * the fleet is 4090-heavy while L40S stock is low, fast defaults to true
   * here (see resolveFast below) so a submit doesn't time out by default.
   */
  fast?: boolean
}

/**
 * Resolves the `fast` flag: explicit per-call value wins, otherwise default
 * TRUE unless RUNPOD_VIDEO_FAST is explicitly "0" or "false". The 20-step
 * path does not finish inside the timeout on 24GB cards, so opting OUT of
 * the fast path must be deliberate.
 */
function resolveFast(explicit: boolean | undefined): boolean {
  if (explicit != null) return explicit
  const raw = process.env['RUNPOD_VIDEO_FAST']?.trim().toLowerCase()
  if (raw === '0' || raw === 'false') return false
  return true
}

export async function submitRunpodVideo(input: RunpodVideoInput): Promise<QueueHandle> {
  const key = requireKey()
  const endpointId = requireEndpointId()
  if (input.mode === 'i2v' && !input.imageUrl) {
    throw new Error('runpod wan22-i2v requires imageUrl')
  }

  const body = {
    input: {
      prompt: input.prompt,
      ...(input.negativePrompt ? { negativePrompt: input.negativePrompt } : {}),
      ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
      durationSeconds: input.durationSeconds,
      ...(input.seed != null ? { seed: input.seed } : {}),
      ...(input.steps != null ? { steps: input.steps } : {}),
      mode: input.mode,
      aspect: '9:16' as const,
      fast: resolveFast(input.fast),
      blobToken: requireBlobToken(),
      blobPathPrefix: input.blobPathPrefix,
    },
  }

  const res = await fetch(`${RUNPOD_API_BASE}/${endpointId}/run`, {
    method: 'POST',
    headers: authHeaders(key),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`runpod submit error: ${res.status} ${text.slice(0, 400)}`)
  }
  const json = await res.json() as { id?: string }
  if (!json.id) throw new Error('runpod submit response missing id')

  // RunPod's /status merges status + output in one call, so status and
  // response resolve to the same URL — kept as two fields only to satisfy
  // the shared QueueHandle shape fal's queue client defined.
  const statusUrl = `${RUNPOD_API_BASE}/${endpointId}/status/${json.id}`
  return { requestId: json.id, statusUrl, responseUrl: statusUrl }
}

// ---------------------------------------------------------------------------
// Status / result / cancel
// ---------------------------------------------------------------------------

export type RunpodQueueStatus = 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'

export async function getRunpodStatus(handle: QueueHandle): Promise<{ status: RunpodQueueStatus }> {
  const key = requireKey()
  const res = await fetch(handle.statusUrl, { headers: authHeaders(key) })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`runpod status error: ${res.status} ${text.slice(0, 400)}`)
  }
  const json = await res.json() as { status?: string }
  const status = json.status
  if (status === 'IN_QUEUE' || status === 'IN_PROGRESS' || status === 'COMPLETED') return { status }
  // CANCELLED, TIMED_OUT, and anything unrecognized collapse to FAILED —
  // mirrors fal-video's getVideoRequestStatus.
  return { status: 'FAILED' }
}

export interface RunpodVideoResult {
  videoUrl: string
  lastFrameUrl?: string
  /** Seconds the worker actually rendered for — informational, not billing. */
  renderSeconds: number
  /** RunPod's measured executionTime in ms — the ACTUAL billing input (model-pricing computeRunpodActualCostUsd). */
  executionMs: number
}

interface RunpodWorkerOutput {
  videoUrl?: string
  lastFrameUrl?: string
  width?: number
  height?: number
  fps?: number
  durationSeconds?: number
  seed?: number
  renderSeconds?: number
}

export async function getRunpodResult(handle: QueueHandle): Promise<RunpodVideoResult> {
  const key = requireKey()
  const res = await fetch(handle.responseUrl, { headers: authHeaders(key) })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`runpod result error: ${res.status} ${text.slice(0, 400)}`)
  }
  const json = await res.json() as { status?: string; output?: RunpodWorkerOutput; executionTime?: number }
  if (json.status !== 'COMPLETED') {
    throw new Error(`runpod result requested before job completed (status: ${json.status ?? 'unknown'})`)
  }
  const videoUrl = json.output?.videoUrl
  if (!videoUrl) throw new Error('runpod result missing output.videoUrl')
  return {
    videoUrl,
    ...(json.output?.lastFrameUrl ? { lastFrameUrl: json.output.lastFrameUrl } : {}),
    renderSeconds: json.output?.renderSeconds ?? 0,
    executionMs: json.executionTime ?? 0,
  }
}

export async function cancelRunpod(handle: QueueHandle): Promise<void> {
  const key = requireKey()
  const endpointId = requireEndpointId()
  const cancelUrl = `${RUNPOD_API_BASE}/${endpointId}/cancel/${handle.requestId}`
  const res = await fetch(cancelUrl, { method: 'POST', headers: authHeaders(key) })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`runpod cancel error: ${res.status} ${text.slice(0, 400)}`)
  }
}
