/**
 * Studio image generation endpoint.
 * Called by the Sanity Studio's ImageGeneratorInput component.
 * Protected by STUDIO_API_SECRET header.
 * CORS is handled by the Express middleware in server/index.ts — do NOT
 * set Access-Control-Allow-* headers here or they will be duplicated and
 * Chrome will reject the response.
 */
import type { ActionFunctionArgs } from 'react-router'
import { timingSafeEqual } from 'node:crypto'
import { generateMoodImage } from '~/lib/imagen.server'

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export type GenerateImageResponse = {
  images?: Array<{ base64: string; mimeType: string }>
  blocked?: number
  error?: string
}

export async function action({ request }: ActionFunctionArgs) {
  // Auth (timing-safe)
  const expected = process.env['STUDIO_API_SECRET']
  const secret   = request.headers.get('x-studio-secret')
  if (!expected || !secret || !safeEqual(secret, expected)) {
    return Response.json(
      { error: 'Unauthorized' } satisfies GenerateImageResponse,
      { status: 401 },
    )
  }

  // Parse body
  let prompt: string
  let count = 4
  let aspectRatio = '1:1'
  const VALID_RATIOS = new Set(['1:1', '4:3', '3:4', '16:9', '9:16'])
  try {
    const body = await request.json() as { prompt?: unknown; count?: unknown; aspectRatio?: unknown }
    if (!body.prompt || typeof body.prompt !== 'string' || !body.prompt.trim()) {
      return Response.json(
        { error: 'prompt is required' } satisfies GenerateImageResponse,
        { status: 400 },
      )
    }
    prompt = body.prompt.trim()
    if (typeof body.count === 'number') count = Math.min(Math.max(1, body.count), 4)
    if (typeof body.aspectRatio === 'string' && VALID_RATIOS.has(body.aspectRatio)) {
      aspectRatio = body.aspectRatio
    }
  } catch {
    return Response.json(
      { error: 'Invalid JSON body' } satisfies GenerateImageResponse,
      { status: 400 },
    )
  }

  // Generate
  let buffers: Buffer[]
  try {
    buffers = await generateMoodImage({ categories: [], prompt, aspectRatio, personGeneration: 'allow_adult' })
  } catch (err: unknown) {
    console.error('[generate-image-studio] error:', err)
    const rawMsg = err instanceof Error ? err.message : String(err)
    const status = rawMsg.includes('aborted') || rawMsg.includes('timeout') ? 504 : 502
    const isProd = process.env['NODE_ENV'] === 'production'
    return Response.json(
      {
        images: [],
        error: isProd ? 'Image generation failed' : rawMsg,
      } satisfies GenerateImageResponse,
      { status },
    )
  }

  const images = buffers.slice(0, count).map(buf => ({
    base64:   buf.toString('base64'),
    mimeType: 'image/jpeg' as const,
  }))

  if (images.length === 0) {
    return Response.json(
      { error: 'All images were blocked by safety filters', blocked: count } satisfies GenerateImageResponse,
      { status: 400 },
    )
  }

  const blocked = count - images.length
  const payload: GenerateImageResponse = blocked > 0
    ? { images, blocked }
    : { images }

  return Response.json(payload, { status: 200 })
}
