/**
 * POST /api/team/ad-action (Ads Control Plane phase 5c, ticket #16433, plan
 * §5 "Buyer write path"). Team-token guarded. The buyer's and the
 * allocator's only write path into the ad_actions ledger.
 *
 * { op: 'propose', platform, target: { level, externalId }, verb, params, reason,
 *   expectedContributionCents?, source: 'paid-media-buyer' | 'allocator' }
 *   verb is pause | resume | set_budget | update_creative. The target must be in
 *   the mirror (ad_platform_entities), else 404. Writes one row with status
 *   proposed, tier from classifyTier but never auto (every buyer proposal is a
 *   one-tap card), expires_at now + 48h. The idempotency key is per UTC day, so
 *   the same target, verb and params twice in a day is one row.
 *   The buyer gets at most 3 new rows a UTC day (plan §9.4); the 4th is 429.
 *   -> { ok, inserted, id, tier, status }
 * { op: 'list', source?: 'paid-media-buyer' | 'allocator' }
 *   That proposer's rows from the last 7 days, newest first.
 *   -> { ok, items: [{ id, platform, target, verb, params, tier, status, reason, ... }] }
 *
 * Any other op, or a body that tries to set status approved or applied, gets
 * 403. This route never calls a platform and never touches pipeline_settings.
 */
import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { apiError } from '~/lib/api-error.server'
import { insertAction } from '~/lib/ads/ledger.server'
import { buildIdempotencyKey } from '~/lib/ads/ledger-core'
import {
  countProposedSince, findActionByKey, findMirrorTarget, listProposedSince,
} from '~/lib/ads/ad-action-propose.server'
import {
  BUYER_DAILY_PROPOSAL_CAP, LIST_LOOKBACK_DAYS, PROPOSAL_SOURCES, PROPOSAL_TTL_MS, PROPOSE_ONLY_MESSAGE,
  ProposalValidationError, beforeAfterFor, parseProposal, proposalTier, proposedByFor, startOfUtcDay,
  triesToSkipApproval, utcDay, type ProposalSource,
} from '~/lib/ads/ad-action-propose-core'

const BUYER = proposedByFor('paid-media-buyer')

function bad(message: string): Response {
  return Response.json({ error: message }, { status: 400 })
}

function forbidden(): Response {
  return Response.json({ error: PROPOSE_ONLY_MESSAGE }, { status: 403 })
}

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const op = b['op']

  if (op !== 'propose' && op !== 'list') return forbidden()
  if (triesToSkipApproval(b)) return forbidden()

  try {
    if (op === 'propose') {
      const input = parseProposal(b)
      const target = await findMirrorTarget(input.platform, input.level, input.externalId)
      if (!target) {
        return Response.json({
          error: `No ${input.level} ${input.externalId} on ${input.platform} in the mirror. Propose only against synced entities.`,
        }, { status: 404 })
      }

      const now = new Date()
      const { before, after } = beforeAfterFor(input, target)
      const tier = proposalTier(input.verb, input.params, before)
      const proposedBy = proposedByFor(input.source)
      const idempotencyKey = buildIdempotencyKey({
        platform: input.platform, level: input.level, externalId: input.externalId,
        verb: input.verb, day: utcDay(now), params: input.params,
      })

      // A replay of a row already in today's ledger is not a new card, so it
      // answers inserted:false before the cap is counted.
      const existing = await findActionByKey(idempotencyKey)
      if (existing) {
        return Response.json({ ok: true, inserted: false, id: existing.id, tier: existing.tier, status: existing.status })
      }

      if (proposedBy === BUYER) {
        const today = await countProposedSince(BUYER, startOfUtcDay(now))
        if (today >= BUYER_DAILY_PROPOSAL_CAP) {
          return Response.json({
            error: `The buyer already has ${today} proposals today and the cap is ${BUYER_DAILY_PROPOSAL_CAP}. Keep the strongest ones and try again tomorrow.`,
          }, { status: 429 })
        }
      }

      const res = await insertAction({
        idempotencyKey,
        platform: input.platform,
        targetLevel: input.level,
        targetExternalId: input.externalId,
        verb: input.verb,
        params: input.params,
        before,
        after,
        proposedBy,
        reason: input.reason,
        tier,
        status: 'proposed',
        expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS),
      })
      if (!res.inserted) {
        // Lost a race with an identical proposal; report the row that won.
        const winner = await findActionByKey(idempotencyKey)
        return Response.json({ ok: true, inserted: false, id: winner?.id ?? null, tier: winner?.tier ?? tier, status: winner?.status ?? 'proposed' })
      }
      return Response.json({ ok: true, inserted: true, id: res.row?.id ?? null, tier, status: 'proposed' })
    }

    // op === 'list'
    const source = b['source'] ?? 'paid-media-buyer'
    if (typeof source !== 'string' || !(PROPOSAL_SOURCES as readonly string[]).includes(source)) {
      return bad(`source must be one of ${PROPOSAL_SOURCES.join('|')}`)
    }
    const since = new Date(Date.now() - LIST_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    const rows = await listProposedSince(proposedByFor(source as ProposalSource), since)
    return Response.json({
      ok: true,
      items: rows.map(r => ({
        id: r.id,
        platform: r.platform,
        target: { level: r.targetLevel, externalId: r.targetExternalId },
        verb: r.verb,
        params: r.params,
        before: r.before,
        after: r.after,
        tier: r.tier,
        status: r.status,
        reason: r.reason,
        approvedBy: r.approvedBy,
        approvedAt: r.approvedAt,
        appliedAt: r.appliedAt,
        error: r.error,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
      })),
    })
  } catch (err) {
    if (err instanceof ProposalValidationError) return bad(err.message)
    return apiError('team-ad-action', err, 'ad-action op failed')
  }
}
