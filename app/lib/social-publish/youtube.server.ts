/**
 * YouTube Shorts publisher — STUB until OAuth credentials exist.
 *
 * Future implementation via YouTube Data API v3:
 *   1. Refresh access token from YOUTUBE_OAUTH_REFRESH_TOKEN
 *      (POST https://oauth2.googleapis.com/token).
 *   2. Resumable upload: POST /upload/youtube/v3/videos?part=snippet,status
 *        snippet: { title (<=100 chars, the SEO surface), description
 *        (carries the real UTM'd product link — YouTube is the ONE platform
 *        with native clickable links), tags }, status: { privacyStatus,
 *        selfDeclaredMadeForKids: false, containsSyntheticMedia: true }
 *      A 9:16 video under 3 minutes is automatically a Short.
 *   3. Response id = externalPostId.
 * Docs: https://developers.google.com/youtube/v3/docs/videos/insert
 */

import type { VideoPublisher, PublishInput, PublishResult } from './types'

export const youtubePublisher: VideoPublisher = {
  platform: 'youtube',
  configured(): boolean {
    return !!process.env['YOUTUBE_OAUTH_CLIENT_ID']?.trim()
      && !!process.env['YOUTUBE_OAUTH_CLIENT_SECRET']?.trim()
      && !!process.env['YOUTUBE_OAUTH_REFRESH_TOKEN']?.trim()
  },
  async publish(_input: PublishInput): Promise<PublishResult> {
    if (!this.configured()) return { ok: false, reason: 'not_configured' }
    return { ok: false, reason: 'not_configured', detail: 'YouTube publisher not yet implemented' }
  },
}
