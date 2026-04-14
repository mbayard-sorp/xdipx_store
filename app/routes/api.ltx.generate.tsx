/**
 * api.ltx.generate.tsx
 *
 * Generates an LTX Video from an image:
 *   1. Enhance user prompt via Claude
 *   2. Call LTX API (synchronous — blocks until video is ready)
 *   3. Save video to /tmp
 *   4. Persist metadata to KV
 *   5. Return token + preview URL
 */

import type { ActionFunctionArgs } from 'react-router'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { requireAdmin } from '~/lib/session.server'
import { apiError } from '~/lib/api-error.server'
import { enhanceLtxPrompt } from '~/lib/claude.server'
import {
  generateLtxVideo,
  validateLtxOptions,
  type LtxGenerateOptions,
  type LtxResolution,
  type LtxAspectRatio,
  type LtxFps,
  type LtxCameraMotion,
} from '~/lib/ltx.server'
import { kvSet, KV_KEYS } from '~/lib/kv.server'

const VALID_RESOLUTIONS  = new Set(['480p', '720p', '1080p'])
const VALID_FPS          = new Set([24, 25, 48, 50])
const VALID_CAMERA       = new Set([
  'dolly_in', 'dolly_out', 'dolly_left', 'dolly_right',
  'jib_up', 'jib_down', 'static', 'focus_shift',
])

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  const form = await request.formData()

  const productId   = form.get('productId')   as string
  const productName = form.get('productName') as string
  const brand       = form.get('brand')       as string
  const category    = (form.get('category')   as string) || ''
  const userPrompt  = form.get('prompt')      as string

  const resolution     = (form.get('resolution') as string) || '1080p'
  const durationRaw    = parseInt(form.get('duration') as string, 10)
  const fpsRaw         = parseInt(form.get('fps') as string, 10) || 24
  const cameraMotion   = (form.get('cameraMotion') as string) || ''
  const aspectRatio    = (form.get('aspectRatio') as string) || '16:9'
  const startingImageUrl = form.get('startingImageUrl') as string
  const skipEnhance      = form.get('skipEnhance') === 'true'

  // ── Validate required fields ───────────────────────────────────────────────
  if (!productId || !productName || !brand) {
    return Response.json({ error: 'Missing required fields: productId, productName, brand' }, { status: 400 })
  }
  if (!userPrompt?.trim()) {
    return Response.json({ error: 'A video idea/prompt is required' }, { status: 400 })
  }
  if (!startingImageUrl) {
    return Response.json({ error: 'A starting image is required for LTX image-to-video' }, { status: 400 })
  }
  if (!VALID_RESOLUTIONS.has(resolution)) {
    return Response.json({ error: 'resolution must be "480p", "720p", or "1080p"' }, { status: 400 })
  }
  if (!VALID_FPS.has(fpsRaw)) {
    return Response.json({ error: 'fps must be 24, 25, 48, or 50' }, { status: 400 })
  }

  // ── Step 1: Enhance prompt via Claude (unless skipped) ──────────────────────
  let enhancedPrompt: string
  if (skipEnhance) {
    enhancedPrompt = userPrompt
  } else {
    try {
      enhancedPrompt = await enhanceLtxPrompt({
        userIdea:        userPrompt,
        productTitle:    productName,
        productBrand:    brand,
        ...(category ? { productCategory: category } : {}),
        hasStartingImage: true,
        resolution,
        durationSeconds: durationRaw,
        ...(cameraMotion && VALID_CAMERA.has(cameraMotion) ? { cameraMotion } : {}),
      })
    } catch (err) {
      console.warn('[ltx.generate] Claude prompt enhancement failed, using raw prompt:', err)
      enhancedPrompt = userPrompt
    }
  }

  // ── Step 2: Build options and validate ─────────────────────────────────────
  const opts: LtxGenerateOptions = {
    prompt:      enhancedPrompt,
    imageUri:    startingImageUrl,
    duration:    durationRaw,
    resolution:  resolution as LtxResolution,
    aspectRatio: aspectRatio as LtxAspectRatio,
    fps:         fpsRaw as LtxFps,
    ...(cameraMotion && VALID_CAMERA.has(cameraMotion)
      ? { cameraMotion: cameraMotion as LtxCameraMotion }
      : {}),
  }

  const validationError = validateLtxOptions(opts)
  if (validationError) {
    return Response.json({ error: validationError }, { status: 400 })
  }

  // ── Step 3: Call LTX API (synchronous — blocks for full generation) ────────
  let videoBuffer: Buffer
  try {
    videoBuffer = await generateLtxVideo(opts)
  } catch (err) {
    return apiError('ltx.generate', err, 'LTX generation failed', 502)
  }

  // ── Step 4: Save to /tmp and persist to KV ─────────────────────────────────
  const token    = randomBytes(16).toString('hex')
  const filePath = `/tmp/ltx-${token}-0.mp4`

  writeFileSync(filePath, videoBuffer)

  const videoUrl = `/api/ltx/preview/${token}/0`

  await kvSet(KV_KEYS.ltxOperation(token), {
    status:         'complete',
    enhancedPrompt,
    productId,
    productName,
    videoPaths:     [filePath],
    videoUrls:      [videoUrl],
    startedAt:      Date.now(),
  }, 3600) // 1 hour TTL

  return Response.json({
    ok: true,
    token,
    enhancedPrompt,
    videoUrls: [videoUrl],
  })
}
