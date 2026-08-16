/**
 * Provider id -> media adapter lookup (ticket #2018 scaffold, adapter added
 * under owner direction 2026-08-15).
 *
 * Mirrors app/lib/social-publish/registry.server.ts. `atlascloud` is the
 * still-image default (ADR-010 decision, owner-directed): fal's failure rate
 * on this vertical made it unfit as the site image pipeline. Video stays on
 * fal — the OmniHuman audio-driven avatar tier has no Atlas parity (the §1.3
 * HARD blocker in docs/media-providers-atlascloud-spike.md), as does BiRefNet
 * background removal.
 *
 * Server-only.
 */
import type { ImageProvider, VideoProvider } from './types'
import { falImageProvider, falVideoProvider } from './fal.server'
import { atlascloudImageProvider } from './atlascloud.server'

const IMAGE_PROVIDERS: Record<string, ImageProvider> = {
  fal: falImageProvider,
  atlascloud: atlascloudImageProvider,
}

const VIDEO_PROVIDERS: Record<string, VideoProvider> = {
  fal: falVideoProvider,
}

/** Still-image default since 2026-08-15 (owner direction; ADR-010). */
export const DEFAULT_IMAGE_PROVIDER = 'atlascloud'
/** Video default: fal, for the avatar-tier parity reason above. */
export const DEFAULT_VIDEO_PROVIDER = 'fal'

export function getImageProvider(id: string = DEFAULT_IMAGE_PROVIDER): ImageProvider | null {
  return IMAGE_PROVIDERS[id] ?? null
}

export function getVideoProvider(id: string = DEFAULT_VIDEO_PROVIDER): VideoProvider | null {
  return VIDEO_PROVIDERS[id] ?? null
}
