/**
 * Provider-neutral media-generation seam (SPIKE scaffold, ticket #2018).
 *
 * The store generates stills and video through fal.ai today (app/lib/fal.server
 * and app/lib/fal-video.server), reached from six call sites. This file sketches
 * the interfaces a second provider (evaluated: atlascloud.ai, Wan 2.7 Spicy)
 * would implement so a swap never touches calling code. The same shape the
 * social-publish and ad-publish registries already use.
 *
 * SCAFFOLD ONLY. No adapter beyond the thin fal wrapper exists yet, no atlascloud
 * key is used, and no production call path imports this. The follow-up adapter
 * build is GATED on ADR-010 (see docs/media-providers-atlascloud-spike.md).
 *
 * The neutral shapes below are deliberately structurally identical to fal's
 * current inputs/outputs, so the fal wrapper delegates with zero mapping. A
 * challenger provider maps ITS REST shape into these types inside its own
 * adapter. The interface, not fal, is the contract.
 *
 * Pure types (no runtime, no server-only imports): safe to import anywhere.
 */

/** Every media provider the seam knows. `atlascloud` is scaffolded, not wired. */
export type ProviderId = 'fal' | 'atlascloud'

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
  submit(modelId: string, input: VideoGenInput): Promise<VideoQueueHandle>
  status(handle: VideoQueueHandle): Promise<{ status: VideoQueueStatus }>
  result(handle: VideoQueueHandle): Promise<VideoGenResult>
}
