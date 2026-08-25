/**
 * POST /api/team/social-post — DRAFT-ONLY social post writes.
 *
 *   { op: 'draft', platform, postType?, tweetText, mediaUrls?, dealHistoryId?,
 *     scheduledFor?, reworkedFrom?, shopifyProductId?, altText?, imageBrief?,
 *     subject?,
 *     voiceGate: { verdict:'PASS', reviewer, addendum?, notes? } } -> { id, deduped }
 *     `deduped:true` means a still-open (pending_review/needs_changes) row for
 *     the same platform, caption, and campaign day already existed and `id`
 *     is THAT row, not a new one (ticket #4069 — see createDraftSocialPost).
 *     shopifyProductId (migration 080, ticket #2212) is the durable product
 *     link the publish-time stock guard reads; optional, set only when the
 *     post features a specific product. altText/imageBrief/subject (migration
 *     083, owner direction 2026-08-22) are the accessibility description and
 *     the durable "what does this image depict" record; altText is what the
 *     Instagram publisher sends as alt_text and must never be folded into the
 *     caption.
 *   { op: 'list', status?, reviewStatus? } -> { posts: [...] }
 *   { op: 'config' } -> { frequencies, autopostValve, platformValves: { instagram, x } }
 *     autopostValve (social_team_autopost) gates nothing on the publish path;
 *     it is kept for back-compat only. platformValves carries the real
 *     per-platform gates the hourly publish tick reads
 *     (instagram_autopublish_enabled, x_autopublish_enabled) so a caller
 *     reads true posting posture instead of the unused valve (ticket #5413).
 *   { op: 'gate', id, gate: { verdict, reviewer, notes, featuresProduct,
 *     productHandle? } } -> { ok, reviewStatus } | 422 { findings }
 *   { op: 'rework', id, mediaUrls?, tweetText?, altText?, imageBrief?, subject? }
 *     -> { ok, reviewStatus } | 404 | 409
 *     Refile a row the gate bounced to needs_changes (ticket #4351): update the
 *     corrected imagery/copy in place and reset it to pending_review so the gate
 *     re-judges it. At least one of mediaUrls/tweetText is required; altText/
 *     imageBrief/subject ride along optionally. Only a needs_changes row is a
 *     target, so #4069's duplicate-draft guard is intact.
 *   { op: 'engagement' } -> { report: [{ postId, externalPostId, metrics?, error? }],
 *                             account: { account?: { followersCount, ... }, error? } }
 *     Live Instagram insights (reach/likes/comments/saves) for the most
 *     recently posted rows, saves-first (ticket #2742), merged into metrics_json
 *     (migration 079). The `account` block carries the follower-count
 *     denominator per-post reach needs (ticket #4064); each sweep also persists
 *     a timestamped follower reading to KV so trend is derivable.
 *
 * The social-media-manager stub's only write path. Rows land in social_posts
 * with status='draft' AND review_status='pending_review' for human review in
 * /admin/socials (Social Studio). There is INTENTIONALLY no live-post op here
 * and no import of twitter.server.ts. Unattended publishing happens on the
 * hourly /cron/social-publish tick, gated per platform by
 * `instagram_autopublish_enabled` and `x_autopublish_enabled`, and reads rows
 * this route wrote. It is never reachable by flipping a payload field here.
 *
 * The `draft` op FAILS CLOSED on the voice gate (ticket #3208). Because this is
 * the only path a draft reaches pending_review, the mandatory Step 4a
 * emma-empathy-reviewer verdict is required in the payload as `voiceGate` and a
 * missing or non-PASS verdict is a 400 — the draft is not created. If the voice
 * gate could not run, the routine has no PASS to send and cannot draft, which is
 * exactly the required behaviour: a draft never enters the review queue without a
 * real voice-gate PASS asserted for it.
 *
 * Review state is still not a field the drafting agent can set. The owner writes
 * it from /admin/socials, and `op:'gate'` is the ONE other writer: the
 * independent pre-publish gate (`social-publish-gate`), which exists precisely
 * so the drafter is not grading its own homework. Their separation is the whole
 * design, so keep it: the drafting routine calls `draft`, the gate routine
 * calls `gate`, and neither calls the other's op.
 *
 * `op:'gate'` verifies rather than trusts. A PASS re-runs the deterministic
 * publish checks server-side and is refused if they block, so the verdict
 * cannot be asserted past them. See social-publish-approve.server.ts.
 *
 * The agent READS review outcomes through op:'list' (feedback and editedText
 * come back verbatim: that is the training channel) and its per-platform quota
 * through op:'config' (social_freq_* keys, posts/day, 0 = platform off).
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
import { applyPublishGateVerdict, parsePublishGateVerdict, reworkSocialPost, parseReworkInput } from '~/lib/social-publish-approve.server'
import { captureSocialEngagement, captureInstagramAccount, rankBySaves } from '~/lib/social-engagement.server'

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
    // Fail-closed X media requirement (ticket #4140, split from #4131). The
    // pre-publish gate BLOCKs an X post with no media (owner decision
    // 2026-08-16, social-publish-gate.server.ts), so a media-less X draft is
    // born unpublishable and the routine would only be manufacturing rows that
    // can never pass the gate. Refuse it at write time, mirroring the gate and
    // failing closed exactly like the voiceGate check above.
    if (b['platform'] === 'x' && (!mediaUrls || mediaUrls.length === 0)) {
      return new Response(
        'Bad Request: an X draft requires at least one mediaUrls entry (the pre-publish gate blocks a media-less X post; owner decision 2026-08-16)',
        { status: 400 },
      )
    }
    // Idempotency guard (#4069): a same-platform, same-caption row still open
    // for the same campaign day comes back as `deduped:true` with the
    // existing id rather than a new sibling row — see createDraftSocialPost.
    const { id, deduped } = await createDraftSocialPost({
      platform:      b['platform'],
      postType:      typeof b['postType'] === 'string' && b['postType'].length <= 20 ? b['postType'] : 'manual',
      tweetText:     b['tweetText'],
      mediaUrls,
      dealHistoryId: typeof b['dealHistoryId'] === 'number' ? b['dealHistoryId'] : undefined,
      scheduledFor:  typeof b['scheduledFor'] === 'string' ? b['scheduledFor'] : undefined,
      reworkedFrom:  typeof b['reworkedFrom'] === 'number' ? b['reworkedFrom'] : undefined,
      videoJobId:    typeof b['videoJobId'] === 'number' ? b['videoJobId'] : undefined,
      posterUrl:     typeof b['posterUrl'] === 'string' ? b['posterUrl'] : undefined,
      shopifyProductId:
        typeof b['shopifyProductId'] === 'string' && b['shopifyProductId'].length > 0 && b['shopifyProductId'].length <= 60
          ? b['shopifyProductId']
          : undefined,
      altText:      typeof b['altText'] === 'string' && b['altText'].length > 0 ? b['altText'] : undefined,
      imageBrief:   typeof b['imageBrief'] === 'string' && b['imageBrief'].length > 0 ? b['imageBrief'] : undefined,
      subject:      typeof b['subject'] === 'string' && b['subject'].length > 0 ? b['subject'] : undefined,
    })
    // Library pick (#4937): the agent chooses one of the generated candidates
    // client-side, so the pick is recorded here, by url, when the draft row
    // is minted. Non-fatal and skipped on a dedupe (the row already exists).
    if (!deduped && mediaUrls?.length) {
      const { tryMarkPickedByUrls } = await import('~/lib/social-asset-library.server')
      await tryMarkPickedByUrls(mediaUrls, id)
    }
    return Response.json({ id, deduped })
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

  // The pre-publish gate's verdict. The only writer of review state other than
  // the owner's own click, and the only path to `approved` once he stops
  // clicking. A PASS is re-verified server-side before it is believed.
  if (b['op'] === 'gate') {
    if (typeof b['id'] !== 'number' || !Number.isFinite(b['id'])) {
      return new Response('Bad Request: id required', { status: 400 })
    }
    const parsed = parsePublishGateVerdict(b['gate'])
    if (!parsed.ok) return new Response(parsed.error, { status: parsed.status })

    const result = await applyPublishGateVerdict(b['id'], parsed.verdict)
    if (!result.ok) {
      return Response.json(
        {
          error: result.error,
          ...(result.status === 422 ? { findings: result.findings } : {}),
        },
        { status: result.status },
      )
    }
    return Response.json({ ok: true, reviewStatus: result.reviewStatus })
  }

  // Refile a bounced draft (#4351). A gate REVISE lands a row at needs_changes;
  // the {op:'draft'} idempotency guard (#4069) dedupes on caption, so an
  // imagery-only rework could not land through 'draft' and the row was stranded
  // where the gate could not re-judge it. This updates the bounced row in place
  // and returns it to pending_review so the gate re-judges it. It never mints a
  // row (so #4069's protection is untouched) and only touches a needs_changes row.
  if (b['op'] === 'rework') {
    if (typeof b['id'] !== 'number' || !Number.isFinite(b['id'])) {
      return new Response('Bad Request: id required', { status: 400 })
    }
    const parsed = parseReworkInput({
      mediaUrls: b['mediaUrls'],
      tweetText: b['tweetText'],
      altText: b['altText'],
      imageBrief: b['imageBrief'],
      subject: b['subject'],
    })
    if (!parsed.ok) return new Response(parsed.error, { status: parsed.status })

    const result = await reworkSocialPost(b['id'], parsed.input)
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status })
    }
    return Response.json({ ok: true, reviewStatus: result.reviewStatus })
  }

  // Engagement readback (tickets #2742 IG, #3734 X). Fetches live numbers for
  // the most recently posted rows on both platforms and refreshes the stored
  // history in metrics_json (migration 079). IG rows rank saves-first per the
  // charter; X rows follow in recency order, since saves is not an X metric.
  if (b['op'] === 'engagement') {
    // Per-post rows and the account block are fetched independently so an
    // account-fetch failure degrades to an `error` on the account block without
    // dropping the per-post rows (ticket #4064).
    const [report, account] = await Promise.all([
      captureSocialEngagement(),
      captureInstagramAccount(),
    ])
    const igRows = rankBySaves(report.filter(r => r.platform !== 'x'))
    const xRows = report.filter(r => r.platform === 'x')
    return Response.json({ report: [...igRows, ...xRows], account })
  }

  if (b['op'] === 'config') {
    // `autopostValve` (social_team_autopost) gates nothing on the publish
    // path and is kept only for back-compat. The real per-platform gates the
    // hourly /cron/social-publish tick reads are instagram_autopublish_enabled
    // and x_autopublish_enabled (ticket #5413 — a routine reading only
    // autopostValve reports posting posture backwards). platformValves
    // surfaces the true current value of those two valves alongside it.
    const [frequencies, autopostValve, instagramAutopublish, xAutopublish] = await Promise.all([
      getSocialFrequencies(),
      getValve(VALVE_KEYS.socialAutopost),
      getValve(VALVE_KEYS.instagramAutopublish),
      getValve(VALVE_KEYS.xAutopublish),
    ])
    return Response.json({
      frequencies,
      autopostValve,
      platformValves: { instagram: instagramAutopublish, x: xAutopublish },
    })
  }

  return new Response('Bad Request', { status: 400 })
}
