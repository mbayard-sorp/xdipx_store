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

export interface PublishInput {
  postId: number
  videoUrl: string
  posterUrl?: string
  caption: string
}

export interface VideoPublisher {
  platform: 'instagram' | 'tiktok' | 'youtube'
  /** True when this platform's env keys are all present. */
  configured(): boolean
  publish(input: PublishInput): Promise<PublishResult>
}
