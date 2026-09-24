/**
 * Provider-neutral media-generation seam (SPIKE scaffold, ticket #2018).
 *
 * The store generates stills and video through fal.ai today (app/lib/fal.server
 * and app/lib/fal-video.server), reached from six call sites. This file sketches
 * the interfaces a second provider (evaluated: atlascloud.ai, Wan 2.7 Spicy)
 * would implement so a swap never touches calling code. The same shape the
 * social-publish and ad-publish registries already use.
 *
 * Status (ADR-016, 2026-09-23): the video pipeline's clip and avatar stages
 * call the VideoProvider seam through registry.server.ts. Adapters: fal
 * (legacy, historical rows only), atlascloud (primary), wavespeed (mirror).
 *
 * The neutral shapes below are deliberately structurally identical to fal's
 * current inputs/outputs, so the fal wrapper delegates with zero mapping. A
 * challenger provider maps ITS REST shape into these types inside its own
 * adapter. The interface, not fal, is the contract.
 *
 * Pure types (no runtime, no server-only imports): safe to import anywhere.
 */

/**
 * Every media provider the seam knows. Video (ADR-016, 2026-09-23): `atlascloud`
 * is the primary, `wavespeed` its mirror, `fal` stays registered only so
 * historical rows resolve. RunPod is not a seam provider; its pipeline branches
 * were removed in ADR-016 and its module is deleted in Phase 4.
 */
export type ProviderId = 'fal' | 'atlascloud' | 'wavespeed'

/* ─── Still image generation ──────────────────────────────────────────── */

export interface ImageGenInput {
  prompt: string
  /** How many images (default 1, capped 4 by the adapter). */
  count?: number
  /** Provider-scoped model endpoint id. Defaults to the provider's house model. */
  model?: string
  /** Provider image-size enum, or an explicit {width,height}. */
  imageSize?: string | { width: number; height: number }
  /**
   * Publicly fetchable reference image (e.g. a real Shopify product photo). When
   * set, a provider that supports it routes to its reference/edit endpoint so the
   * actual product appears in the scene instead of a model-invented lookalike.
   */
  refImageUrl?: string
}

export interface ImageGenResult {
  buffers: Buffer[]
  /** Cost key understood by model-pricing (e.g. 'fal/flux-dev'). */
  costKey: string
}

export interface ImageProvider {
  id: ProviderId
  /** True when this provider's env keys are all present. */
  configured(): boolean
  generate(input: ImageGenInput): Promise<ImageGenResult>
}

/* ─── Video generation (async queue) ──────────────────────────────────── */

/**
 * Structurally identical to fal-video's QueueHandle and to the
 * `providerRequestIds` jsonb shape on video_jobs (db/schema.ts), so a new
 * provider needs no schema change. Providers with one poll endpoint (Atlas,
 * Wavespeed) set statusUrl and responseUrl to the same URL.
 */
export interface VideoQueueHandle {
  requestId: string
  statusUrl: string
  responseUrl: string
}

export type VideoQueueStatus = 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'

export interface VideoGenInput {
  prompt: string
  /** Publicly fetchable first-frame / reference image. */
  imageUrl: string
  durationSeconds: number
  aspect?: '9:16' | '16:9'
  generateAudio?: boolean
  negativePrompt?: string
  /** Speech track URL for audio-driven (talking-head) models. */
  audioUrl?: string
  /**
   * The gated line a native-audio model speaks in its own voice (Grok on
   * Atlas has no dialogue field; the adapter writes it into the prompt as
   * `She looks into the lens and says: "<line>"`). Ignored by models that
   * take an audio track.
   */
  spokenLine?: string
}

/** Result of one status poll. `error` carries the provider's own message on FAILED. */
export interface VideoStatusResult {
  status: VideoQueueStatus
  error?: string
}

export interface VideoGenResult {
  videoUrl: string
  contentType: string
}

export interface VideoProvider {
  id: ProviderId
  /** True when this provider's env keys are all present. */
  configured(): boolean
  /**
   * True when this provider can perform the OmniHuman-class audio-driven
   * talking-head workload (TTS speech track + one identity frame -> performed
   * video). This is a HARD parity requirement for any avatar-tier replacement;
   * Wan 2.7 Spicy is image/reference-to-video and does NOT satisfy it.
   */
  supportsAudioDriven: boolean
  /**
   * `modelId` is the store's tier id (a VideoModelId such as
   * 'italk-atlas'); each adapter maps it to its own endpoint.
   */
  submit(modelId: string, input: VideoGenInput): Promise<VideoQueueHandle>
  status(handle: VideoQueueHandle): Promise<VideoStatusResult>
  result(handle: VideoQueueHandle): Promise<VideoGenResult>
  /** Whether this adapter can render the given tier id. Used by the mirror picker. */
  supportsModel?(modelId: string): boolean
  /**
   * Whether a persisted handle was issued by this provider (by poll host).
   * Lets the poller route a handle the mirror issued back to the mirror.
   */
  ownsHandle?(handle: VideoQueueHandle): boolean
}
