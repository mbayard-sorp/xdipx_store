/**
 * api.ltx.upload.tsx
 *
 * Uploads a completed LTX video from /tmp to a Shopify product.
 * Reuses the existing staged upload → attach → poll pipeline.
 */

import type { ActionFunctionArgs } from 'react-router'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { requireAdmin } from '~/lib/session.server'
import { apiError } from '~/lib/api-error.server'
import { kvGet, KV_KEYS } from '~/lib/kv.server'
import {
  createStagedVideoUpload,
  attachVideoToProduct,
  pollMediaReady,
} from '~/lib/shopify.server'
import { getSiteSettings } from '~/lib/sanity.server'
import sharp from 'sharp'
import ffmpegPath from 'ffmpeg-static'

interface LtxKVState {
  status:         'complete' | 'error'
  enhancedPrompt: string
  productId:      string
  productName:    string
  videoPaths?:    string[]
  videoUrls?:     string[]
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
  if (!Number.isFinite(videoIndex) || videoIndex !== 0) {
    return Response.json({ error: 'videoIndex must be 0' }, { status: 400 })
  }

  // ── Read KV state ─────────────────────────────────────────────────────────
  const state = await kvGet<LtxKVState>(KV_KEYS.ltxOperation(token))
  if (!state || state.status !== 'complete' || !state.videoPaths) {
    return Response.json({ error: 'Operation not found, not complete, or expired' }, { status: 404 })
  }

  const filePath = state.videoPaths[videoIndex]
  if (!filePath || !existsSync(filePath)) {
    return Response.json({ error: 'No video file found' }, { status: 400 })
  }

  // ── Step 1: Apply watermark, then read video ──────────────────────────────
  const watermarkedPath = await applyVideoWatermark(filePath, token)
  const videoBuffer = readFileSync(watermarkedPath)
  const filename = `ltx-${token}-${videoIndex}.mp4`

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
    return apiError('ltx.upload:staged', err, 'Shopify staged upload failed', 502)
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
    return apiError('ltx.upload:put', err, 'Video upload to Shopify failed', 502)
  }

  // ── Step 4: Attach to product ─────────────────────────────────────────────
  let mediaId: string
  try {
    mediaId = await attachVideoToProduct(productId, resourceUrl, `LTX video for ${state.productName}`)
  } catch (err) {
    return apiError('ltx.upload:attach', err, 'Shopify attach failed', 502)
  }

  // ── Step 5: Poll for READY status ─────────────────────────────────────────
  const ready = await pollMediaReady(productId, mediaId)

  // ── Step 6: Clean up /tmp files ────────────────────────────────────────────
  for (const f of [filePath, watermarkedPath]) {
    try { unlinkSync(f) } catch { /* non-fatal */ }
  }
  // Also clean original unwatermarked + audio files if they exist
  for (const f of [`/tmp/ltx-${token}-0.mp4`, `/tmp/ltx-${token}-audio.mp3`, `/tmp/ltx-${token}-0-mixed.mp4`]) {
    try { if (existsSync(f)) unlinkSync(f) } catch { /* non-fatal */ }
  }

  return Response.json({
    ok: true,
    mediaId,
    ready,
  })
}

// ─── Video Watermark ────────────────────────────────────────────────────────

let logoCache: { buffer: Buffer; ts: number } | null = null
const LOGO_CACHE_TTL = 1000 * 60 * 60 // 1 hour

async function fetchLogoPng(): Promise<Buffer | null> {
  if (logoCache && Date.now() - logoCache.ts < LOGO_CACHE_TTL) return logoCache.buffer
  const settings = await getSiteSettings()
  if (!settings?.logoUrl) return null
  const res = await fetch(settings.logoUrl)
  if (!res.ok) return null
  const buffer = Buffer.from(await res.arrayBuffer())
  logoCache = { buffer, ts: Date.now() }
  return buffer
}

async function applyVideoWatermark(videoPath: string, token: string): Promise<string> {
  try {
    const logo = await fetchLogoPng()
    if (!logo) return videoPath // no logo available — skip watermark

    // Prepare logo as semi-transparent PNG overlay (35% opacity)
    const preparedLogo = await sharp(logo)
      .resize(160) // reasonable size for video overlay
      .ensureAlpha()
      .composite([{
        input: Buffer.from([255, 255, 255, Math.round(255 * 0.35)]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: 'dest-in',
      }])
      .png()
      .toBuffer()

    const overlayPath = `/tmp/ltx-${token}-watermark.png`
    const outputPath  = `/tmp/ltx-${token}-watermarked.mp4`

    writeFileSync(overlayPath, preparedLogo)

    // ffmpeg overlay: bottom-right with padding, copy audio if present
    execFileSync(ffmpegPath!, [
      '-y',
      '-i', videoPath,
      '-i', overlayPath,
      '-filter_complex', 'overlay=W-w-20:H-h-20',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      outputPath,
    ], { timeout: 60_000 })

    // Clean up overlay PNG
    try { unlinkSync(overlayPath) } catch { /* non-fatal */ }

    return existsSync(outputPath) ? outputPath : videoPath
  } catch (err) {
    console.warn('[ltx.upload] Watermark failed, uploading without:', err instanceof Error ? err.message : err)
    return videoPath // fallback — upload without watermark
  }
}
