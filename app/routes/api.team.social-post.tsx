/**
 * POST /api/team/social-post — DRAFT-ONLY social post writes.
 *
 *   { op: 'draft', platform, postType?, tweetText, mediaUrls?, dealHistoryId?,
 *     scheduledFor?, reworkedFrom?,
 *     voiceGate: { verdict:'PASS', reviewer, addendum?, notes? } } -> { id }
 *   { op: 'list', status?, reviewStatus? } -> { posts: [...] }
 *   { op: 'config' } -> { frequencies, autopostValve }
 *
 * The social-media-manager stub's only write path. Rows land in social_posts
 * with status='draft' AND review_status='pending_review' for human review in
 * /admin/socials (Social Studio). There is INTENTIONALLY no live-post op here
 * and no import of twitter.server.ts — graduating to autoposting means
 * flipping `social_team_autopost` AND `X_AUTO_POST_ENABLED` and building that
 * path deliberately, not flipping a payload field.
 *
 * The `draft` op FAILS CLOSED on the voice gate (ticket #3208). Because this is
 * the only path a draft reaches pending_review, the mandatory Step 4a
 * emma-empathy-reviewer verdict is required in the payload as `voiceGate` and a
 * missing or non-PASS verdict is a 400 — the draft is not created. If the voice
 * gate could not run, the routine has no PASS to send and cannot draft, which is
 * exactly the required behaviour: a draft never enters the review queue without a
 * real voice-gate PASS asserted for it.
 *
 * Review state (approve / needs_changes / reject + feedback) is owner-only via
 * the /admin/socials action — there is no op here to write it. The agent READS
 * review outcomes through op:'list' (feedback and editedText come back
 * verbatim: that is the training channel) and its per-platform quota through
 * op:'config' (social_freq_* keys, posts/day, 0 = platform off).
 */

import type { ActionFunctionArgs } from 'react-router'
import {
  assertTeamAuth,
  createDraftSocialPost,
  listSocialPosts,
  getSocialFrequencies,
  getValve,
  VALVE_KEYS,
} from '~/lib/team.server'
import { SOCIAL_PLATFORMS, SOCIAL_REVIEW_STATUSES } from '~/lib/team-keys'
import { parseVoiceGateVerdict } from '~/lib/social-voice-gate.server'

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>

  if (b['op'] === 'draft') {
    if (typeof b['platform'] !== 'string' || !(SOCIAL_PLATFORMS as readonly string[]).includes(b['platform'])) {
      return new Response(`Bad Request: platform must be one of ${SOCIAL_PLATFORMS.join('|')}`, { status: 400 })
    }
    if (typeof b['tweetText'] !== 'string' || !b['tweetText']) {
      return new Response('Bad Request: tweetText required', { status: 400 })
    }
    if (b['scheduledFor'] !== undefined &&
        (typeof b['scheduledFor'] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b['scheduledFor']))) {
      return new Response('Bad Request: scheduledFor must be YYYY-MM-DD', { status: 400 })
    }
    // Fail-closed voice gate (ticket #3208): no PASS verdict, no draft. This is the
    // only path to pending_review, so the mandatory Step 4a gate is enforced here.
    const gate = parseVoiceGateVerdict(b['voiceGate'])
    if (!gate.ok) {
      return new Response(gate.error, { status: gate.status })
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
      scheduledFor:  typeof b['scheduledFor'] === 'string' ? b['scheduledFor'] : undefined,
      reworkedFrom:  typeof b['reworkedFrom'] === 'number' ? b['reworkedFrom'] : undefined,
      videoJobId:    typeof b['videoJobId'] === 'number' ? b['videoJobId'] : undefined,
      posterUrl:     typeof b['posterUrl'] === 'string' ? b['posterUrl'] : undefined,
    })
    return Response.json({ id })
  }

  if (b['op'] === 'list') {
    const reviewStatus =
      typeof b['reviewStatus'] === 'string' && (SOCIAL_REVIEW_STATUSES as readonly string[]).includes(b['reviewStatus'])
        ? b['reviewStatus']
        : undefined
    const posts = await listSocialPosts(
      typeof b['status'] === 'string' ? b['status'] : undefined,
      50,
      reviewStatus,
    )
    return Response.json({ posts })
  }

  if (b['op'] === 'config') {
    const [frequencies, autopostValve] = await Promise.all([
      getSocialFrequencies(),
      getValve(VALVE_KEYS.socialAutopost),
    ])
    return Response.json({ frequencies, autopostValve })
  }

  return new Response('Bad Request', { status: 400 })
}
