/**
 * POST /api/team/social-post — DRAFT-ONLY social post writes.
 *
 *   { op: 'draft', platform, postType?, tweetText, mediaUrls?, dealHistoryId? } -> { id }
 *   { op: 'list', status? } -> { posts: [...] }
 *
 * The social-media-manager stub's only write path. Rows land in social_posts
 * with status='draft' for human review/posting from /admin/socials. There is
 * INTENTIONALLY no live-post op here and no import of twitter.server.ts —
 * graduating to autoposting means flipping `social_team_autopost` AND
 * `X_AUTO_POST_ENABLED` and building that path deliberately, not flipping a
 * payload field.
 */

import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth, createDraftSocialPost, listSocialPosts } from '~/lib/team.server'

const PLATFORMS = ['x', 'instagram', 'tiktok', 'facebook']

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>

  if (b['op'] === 'draft') {
    if (typeof b['platform'] !== 'string' || !PLATFORMS.includes(b['platform'])) {
      return new Response(`Bad Request: platform must be one of ${PLATFORMS.join('|')}`, { status: 400 })
    }
    if (typeof b['tweetText'] !== 'string' || !b['tweetText']) {
      return new Response('Bad Request: tweetText required', { status: 400 })
    }
    const mediaUrls = Array.isArray(b['mediaUrls'])
      ? (b['mediaUrls'] as unknown[]).filter((u): u is string => typeof u === 'string')
      : undefined
    const id = await createDraftSocialPost({
      platform:      b['platform'],
      postType:      typeof b['postType'] === 'string' && b['postType'].length <= 20 ? b['postType'] : 'manual',
      tweetText:     b['tweetText'],
      mediaUrls,
      dealHistoryId: typeof b['dealHistoryId'] === 'number' ? b['dealHistoryId'] : undefined,
    })
    return Response.json({ id })
  }

  if (b['op'] === 'list') {
    const posts = await listSocialPosts(typeof b['status'] === 'string' ? b['status'] : undefined)
    return Response.json({ posts })
  }

  return new Response('Bad Request', { status: 400 })
}
