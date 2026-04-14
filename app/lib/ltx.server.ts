/**
 * ltx.server.ts
 *
 * LTX Video API client — image-to-video generation using ltx-2-3-fast.
 * The LTX API is synchronous: it returns the video binary directly in the response.
 */

const LTX_API_BASE = 'https://api.ltx.video/v1'

// ─── Types ──────────────────────────────────────────────────────────────────

export type LtxResolution = '480p' | '720p' | '1080p'
export type LtxAspectRatio = '16:9' | '9:16'

const RESOLUTION_MAP: Record<`${LtxResolution}-${LtxAspectRatio}`, string> = {
  '480p-16:9':  '848x480',
  '480p-9:16':  '480x848',
  '720p-16:9':  '1280x720',
  '720p-9:16':  '720x1280',
  '1080p-16:9': '1920x1080',
  '1080p-9:16': '1080x1920',
}
export type LtxFps = 24 | 25 | 48 | 50
export type LtxCameraMotion =
  | 'dolly_in' | 'dolly_out' | 'dolly_left' | 'dolly_right'
  | 'jib_up' | 'jib_down' | 'static' | 'focus_shift'

export interface LtxGenerateOptions {
  prompt: string
  imageUri: string
  duration: number
  resolution: LtxResolution
  aspectRatio?: LtxAspectRatio
  fps?: LtxFps
  cameraMotion?: LtxCameraMotion
}

// ─── Duration Validation ────────────────────────────────────────────────────

const FULL_DURATIONS = [6, 8, 10, 12, 14, 16, 18, 20] as const
const SHORT_DURATIONS = [6, 8, 10] as const

export function getValidLtxDurations(resolution: LtxResolution | string, fps: LtxFps | number): readonly number[] {
  if (resolution === '1080p' && (fps === 24 || fps === 25)) {
    return FULL_DURATIONS
  }
  // 480p/720p or higher fps → shorter durations
  return SHORT_DURATIONS
}

export function validateLtxOptions(opts: LtxGenerateOptions): string | null {
  const fps = opts.fps ?? 24
  const validDurations = getValidLtxDurations(opts.resolution, fps)

  if (!validDurations.includes(opts.duration)) {
    return `Duration ${opts.duration}s is not valid for ${opts.resolution} @ ${fps}fps. Valid: ${validDurations.join(', ')}s`
  }
  if (!opts.prompt?.trim()) return 'Prompt is required'
  if (!opts.imageUri?.trim()) return 'Image URI is required'

  return null
}

// ─── Generation ─────────────────────────────────────────────────────────────

export async function generateLtxVideo(opts: LtxGenerateOptions): Promise<Buffer> {
  const apiKey = process.env['LTX_API_KEY']
  if (!apiKey) throw new Error('LTX_API_KEY environment variable is not set')

  const body: Record<string, unknown> = {
    model: 'ltx-2-3-fast',
    prompt: opts.prompt,
    image_uri: opts.imageUri,
    duration: opts.duration,
    resolution: RESOLUTION_MAP[`${opts.resolution}-${opts.aspectRatio ?? '16:9'}`],
    generate_audio: false, // ltx-2-3-fast does not support audio
  }

  if (opts.fps) body.fps = opts.fps
  if (opts.cameraMotion) body.camera_motion = opts.cameraMotion

  const res = await fetch(`${LTX_API_BASE}/image-to-video`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    let errorMsg: string
    try {
      const errData = await res.json() as Record<string, unknown>
      // LTX error shape can vary — extract a readable message
      const errField = errData.error
      if (typeof errField === 'string') {
        errorMsg = errField
      } else if (errField && typeof errField === 'object') {
        const nested = errField as Record<string, unknown>
        errorMsg = (nested.message ?? nested.detail ?? JSON.stringify(errField)) as string
      } else {
        errorMsg = errData.message as string ?? errData.detail as string ?? JSON.stringify(errData)
      }
      if (errData.type) errorMsg = `[${errData.type}] ${errorMsg}`
    } catch {
      errorMsg = `LTX API error ${res.status}: ${await res.text().catch(() => 'unknown')}`
    }
    throw new Error(errorMsg)
  }

  const arrayBuffer = await res.arrayBuffer()
  if (arrayBuffer.byteLength === 0) {
    throw new Error('LTX API returned an empty response')
  }

  return Buffer.from(arrayBuffer)
}
