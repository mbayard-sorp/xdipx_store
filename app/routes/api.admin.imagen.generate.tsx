import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { generateMoodImage } from '~/lib/imagen.server'

const STYLE_SUFFIXES: Record<string, string> = {
  'lifestyle':    'warm lifestyle photography, natural lighting, editorial aesthetic',
  'studio-white': 'clean studio photography, pure white background, professional product shot',
  'dark-moody':   'dark moody lighting, deep shadows, dramatic contrast, luxury aesthetic',
  'flat-lay':     'flat lay photography, top-down view, minimalist arrangement on textured surface',
  'close-up':     'extreme close-up detail shot, macro photography, textural focus',
}

const VALID_RATIOS = new Set(['1:1', '4:3', '3:4', '16:9', '9:16'])

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

  let prompt = '', style = 'lifestyle', count = 2, aspectRatio = '1:1'
  let referenceImageUrls: string[] = []
  let productTitle = ''
  try {
    const body = await request.json() as {
      prompt?: string
      style?: string
      count?: number
      aspectRatio?: string
      referenceImageUrls?: string[]
      productTitle?: string
    }
    prompt             = body.prompt?.trim() ?? ''
    style              = body.style ?? 'lifestyle'
    count              = Math.min(Math.max(1, body.count ?? 2), 4)
    aspectRatio        = VALID_RATIOS.has(body.aspectRatio ?? '') ? (body.aspectRatio ?? '1:1') : '1:1'
    referenceImageUrls = Array.isArray(body.referenceImageUrls) ? body.referenceImageUrls.slice(0, 1) : []
    productTitle       = body.productTitle ?? ''
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!prompt) return Response.json({ error: 'prompt is required' }, { status: 400 })

  const suffix     = STYLE_SUFFIXES[style] ?? STYLE_SUFFIXES['lifestyle']!
  const fullPrompt = `${prompt}. ${suffix}. No text overlays, no logos.`

  // Fetch reference images server-side — never expose CDN URLs to the API
  let referenceImageBuffers: Buffer[] | undefined
  if (referenceImageUrls.length > 0) {
    const settled = await Promise.all(referenceImageUrls.map(fetchImageBuffer))
    const fetched = settled.filter((b): b is Buffer => b !== null)
    if (fetched.length > 0) referenceImageBuffers = fetched
  }

  let buffers: Buffer[]
  try {
    buffers = await generateMoodImage({
      categories:            [],
      prompt:                fullPrompt,
      aspectRatio,
      count,
      referenceImageBuffers,
      referenceProductTitle: productTitle || undefined,
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

  return Response.json({
    images,
    blocked:        count - images.length,
    usedReferences: (referenceImageBuffers?.length ?? 0) > 0,
  })
}
