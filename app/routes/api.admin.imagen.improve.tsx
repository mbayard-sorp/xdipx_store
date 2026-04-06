/**
 * Image improvement endpoint.
 * Sends the original image alongside the improvement prompt so Gemini can
 * modify the scene while keeping the product identical.
 */
import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { generateMoodImage } from '~/lib/imagen.server'

/** Fetch a CDN URL server-side and return its bytes as a Buffer. */
async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const ab = await res.arrayBuffer()
    return Buffer.from(ab)
  } catch {
    return null
  }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  let improvementPrompt = '', productContext = '', originalImageUrl = ''
  try {
    const body = await request.json() as {
      improvementPrompt?: string
      productContext?: string
      originalImageUrl?: string
    }
    improvementPrompt = body.improvementPrompt?.trim() ?? ''
    productContext    = body.productContext?.trim() ?? ''
    originalImageUrl  = body.originalImageUrl?.trim() ?? ''
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!improvementPrompt) {
    return Response.json({ error: 'improvementPrompt is required' }, { status: 400 })
  }

  const fullPrompt = productContext
    ? `Product photography for a premium wellness product. ${productContext}. Style direction: ${improvementPrompt}. Editorial lifestyle aesthetic, warm coral-orange tones, no text, no logos.`
    : `Product photography for a premium wellness product. ${improvementPrompt}. Editorial lifestyle aesthetic, warm coral-orange tones, no text, no logos.`

  // Fetch the original image server-side if provided
  let originalImageBuffer: Buffer | undefined
  if (originalImageUrl) {
    const buf = await fetchImageBuffer(originalImageUrl)
    if (buf) originalImageBuffer = buf
  }

  let buffers: Buffer[]
  try {
    buffers = await generateMoodImage({
      categories:         [],
      prompt:             fullPrompt,
      count:              2,
      originalImageBuffer,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: msg }, { status: 502 })
  }

  const images = buffers.map(buf => ({
    base64:   buf.toString('base64'),
    mimeType: 'image/jpeg' as const,
  }))

  if (images.length === 0) {
    return Response.json({ error: 'All images were blocked by safety filters' }, { status: 400 })
  }

  return Response.json({ images })
}
