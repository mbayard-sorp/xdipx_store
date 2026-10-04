/**
 * POST /api/team/ad-feedback (Ad Studio v2, PR-A). READ ONLY.
 *
 * The ads routine reads the owner's heart / thumbs-down verdicts on ideas and
 * creatives at run start, so it files fewer ideas the owner will reject and
 * more like the ones he loved.
 *
 * { op: 'list', since?, verdict?: 'up'|'down', kind?: 'ideas'|'creatives'|'both', limit? }
 *   -> { ideas: IdeaFeedbackItem[], creatives: CreativeFeedbackItem[], vocabulary }
 *   Each item is joined to concept_slug, lane, register tier, products and the
 *   idea title (or creative slogan).
 * { op: 'summary', since? }
 *   -> { summary: { ideas, creatives }, vocabulary }
 *   Counts by verdict, reason, lane and concept.
 *
 * There is deliberately no write op. Feedback is OWNER-WRITE ONLY, through the
 * admin Ad Studio routes behind requireAdmin; a team-token write path would let
 * the signal train on itself.
 */
import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { apiError } from '~/lib/api-error.server'
import { listAdFeedback, summarizeAdFeedback } from '~/lib/ad-ideas.server'
import * as ideaReasons from '~/lib/ad-idea-feedback-reasons'
import * as creativeReasons from '~/lib/ad-creative-feedback-reasons'

const VOCABULARY = {
  ideas: { up: ideaReasons.UP_REASONS.map(r => r.value), down: ideaReasons.DOWN_REASONS.map(r => r.value) },
  creatives: { up: creativeReasons.UP_REASONS.map(r => r.value), down: creativeReasons.DOWN_REASONS.map(r => r.value) },
}

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
      const summary = await summarizeAdFeedback(since)
      return Response.json({ summary, vocabulary: VOCABULARY })
    }
    const verdictRaw = b['verdict']
    if (verdictRaw != null && !ideaReasons.isFeedbackVerdict(verdictRaw)) {
      return new Response('Bad Request: verdict must be "up" or "down"', { status: 400 })
    }
    const kindRaw = b['kind']
    if (kindRaw != null && kindRaw !== 'ideas' && kindRaw !== 'creatives' && kindRaw !== 'both') {
      return new Response('Bad Request: kind must be "ideas", "creatives" or "both"', { status: 400 })
    }
    const limit = typeof b['limit'] === 'number' && Number.isFinite(b['limit']) ? b['limit'] : undefined
    const result = await listAdFeedback({ since, verdict: verdictRaw ?? null, kind: kindRaw ?? 'both', limit })
    return Response.json({ ...result, vocabulary: VOCABULARY })
  } catch (err) {
    return apiError('team-ad-feedback', err, 'ad-feedback op failed')
  }
}
