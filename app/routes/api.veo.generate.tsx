/**
 * api.veo.generate.tsx
 *
 * Starts a Google Veo video generation job:
 *   1. Enhance user prompt via Claude
 *   2. Optionally fetch starting image buffer
 *   3. Call Veo API (returns async operation handle)
 *   4. Persist operation state to KV
 *   5. Return token for polling
 */

import type { ActionFunctionArgs } from 'react-router'
import { randomBytes } from 'node:crypto'
import { requireAdmin } from '~/lib/session.server'
import { apiError } from '~/lib/api-error.server'
import { enhanceVeoPrompt } from '~/lib/claude.server'
import { startVeoGeneration, validateVeoOptions, type VeoGenerateOptions } from '~/lib/veo.server'
import { kvSet, KV_KEYS } from '~/lib/kv.server'

const VALID_ASPECT_RATIOS = new Set(['16:9', '9:16'])
const VALID_DURATIONS     = new Set([4, 6, 8])
const VALID_RESOLUTIONS   = new Set(['720p', '1080p', '4k'])
const VALID_PERSON_GEN    = new Set(['allow_all', 'allow_adult'])

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  const form = await request.formData()

  const productId   = form.get('productId')   as string
  const productName = form.get('productName') as string
  const brand       = form.get('brand')       as string
  const category    = (form.get('category')   as string) || ''
  const userPrompt  = form.get('prompt')      as string

  const aspectRatio      = form.get('aspectRatio')      as string
  const durationRaw      = parseInt(form.get('duration') as string, 10)
  const resolution       = (form.get('resolution') as string) || '720p'
  const personGeneration = (form.get('personGeneration') as string) || 'allow_adult'
  const numberOfVideos   = Math.min(2, Math.max(1, parseInt(form.get('numberOfVideos') as string, 10) || 1))
  const startingImageUrl = (form.get('startingImageUrl') as string) || null
  const imageMode        = (form.get('imageMode') as string) || 'start_frame'

  // ── Validate required fields ───────────────────────────────────────────────
  if (!productId || !productName || !brand) {
    return Response.json({ error: 'Missing required fields: productId, productName, brand' }, { status: 400 })
  }
  if (!userPrompt?.trim()) {
    return Response.json({ error: 'A video idea/prompt is required' }, { status: 400 })
  }
  if (!VALID_ASPECT_RATIOS.has(aspectRatio)) {
    return Response.json({ error: 'aspectRatio must be "16:9" or "9:16"' }, { status: 400 })
  }
  if (!VALID_DURATIONS.has(durationRaw)) {
    return Response.json({ error: 'duration must be 4, 6, or 8' }, { status: 400 })
  }
  if (!VALID_RESOLUTIONS.has(resolution)) {
    return Response.json({ error: 'resolution must be "720p", "1080p", or "4k"' }, { status: 400 })
  }
  if (!VALID_PERSON_GEN.has(personGeneration)) {
    return Response.json({ error: 'personGeneration must be "allow_all" or "allow_adult"' }, { status: 400 })
  }

  const durationSeconds = durationRaw as 4 | 6 | 8

  // ── Step 1: Enhance prompt via Claude ──────────────────────────────────────
  let enhancedPrompt: string
  try {
    enhancedPrompt = await enhanceVeoPrompt({
      userIdea:        userPrompt,
      productTitle:    productName,
      productBrand:    brand,
      ...(category ? { productCategory: category } : {}),
      hasStartingImage: !!startingImageUrl,
      imageMode:        imageMode as 'start_frame' | 'reference',
      aspectRatio:     aspectRatio as '16:9' | '9:16',
      durationSeconds,
    })
  } catch (err) {
    console.warn('[veo.generate] Claude prompt enhancement failed, using raw prompt:', err)
    enhancedPrompt = userPrompt
  }

  // ── Step 2: Fetch starting image if provided ──────────────────────────────
  let startingImage: Buffer | undefined
  if (startingImageUrl) {
    try {
      const res = await fetch(startingImageUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      startingImage = Buffer.from(await res.arrayBuffer())
    } catch (err) {
      return apiError('veo.generate', err, 'Failed to fetch starting image', 400)
    }
  }

  // ── Step 3: Build options and validate ─────────────────────────────────────
  const opts: VeoGenerateOptions = {
    prompt: enhancedPrompt,
    aspectRatio:      aspectRatio as '16:9' | '9:16',
    durationSeconds,
    personGeneration: personGeneration as 'allow_all' | 'allow_adult',
    resolution:       resolution as '720p' | '1080p' | '4k',
    numberOfVideos:   numberOfVideos as 1 | 2,
    ...(startingImage ? { startingImage, imageMode: imageMode as 'start_frame' | 'reference' } : {}),
  }

  const validationError = validateVeoOptions(opts)
  if (validationError) {
    return Response.json({ error: validationError }, { status: 400 })
  }

  // ── Step 4: Start Veo generation ──────────────────────────────────────────
  let operationState: Awaited<ReturnType<typeof startVeoGeneration>>
  try {
    operationState = await startVeoGeneration(opts)
  } catch (err) {
    return apiError('veo.generate', err, 'Veo generation failed', 502)
  }

  // ── Step 5: Persist to KV and return token ────────────────────────────────
  const token = randomBytes(16).toString('hex')

  await kvSet(KV_KEYS.veoOperation(token), {
    status:          'generating',
    operationName:   operationState.operationName,
    enhancedPrompt,
    productId,
    productName,
    startedAt:       Date.now(),
  }, 3600) // 1 hour TTL

  return Response.json({
    ok: true,
    token,
    enhancedPrompt,
  })
}
