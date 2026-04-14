/**
 * api.veo.upload.tsx
 *
 * Uploads a completed Veo video from /tmp to a Shopify product.
 * Reuses the existing staged upload → attach → poll pipeline.
 */

import type { ActionFunctionArgs } from 'react-router'
import { readFileSync, existsSync, unlinkSync } from 'node:fs'
import { requireAdmin } from '~/lib/session.server'
import { apiError } from '~/lib/api-error.server'
import { kvGet, KV_KEYS } from '~/lib/kv.server'
import {
  createStagedVideoUpload,
  attachVideoToProduct,
  pollMediaReady,
} from '~/lib/shopify.server'

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

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  const form       = await request.formData()
  const token      = form.get('token')      as string
  const videoIndex = parseInt(form.get('videoIndex') as string, 10)
  const productId  = form.get('productId')  as string

  if (!token || !productId) {
    return Response.json({ error: 'Missing token or productId' }, { status: 400 })
  }
  if (!Number.isFinite(videoIndex) || videoIndex < 0 || videoIndex > 1) {
    return Response.json({ error: 'videoIndex must be 0 or 1' }, { status: 400 })
  }

  // ── Read KV state ─────────────────────────────────────────────────────────
  const state = await kvGet<VeoKVState>(KV_KEYS.veoOperation(token))
  if (!state || state.status !== 'complete' || !state.videoPaths) {
    return Response.json({ error: 'Operation not found, not complete, or expired' }, { status: 404 })
  }

  const filePath = state.videoPaths[videoIndex]
  if (!filePath || !existsSync(filePath)) {
    return Response.json({ error: `No video file at index ${videoIndex}` }, { status: 400 })
  }

  // ── Step 1: Read video from /tmp ──────────────────────────────────────────
  const videoBuffer = readFileSync(filePath)

  const filename = `veo-${token}-${videoIndex}.mp4`

  // ── Step 2: Shopify staged upload ─────────────────────────────────────────
  let resourceUrl: string
  let stagedUrl: string
  let stagedParams: { name: string; value: string }[]
  try {
    const staged = await createStagedVideoUpload(filename, videoBuffer.length)
    resourceUrl  = staged.resourceUrl
    stagedUrl    = staged.url
    stagedParams = staged.parameters
  } catch (err) {
    return apiError('veo.upload:staged', err, 'Shopify staged upload failed', 502)
  }

  // ── Step 3: Upload buffer to staged URL ───────────────────────────────────
  try {
    const uploadForm = new FormData()
    for (const param of stagedParams) uploadForm.append(param.name, param.value)
    uploadForm.append('file', new Blob([new Uint8Array(videoBuffer)], { type: 'video/mp4' }), filename)

    const uploadRes = await fetch(stagedUrl, { method: 'POST', body: uploadForm })
    if (!uploadRes.ok) {
      throw new Error(`${uploadRes.status} ${await uploadRes.text()}`)
    }
  } catch (err) {
    return apiError('veo.upload:put', err, 'Video upload to Shopify failed', 502)
  }

  // ── Step 4: Attach to product ─────────────────────────────────────────────
  let mediaId: string
  try {
    mediaId = await attachVideoToProduct(productId, resourceUrl, `Veo video for ${state.productName}`)
  } catch (err) {
    return apiError('veo.upload:attach', err, 'Shopify attach failed', 502)
  }

  // ── Step 5: Poll for READY status ─────────────────────────────────────────
  const ready = await pollMediaReady(productId, mediaId)

  // ── Step 6: Clean up /tmp file ─────────────────────────────────────────────
  try {
    unlinkSync(filePath)
  } catch {
    console.warn(`[veo.upload] Failed to delete ${filePath} (non-fatal)`)
  }

  return Response.json({
    ok: true,
    mediaId,
    ready,
  })
}
