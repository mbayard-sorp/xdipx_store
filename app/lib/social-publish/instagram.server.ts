/**
 * Instagram Reels publisher — STUB until IG Graph API keys exist.
 *
 * Future implementation (documented so wiring it is a fill-in, not a design):
 *   1. POST /{IG_BUSINESS_ACCOUNT_ID}/media
 *        { media_type: 'REELS', video_url, caption, cover_url, share_to_feed: true }
 *      -> { id: containerId }   (video_url must be a public URL — Blob qualifies)
 *   2. Poll GET /{containerId}?fields=status_code until FINISHED (video ingest).
 *   3. POST /{IG_BUSINESS_ACCOUNT_ID}/media_publish { creation_id: containerId }
 *      -> { id: mediaId }  = externalPostId
 * Auth: IG_GRAPH_ACCESS_TOKEN (long-lived page token, instagram_content_publish
 * scope). Docs: https://developers.facebook.com/docs/instagram-api/guides/content-publishing
 */

import type { VideoPublisher, PublishInput, PublishResult } from './types'

export const instagramPublisher: VideoPublisher = {
  platform: 'instagram',
  configured(): boolean {
    return !!process.env['IG_GRAPH_ACCESS_TOKEN']?.trim() && !!process.env['IG_BUSINESS_ACCOUNT_ID']?.trim()
  },
  async publish(_input: PublishInput): Promise<PublishResult> {
    if (!this.configured()) return { ok: false, reason: 'not_configured' }
    // Keys exist but the live path is deliberately unimplemented until the
    // owner graduates the stub (see docblock for the exact call sequence).
    return { ok: false, reason: 'not_configured', detail: 'IG publisher not yet implemented' }
  },
}
