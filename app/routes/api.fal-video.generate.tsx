/**
 * POST /api/fal-video/generate — submit (op:'submit') or poll (op:'status') a
 * fal queue video generation for the Labs fal-video spike. Admin-gated.
 * Spend is logged at submit time under feature 'video-spike' (the cost is
 * committed once the request is queued).
 */

import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import {
  VIDEO_MODELS,
  isVideoModelId,
  falVideoConfigured,
  submitVideoRequest,
  getVideoRequestStatus,
  getVideoRequestResult,
  type QueueHandle,
} from '~/lib/fal-video.server'
import { logVideoCost } from '~/lib/token-log.server'
import { apiError } from '~/lib/api-error.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  try {
    if (!falVideoConfigured()) {
      return Response.json({ error: 'FAL_KEY is not configured' }, { status: 503 })
    }
    const body = await request.json() as {
      op?: 'submit' | 'status'
      model?: string
      imageUrl?: string
      prompt?: string
      durationSeconds?: number
      productHandle?: string
      handle?: QueueHandle
    }

    if (body.op === 'submit') {
      if (!isVideoModelId(body.model)) {
        return Response.json({ error: `Unknown model. Use one of: ${Object.keys(VIDEO_MODELS).join(', ')}` }, { status: 400 })
      }
      if (!body.imageUrl || !body.prompt?.trim() || !body.durationSeconds) {
        return Response.json({ error: 'imageUrl, prompt, and durationSeconds are required' }, { status: 400 })
      }
      const spec = VIDEO_MODELS[body.model]
      const handle = await submitVideoRequest(body.model, {
        prompt: body.prompt,
        imageUrl: body.imageUrl,
        durationSeconds: body.durationSeconds,
        aspect: '9:16',
      })
      void logVideoCost({
        feature: 'video-spike',
        model: spec.costKey,
        seconds: body.durationSeconds,
        caller: 'api.fal-video.generate',
        ...(body.productHandle ? { sku: body.productHandle } : {}),
      })
      return Response.json({ handle, estCostUsd: spec.ratePerSecondUsd * body.durationSeconds })
    }

    if (body.op === 'status') {
      const h = body.handle
      if (!h?.requestId || !h.statusUrl || !h.responseUrl) {
        return Response.json({ error: 'handle {requestId, statusUrl, responseUrl} is required' }, { status: 400 })
      }
      const { status } = await getVideoRequestStatus(h)
      if (status !== 'COMPLETED') return Response.json({ status })
      const result = await getVideoRequestResult(h)
      return Response.json({ status, videoUrl: result.videoUrl })
    }

    return Response.json({ error: 'op must be submit or status' }, { status: 400 })
  } catch (err) {
    return apiError('fal-video-generate', err, 'fal video request failed')
  }
}
