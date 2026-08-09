/**
 * Provider id -> media adapter lookup (SPIKE scaffold, ticket #2018).
 *
 * Mirrors app/lib/social-publish/registry.server.ts. Only `fal` is registered:
 * it is the incumbent, wrapped thinly. `atlascloud` is intentionally absent:
 * no adapter, no key, no call path, until ADR-010 decides additive vs
 * challenger vs rejected and the owner confirms atlascloud's adult-content ToS
 * in writing (see docs/media-providers-atlascloud-spike.md, both hard gates).
 *
 * Server-only.
 */
import type { ImageProvider, VideoProvider } from './types'
import { falImageProvider, falVideoProvider } from './fal.server'

const IMAGE_PROVIDERS: Record<string, ImageProvider> = {
  fal: falImageProvider,
}

const VIDEO_PROVIDERS: Record<string, VideoProvider> = {
  fal: falVideoProvider,
}

/** The default provider until a challenger is graduated by ADR-010. */
export const DEFAULT_MEDIA_PROVIDER = 'fal'

export function getImageProvider(id: string = DEFAULT_MEDIA_PROVIDER): ImageProvider | null {
  return IMAGE_PROVIDERS[id] ?? null
}

export function getVideoProvider(id: string = DEFAULT_MEDIA_PROVIDER): VideoProvider | null {
  return VIDEO_PROVIDERS[id] ?? null
}
