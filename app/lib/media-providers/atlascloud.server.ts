/**
 * Atlas Cloud adapter for the media-provider seam.
 *
 * A THIN wrapper delegating to app/lib/atlas.server (the real client), exactly
 * as ./fal.server wraps the fal modules. Image-only: Atlas video (Wan-family
 * i2v) has no OmniHuman audio-driven parity, so no VideoProvider is exported
 * here — see docs/media-providers-atlascloud-spike.md §1.3.
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
