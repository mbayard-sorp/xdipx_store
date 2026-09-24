/**
 * Provider id -> media adapter lookup (ticket #2018 scaffold, adapter added
 * under owner direction 2026-08-15, video seam wired by ADR-016 2026-09-23).
 *
 * Mirrors app/lib/social-publish/registry.server.ts. `atlascloud` is the
 * still-image default (ADR-010) and, since ADR-016, the video primary:
 * InfiniteTalk closed the audio-driven parity gap that kept video on fal.
 * `wavespeed` is the video mirror, reached only through submitVideoWithMirror
 * below. `fal` stays registered so historical video rows still resolve.
 *
 * Server-only.
 */
import type { ImageProvider, VideoGenInput, VideoProvider, VideoQueueHandle } from './types'
import { falImageProvider, falVideoProvider } from './fal.server'
import { atlascloudImageProvider } from './atlascloud.server'
import { AtlasVideoSubmitError, atlascloudVideoProvider } from './atlascloud-video.server'
import { wavespeedMirrorFor, wavespeedVideoProvider } from './wavespeed-video.server'

const IMAGE_PROVIDERS: Record<string, ImageProvider> = {
  fal: falImageProvider,
  atlascloud: atlascloudImageProvider,
}

const VIDEO_PROVIDERS: Record<string, VideoProvider> = {
  fal: falVideoProvider,
  atlascloud: atlascloudVideoProvider,
  wavespeed: wavespeedVideoProvider,
}

/** Still-image default since 2026-08-15 (owner direction; ADR-010). */
export const DEFAULT_IMAGE_PROVIDER = 'atlascloud'
/** Video default since ADR-016 (2026-09-23). A spec with no `provider` is still fal. */
export const DEFAULT_VIDEO_PROVIDER = 'atlascloud'

export function getImageProvider(id: string = DEFAULT_IMAGE_PROVIDER): ImageProvider | null {
  return IMAGE_PROVIDERS[id] ?? null
}

export function getVideoProvider(id: string = DEFAULT_VIDEO_PROVIDER): VideoProvider | null {
  return VIDEO_PROVIDERS[id] ?? null
}

/**
 * The adapter for a tier's `provider` field, throwing a clear error when none
 * is registered. A VideoModelSpec with no provider is fal (the registry's
 * historical default); 'runpod' has no adapter since ADR-016, so a RunPod row
 * fails loudly instead of reaching the retired worker.
 */
export function requireVideoProvider(specProvider: string | undefined): VideoProvider {
  const id = specProvider ?? 'fal'
  const p = VIDEO_PROVIDERS[id]
  if (!p) {
    throw new Error(
      `No video provider adapter is registered for "${id}"` +
      (id === 'runpod' ? ' (RunPod video is retired, ADR-016; re-file the job on an Atlas tier)' : ''),
    )
  }
  return p
}

/**
 * The adapter that issued a persisted handle. A mirror-issued handle must be
 * polled on the mirror even though the tier's spec names the primary, so the
 * poll host decides first and the spec's provider is the fallback.
 */
export function providerForHandle(handle: VideoQueueHandle, specProvider: string | undefined): VideoProvider {
  for (const p of Object.values(VIDEO_PROVIDERS)) {
    if (p.ownsHandle?.(handle)) return p
  }
  return requireVideoProvider(specProvider)
}

/**
 * Gateway statuses where the origin may already have accepted the render: the
 * edge timed out or lost the upstream response, not the request.
 */
const AMBIGUOUS_GATEWAY_STATUSES = new Set([502, 504, 524])

/**
 * Whether a primary submit failure may be retried on the mirror. Only when
 * Atlas answered with an error envelope that proves the render was NOT
 * accepted: an AtlasVideoSubmitError (a response was received and classified),
 * not a content refusal (a verdict on the content, not the provider), and not a
 * gateway status that may hide an accepted render. Everything else rethrows:
 * a network error after the POST (the render may be running), an input read or
 * uploadMedia failure, a body validation error, a 200 with no id.
 *
 * Residual bound: a duplicate needs Atlas to return a non-gateway error
 * envelope for a render it nonetheless ran. Then at most one duplicate per
 * submit, on a mirrored tier only (Grok is not mirrored): at most one
 * InfiniteTalk part, capped at maxRenderSeconds 30 x $0.06/s = $1.80, about
 * $0.60 for a typical 10 s part; $0.10 for Wan 2.2 Turbo.
 */
export function isMirrorableSubmitError(err: unknown): boolean {
  if (!(err instanceof AtlasVideoSubmitError)) return false
  if (err.kind === 'content') return false
  if (AMBIGUOUS_GATEWAY_STATUSES.has(err.httpStatus)) return false
  return true
}

/**
 * Submit a tier's render, applying the mirror rule (ADR-016):
 *  - the primary (the spec's provider) is always tried first when configured;
 *  - the Wavespeed mirror is used ONLY when the primary is Atlas and it is
 *    unconfigured, or its submit returned an error envelope that proves the
 *    render was not accepted (isMirrorableSubmitError: balance exhaustion,
 *    non-gateway 5xx, 429, unknown model, rejected input), and only for tiers
 *    with a like-for-like mirror endpoint;
 *  - never load-balanced: a healthy Atlas takes every render.
 * Returns the handle and the provider that actually took it.
 */
export async function submitVideoWithMirror(
  tierId: string,
  specProvider: string | undefined,
  input: VideoGenInput,
  deps: { log?: (msg: string) => void } = {},
): Promise<{ handle: VideoQueueHandle; providerId: VideoProvider['id'] }> {
  const primary = requireVideoProvider(specProvider)
  const mirror = primary.id === 'atlascloud' && wavespeedMirrorFor(tierId) ? wavespeedVideoProvider : null
  const log = deps.log ?? ((m: string) => console.warn(m))

  if (primary.configured()) {
    try {
      return { handle: await primary.submit(tierId, input), providerId: primary.id }
    } catch (err) {
      if (!mirror || !mirror.configured() || !isMirrorableSubmitError(err)) throw err
      log(`[media-providers] ${primary.id} submit failed for ${tierId}, using the ${mirror.id} mirror: ${String(err).slice(0, 300)}`)
      return { handle: await mirror.submit(tierId, input), providerId: mirror.id }
    }
  }
  if (mirror && mirror.configured()) {
    log(`[media-providers] ${primary.id} is not configured, using the ${mirror.id} mirror for ${tierId}`)
    return { handle: await mirror.submit(tierId, input), providerId: mirror.id }
  }
  throw new Error(`Video provider ${primary.id} is not configured for ${tierId}${mirror ? ' and its mirror is not configured either' : ''}`)
}
