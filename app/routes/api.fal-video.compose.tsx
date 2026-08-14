/**
 * POST /api/fal-video/compose — scene-frame composition for the Labs fal-video
 * spike. Composes the presenter (Emma canonical photo, or none) with the real
 * product photo into 9:16 candidate first frames. Two-stage: a packaging-free
 * product plate, then the composite (see composeSceneFrame).
 * Admin-gated; spend logged under feature 'video-spike'.
 */

import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { composeSceneFrame, falVideoConfigured } from '~/lib/fal-video.server'
import { getEditorPhotoUrl } from '~/lib/sanity.server'
import { logImageCost } from '~/lib/token-log.server'
import { apiError } from '~/lib/api-error.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  try {
    if (!falVideoConfigured()) {
      return Response.json({ error: 'FAL_KEY is not configured' }, { status: 503 })
    }
    const body = await request.json() as {
      prompt?: string
      productImageUrl?: string
      presenter?: 'emma' | 'none'
      count?: number
      productHandle?: string
    }
    if (!body.prompt?.trim() || !body.productImageUrl) {
      return Response.json({ error: 'prompt and productImageUrl are required' }, { status: 400 })
    }

    let presenterImageUrl: string | null = null
    if ((body.presenter ?? 'emma') === 'emma') {
      presenterImageUrl = await getEditorPhotoUrl()
      if (!presenterImageUrl) {
        return Response.json({ error: 'Emma canonical photo not found in Sanity (singleton.editor)' }, { status: 503 })
      }
    }

    const count = Math.min(Math.max(1, body.count ?? 3), 4)
    const result = presenterImageUrl
      ? await composeSceneFrame({
          prompt: body.prompt,
          presenterImageUrl,
          productImageUrl: body.productImageUrl,
          count,
        })
      : // No presenter: still route through the edit endpoint with just the
        // product photo so the frame keeps the real product.
        await composeSceneFrame({
          prompt: body.prompt,
          presenterImageUrl: body.productImageUrl,
          productImageUrl: body.productImageUrl,
          count,
        })

    // One spend row per candidate (each is its own fal request, ticket #3045),
    // carrying that request_id so a returned frame traces back to its
    // generation. Totals are unchanged: /admin/usage sums request_count.
    result.urls.forEach((_url, i) => {
      const rid = result.requestIds[i]
      void logImageCost({
        feature: 'video-spike',
        model: result.costKey,
        count: 1,
        caller: 'api.fal-video.compose',
        ...(body.productHandle ? { sku: body.productHandle } : {}),
        ...(rid ? { requestId: rid } : {}),
      })
    })
    // Stage-1 product plate, when one was built. Logged separately so spend
    // lands against the right model on /admin/usage.
    if (result.plate) {
      void logImageCost({
        feature: 'video-spike',
        model: result.plate.costKey,
        count: result.plate.count,
        caller: 'api.fal-video.compose/plate',
        ...(body.productHandle ? { sku: body.productHandle } : {}),
        ...(result.plateRequestId ? { requestId: result.plateRequestId } : {}),
      })
    }

    return Response.json({ urls: result.urls })
  } catch (err) {
    return apiError('fal-video-compose', err, 'Scene frame composition failed')
  }
}
