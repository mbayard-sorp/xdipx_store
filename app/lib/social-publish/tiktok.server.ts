/**
 * TikTok publisher — STUB until a TikTok developer app is approved.
 *
 * Future implementation via the Content Posting API (Direct Post):
 *   1. POST https://open.tiktokapis.com/v2/post/publish/video/init/
 *        { post_info: { title, privacy_level, disable_comment? },
 *          source_info: { source: 'PULL_FROM_URL', video_url } }
 *      -> { data: { publish_id } }   (video_url domain must be verified)
 *   2. Poll POST /v2/post/publish/status/fetch/ { publish_id } until
 *      PUBLISH_COMPLETE -> externalPostId.
 * Auth: TIKTOK_CONTENT_ACCESS_TOKEN (user token, video.publish scope; app
 * review required). Docs: https://developers.tiktok.com/doc/content-posting-api-get-started
 *
 * NOTE: TikTok is the highest organic-moderation-risk platform for this
 * category. Rollout order is IG Reels + YouTube Shorts first, TikTok last,
 * regardless of when keys arrive.
 */

import type { SocialPublisher, PublishInput, PublishResult } from './types'

export const tiktokPublisher: SocialPublisher = {
  platform: 'tiktok',
  configured(): boolean {
    return !!process.env['TIKTOK_CLIENT_KEY']?.trim()
      && !!process.env['TIKTOK_CLIENT_SECRET']?.trim()
      && !!process.env['TIKTOK_CONTENT_ACCESS_TOKEN']?.trim()
  },
  async publish(_input: PublishInput): Promise<PublishResult> {
    if (!this.configured()) return { ok: false, reason: 'not_configured' }
    return { ok: false, reason: 'not_configured', detail: 'TikTok publisher not yet implemented' }
  },
}
