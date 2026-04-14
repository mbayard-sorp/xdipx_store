/**
 * api.ltx.preview.$token.$index.tsx
 *
 * Serves a generated LTX video from /tmp for preview playback.
 */

import type { LoaderFunctionArgs } from 'react-router'
import { readFileSync, existsSync } from 'node:fs'
import { requireAdmin } from '~/lib/session.server'
import { kvGet, KV_KEYS } from '~/lib/kv.server'

interface LtxKVState {
  status:      'complete' | 'error'
  videoPaths?: string[]
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request)

  const token = params.token
  const index = parseInt(params.index ?? '', 10)

  if (!token || !/^[0-9a-f]{32}$/.test(token)) {
    return new Response('Invalid token', { status: 400 })
  }
  if (!Number.isFinite(index) || index < 0 || index > 0) {
    return new Response('Invalid index', { status: 400 })
  }

  const state = await kvGet<LtxKVState>(KV_KEYS.ltxOperation(token))
  if (!state || state.status !== 'complete' || !state.videoPaths) {
    return new Response('Not found', { status: 404 })
  }

  const filePath = state.videoPaths[index]
  if (!filePath || !existsSync(filePath)) {
    return new Response('Video file not found', { status: 404 })
  }

  const buffer = readFileSync(filePath)
  return new Response(buffer, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
