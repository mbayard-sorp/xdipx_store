/**
 * POST /api/team/social-asset-feedback (ticket #11551). READ ONLY.
 *
 * The social routine reads the owner's heart / thumbs-down verdicts on
 * library images at run start, so it wastes fewer generations and lands
 * closer to on-message.
 *
 * { op: 'list', since?, verdict?: 'up'|'down', limit? }
 *   -> { items: FeedbackListItem[], vocabulary }
 * { op: 'summary', since? }
 *   -> { summary: { total, byVerdict, byReason }, vocabulary }
 *
 * There is deliberately no write op. Feedback is OWNER-WRITE ONLY, through
 * the admin library routes behind requireAdmin; a team-token write path
 * would let the signal train on itself.
 */
import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { apiError } from '~/lib/api-error.server'
import { listAssetFeedback, summarizeAssetFeedback } from '~/lib/social-asset-feedback.server'
import { DOWN_REASONS, UP_REASONS, isFeedbackVerdict } from '~/lib/social-asset-feedback-reasons'

const VOCABULARY = { up: UP_REASONS.map(r => r.value), down: DOWN_REASONS.map(r => r.value) }

function parseSince(v: unknown): Date | null | 'bad' {
  if (v == null || v === '') return null
  if (typeof v !== 'string') return 'bad'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'bad' : d
}

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const op = b['op']
  if (op !== 'list' && op !== 'summary') {
    return new Response('Bad Request: op must be "list" or "summary" (this endpoint is read only)', { status: 400 })
  }
  const since = parseSince(b['since'])
  if (since === 'bad') return new Response('Bad Request: since must be an ISO timestamp', { status: 400 })

  try {
    if (op === 'summary') {
      const summary = await summarizeAssetFeedback(since)
      return Response.json({ summary, vocabulary: VOCABULARY })
    }
    const verdictRaw = b['verdict']
    if (verdictRaw != null && !isFeedbackVerdict(verdictRaw)) {
      return new Response('Bad Request: verdict must be "up" or "down"', { status: 400 })
    }
    const limit = typeof b['limit'] === 'number' && Number.isFinite(b['limit']) ? b['limit'] : undefined
    const items = await listAssetFeedback({ since, verdict: verdictRaw ?? null, limit })
    return Response.json({ items, vocabulary: VOCABULARY })
  } catch (err) {
    return apiError('team-social-asset-feedback', err, 'social-asset-feedback op failed')
  }
}
