/**
 * api.veo.status.$token.tsx
 *
 * Polls the status of a Veo video generation operation.
 * When complete, downloads the videos and stores them in Vercel Blob.
 * Client polls this endpoint every ~10s until status is 'complete' or 'error'.
 */

import type { LoaderFunctionArgs } from 'react-router'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { requireAdmin } from '~/lib/session.server'
import { pollVeoOperation, downloadVeoResults, type VeoOperationState } from '~/lib/veo.server'
import { kvGet, kvSet, KV_KEYS } from '~/lib/kv.server'

interface VeoKVState {
  status:         'generating' | 'complete' | 'error'
  operationName:  string
  enhancedPrompt: string
  productId:      string
  productName:    string
  startedAt:      number
  videoPaths?:    string[]
  videoUrls?:     string[]
  error?:         string
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request)

  const token = params.token
  if (!token || !/^[0-9a-f]{32}$/.test(token)) {
    return Response.json({ error: 'Invalid token' }, { status: 400 })
  }

  const state = await kvGet<VeoKVState>(KV_KEYS.veoOperation(token))
  if (!state) {
    return Response.json({ error: 'Operation not found or expired' }, { status: 404 })
  }

  // Already complete — return cached result
  if (state.status === 'complete') {
    return Response.json({
      status:    'complete',
      videoUrls: state.videoUrls,
      enhancedPrompt: state.enhancedPrompt,
    })
  }

  // Already errored — return cached error
  if (state.status === 'error') {
    return Response.json({
      status: 'error',
      error:  state.error,
    })
  }

  // ── Poll Veo operation ────────────────────────────────────────────────────
  const opState: VeoOperationState = {
    operationName: state.operationName,
    done: false,
  }

  try {
    const pollResult = await pollVeoOperation(opState)

    if (!pollResult.done) {
      return Response.json({
        status:  'generating',
        elapsed: Date.now() - state.startedAt,
        enhancedPrompt: state.enhancedPrompt,
      })
    }

    // ── Done — download videos and store in /tmp ──────────────────────────
    const result = await downloadVeoResults(opState)

    const videoPaths: string[] = []
    const videoUrls: string[] = []
    for (let i = 0; i < result.videoBuffers.length; i++) {
      const tmpPath = join('/tmp', `veo-${token}-${i}.mp4`)
      writeFileSync(tmpPath, result.videoBuffers[i]!)
      videoPaths.push(tmpPath)
      videoUrls.push(`/api/veo/preview/${token}/${i}`)
    }

    // Update KV with completed state
    await kvSet(KV_KEYS.veoOperation(token), {
      ...state,
      status:    'complete',
      videoPaths,
      videoUrls,
    }, 3600)

    return Response.json({
      status:    'complete',
      videoUrls,
      enhancedPrompt: state.enhancedPrompt,
    })
  } catch (err) {
    console.error(`[veo.status] Error polling/downloading for token ${token}:`, err)
    const isProd = process.env['NODE_ENV'] === 'production'
    const message = isProd
      ? 'Veo polling failed'
      : err instanceof Error ? err.message : String(err)

    await kvSet(KV_KEYS.veoOperation(token), {
      ...state,
      status: 'error',
      error:  message,
    }, 3600)

    return Response.json({
      status: 'error',
      error:  message,
    })
  }
}
