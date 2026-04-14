/**
 * api.ltx.enhance-prompt.tsx
 *
 * Standalone endpoint to enhance an LTX prompt via Claude
 * without triggering video generation.
 */

import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { enhanceLtxPrompt } from '~/lib/claude.server'
import { apiError } from '~/lib/api-error.server'

const VALID_CAMERA = new Set([
  'dolly_in', 'dolly_out', 'dolly_left', 'dolly_right',
  'jib_up', 'jib_down', 'static', 'focus_shift',
])

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  const form = await request.formData()

  const userPrompt   = form.get('prompt')      as string
  const productName  = form.get('productName') as string
  const brand        = form.get('brand')       as string
  const category     = (form.get('category')   as string) || ''
  const resolution   = (form.get('resolution') as string) || '720p'
  const duration     = parseInt(form.get('duration') as string, 10) || 8
  const cameraMotion = (form.get('cameraMotion') as string) || ''

  if (!userPrompt?.trim()) {
    return Response.json({ error: 'A prompt is required' }, { status: 400 })
  }
  if (!productName || !brand) {
    return Response.json({ error: 'Missing productName or brand' }, { status: 400 })
  }

  try {
    const enhanced = await enhanceLtxPrompt({
      userIdea:        userPrompt,
      productTitle:    productName,
      productBrand:    brand,
      ...(category ? { productCategory: category } : {}),
      hasStartingImage: true,
      resolution,
      durationSeconds: duration,
      ...(cameraMotion && VALID_CAMERA.has(cameraMotion) ? { cameraMotion } : {}),
    })

    return Response.json({ ok: true, enhanced })
  } catch (err) {
    return apiError('ltx.enhance-prompt', err, 'Prompt enhancement failed', 502)
  }
}
