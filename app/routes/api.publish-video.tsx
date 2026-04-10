/**
 * api.publish-video.tsx
 *
 * Uploads an already-rendered preview to Shopify as product media.
 * Takes the preview token + Shopify product GID and runs the staged upload flow.
 */

import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { createStagedVideoUpload, attachVideoToProduct, pollMediaReady, setMediaAsPrimary } from '~/lib/shopify.server'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { uploadThumbnailToProduct } from '~/lib/shopify.server'
import { applyWatermark } from '~/lib/watermark.server'

const PREVIEW_DIR = join(process.cwd(), '.video-previews')

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  const form       = await request.formData()
  const token      = form.get('token')      as string
  const productId  = form.get('productId')  as string   // Shopify GID
  const productName = form.get('productName') as string

  if (!token || !/^[a-f0-9]{32}$/.test(token)) {
    return Response.json({ error: 'Invalid token' }, { status: 400 })
  }
  if (!productId || !productName) {
    return Response.json({ error: 'Missing productId or productName' }, { status: 400 })
  }

  const filePath = join(PREVIEW_DIR, `${token}.mp4`)
  if (!existsSync(filePath)) {
    return Response.json({ error: 'Preview not found or expired — generate a new video first' }, { status: 404 })
  }

  const videoBuffer = readFileSync(filePath)
  const filename = `xdipx-product-ad-${Date.now()}.mp4`

  // Staged upload
  const staged = await createStagedVideoUpload(filename, videoBuffer.length)

  const form2 = new FormData()
  for (const param of staged.parameters) form2.append(param.name, param.value)
  form2.append('file', new Blob([videoBuffer], { type: 'video/mp4' }), filename)

  const uploadRes = await fetch(staged.url, { method: 'POST', body: form2 })
  if (!uploadRes.ok) {
    return Response.json({ error: `Staged upload failed: ${uploadRes.status}` }, { status: 502 })
  }

  const altText = `${productName} — xdipx daily deal`
  const mediaId = await attachVideoToProduct(productId, staged.resourceUrl, altText)

  const ready = await pollMediaReady(productId, mediaId)

  let thumbnailSet = { home_page: false, pdp: false }
  if (ready) {
    try {
      await setMediaAsPrimary(productId, mediaId)
      thumbnailSet = { home_page: true, pdp: true }
    } catch { /* non-fatal */ }
  }

  // Upload thumbnail if it exists alongside the preview video
  const thumbPath = join(PREVIEW_DIR, `${token}.jpg`)
  if (existsSync(thumbPath)) {
    try {
      const rawThumbBuffer = readFileSync(thumbPath)
      const thumbBuffer = await applyWatermark(rawThumbBuffer)
      const thumbFilename = `xdipx-thumb-${Date.now()}.jpg`
      await uploadThumbnailToProduct(productId, thumbBuffer, thumbFilename, `${productName} — xdipx daily deal`)
    } catch { /* non-fatal */ }
    try { unlinkSync(thumbPath) } catch { /* ok */ }
  }

  // Clean up preview file after successful upload
  try { unlinkSync(filePath) } catch { /* ok */ }

  return Response.json({
    ok: true,
    mediaId,
    ready,
    thumbnailSet,
  })
}
