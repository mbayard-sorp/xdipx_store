/**
 * The one publisher interface every platform adapter implements. Swapping a
 * stub for a live adapter never touches the registry or calling code.
 *
 * Live posting is DOUBLE-gated: the video_team_autopublish valve AND the
 * platform's env keys (configured()). Until both exist, publish() returns
 * { ok: false, reason: 'not_configured' } and the Social Studio renders the
 * manual-post affordances (copy caption + download video) instead.
 */

export type PublishResult =
  | { ok: true; externalPostId: string }
  | { ok: false; reason: 'not_configured' | 'error'; detail?: string }

/**
 * Drafts arrive as either a still (the daily social routine's 1:1 Instagram
 * asset) or a video (fanned out from the video pipeline). Platforms take
 * different container parameters for each, so the shape is explicit rather
 * than inferred from the file extension at the adapter.
 */
export type PublishMedia =
  | { kind: 'image'; imageUrl: string }
  | { kind: 'video'; videoUrl: string; posterUrl?: string }
  /** Multi-image Instagram carousel (2-10 slides). social_posts.media_urls. */
  | { kind: 'carousel'; imageUrls: string[] }

export interface PublishInput {
  postId: number
  media: PublishMedia
  caption: string
}

export interface SocialPublisher {
  platform: 'instagram' | 'tiktok' | 'youtube' | 'x'
  /** True when this platform's env keys are all present. */
  configured(): boolean
  publish(input: PublishInput): Promise<PublishResult>
}
