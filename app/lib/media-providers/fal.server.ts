/**
 * fal.ai adapter for the media-provider seam (SPIKE scaffold, ticket #2018).
 *
 * A THIN wrapper: it delegates straight to the existing, unchanged fal modules
 * (app/lib/fal.server, app/lib/fal-video.server). No behavior change, no new
 * network shape. The neutral interfaces in ./types are structurally identical
 * to fal's current inputs/outputs, so delegation needs no mapping. This exists
 * only to prove the seam wraps the incumbent cleanly before any challenger
 * adapter is written; the real extraction refactor of the six call sites is a
 * separate, ADR-gated follow-up.
 *
 * Server-only.
 */
import { falConfigured, falGenerate } from '~/lib/fal.server'
import {
  falVideoConfigured,
  submitVideoRequest,
  getVideoRequestStatus,
  getVideoRequestResult,
  isVideoModelId,
} from '~/lib/fal-video.server'
import type {
  ImageProvider,
  VideoProvider,
  VideoGenInput,
  VideoQueueHandle,
} from './types'

export const falImageProvider: ImageProvider = {
  id: 'fal',
  configured: () => falConfigured(),
  generate: (input) => falGenerate(input),
}

export const falVideoProvider: VideoProvider = {
  id: 'fal',
  // fal carries OmniHuman 1.5, the store's audio-driven avatar tier.
  supportsAudioDriven: true,
  configured: () => falVideoConfigured(),
  submit: (modelId: string, input: VideoGenInput): Promise<VideoQueueHandle> => {
    if (!isVideoModelId(modelId)) {
      throw new Error(`[media-providers/fal] unknown fal video model "${modelId}"`)
    }
    return submitVideoRequest(modelId, input)
  },
  status: (handle: VideoQueueHandle) => getVideoRequestStatus(handle),
  result: (handle: VideoQueueHandle) => getVideoRequestResult(handle),
}
