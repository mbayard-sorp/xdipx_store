/**
 * Atlas Cloud adapter for the media-provider seam.
 *
 * A THIN wrapper delegating to app/lib/atlas.server (the real client), exactly
 * as ./fal.server wraps the fal modules. Image-only. The Atlas VideoProvider
 * lives in ./atlascloud-video.server (ADR-016: InfiniteTalk closed the
 * audio-driven parity gap in docs/media-providers-atlascloud-spike.md §1.3).
 *
 * Server-only.
 */
import { atlasConfigured, atlasGenerate } from '~/lib/atlas.server'
import type { ImageProvider } from './types'

export const atlascloudImageProvider: ImageProvider = {
  id: 'atlascloud',
  configured: () => atlasConfigured(),
  generate: (input) => atlasGenerate(input),
}
