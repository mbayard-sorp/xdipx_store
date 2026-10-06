/**
 * POST /api/team/ad-ideas (Ad Studio v2, PR-A). Team-token guarded.
 *
 * { op: 'create', ideas: Idea[] (1 to 50), run_id? (runId also accepted) }
 *   Each idea: concept_slug, lane (meta|google|microsoft|snap|adult|newsletter|owned),
 *   register_tier (3-4|4-5|6-7|7-9|9|10), title, one_liner?, products[], headlines[],
 *   body[], audience?, destination_url (must carry utm_content), break_even_json?,
 *   policy_check (required, non-empty).
 *   -> { ok, created: [{ id, status }] }  (the whole batch is validated before any insert)
 * { op: 'list', status?, lane?, concept?, product?, rating?: loved|rejected|unrated, since?, cursor?, limit? }
 *   -> { items, nextCursor }
 * { op: 'set-status', id, status: 'rendered' | 'archived' }
 *   Agents may only set rendered or archived. hearted and rejected come from the
 *   owner's rating in /admin/ad-studio/ideas, never from a team token.
 */
import type { ActionFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import { apiError } from '~/lib/api-error.server'
import {
  AD_LANES, AdValidationError, AGENT_SETTABLE_STATUSES, IDEA_STATUSES, createIdeas, isAdLane, isIdeaStatus,
  listIdeas, setIdeaStatus, validateIdea, BATCH_MAX,
} from '~/lib/ad-ideas.server'
import { isFeedbackFilter } from '~/lib/ad-idea-feedback-reasons'

function bad(message: string): Response {
  return Response.json({ error: message }, { status: 400 })
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

  try {
    if (op === 'create') {
      const raw = b['ideas']
      if (!Array.isArray(raw) || raw.length === 0) return bad('ideas must be a non-empty array')
      if (raw.length > BATCH_MAX) return bad(`At most ${BATCH_MAX} ideas per batch`)
      // runId is what the routine playbook sends; 2026-10-06 run 1277 lost its
      // run link because only run_id was read.
      const batchRun = b['run_id'] ?? b['runId']
      if (batchRun != null && (typeof batchRun !== 'number' || !Number.isInteger(batchRun))) return bad('run_id must be an integer')
      const inputs = raw.map((r, i) => {
        const idea = validateIdea(r, i)
        if (idea.runId == null && typeof batchRun === 'number') idea.runId = batchRun
        return idea
      })
      const rows = await createIdeas(inputs)
      return Response.json({ ok: true, created: rows.map(r => ({ id: r.id, status: r.status })) })
    }

    if (op === 'list') {
      const since = parseSince(b['since'])
      if (since === 'bad') return bad('since must be an ISO timestamp')
      if (b['status'] != null && !isIdeaStatus(b['status'])) return bad(`status must be one of ${IDEA_STATUSES.join('|')}`)
      if (b['lane'] != null && !isAdLane(b['lane'])) return bad(`lane must be one of ${AD_LANES.join('|')}`)
      if (b['rating'] != null && !isFeedbackFilter(b['rating'])) return bad('rating must be loved, rejected or unrated')
      const cursor = typeof b['cursor'] === 'number' && Number.isInteger(b['cursor']) ? b['cursor'] : null
      const limit = typeof b['limit'] === 'number' && Number.isFinite(b['limit']) ? b['limit'] : undefined
      const page = await listIdeas({
        status: (b['status'] as typeof IDEA_STATUSES[number] | undefined) ?? null,
        lane: (b['lane'] as typeof AD_LANES[number] | undefined) ?? null,
        concept: typeof b['concept'] === 'string' ? b['concept'] : null,
        product: typeof b['product'] === 'string' ? b['product'] : null,
        rating: (b['rating'] as 'loved' | 'rejected' | 'unrated' | undefined) ?? null,
        since,
        cursor,
        limit,
      })
      return Response.json(page)
    }

    if (op === 'set-status') {
      const id = b['id']
      const status = b['status']
      if (typeof id !== 'number' || !Number.isInteger(id)) return bad('id must be an integer')
      if (typeof status !== 'string' || !(AGENT_SETTABLE_STATUSES as readonly string[]).includes(status)) {
        return bad('status must be rendered or archived. hearted and rejected come only from the owner rating.')
      }
      const row = await setIdeaStatus(id, status, 'agent')
      if (!row) return Response.json({ error: 'Idea not found' }, { status: 404 })
      return Response.json({ ok: true, id: row.id, status: row.status })
    }

    return bad('op must be create, list or set-status')
  } catch (err) {
    if (err instanceof AdValidationError) return bad(err.message)
    return apiError('team-ad-ideas', err, 'ad-ideas op failed')
  }
}
