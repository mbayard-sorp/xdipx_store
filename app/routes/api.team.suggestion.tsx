/**
 * POST /api/team/suggestion — the store-wide improvement bus.
 *
 *   { op: 'create', team, targetTeam?, runId?, category, kind?, suggestion,
 *     estSavingsUsd?, cxRisk? } -> { id }
 *   { op: 'list', team?, targetTeam?, status? } -> { suggestions: [...] }
 *   { op: 'mark', id, status: 'pr_open'|'applied', applyRef } -> { ok }
 *
 * Lifecycle: proposed -> approved|dismissed (OWNER ONLY, from the admin
 * dashboard) -> pr_open (agent-editor opened a PR) -> applied (owner merged).
 * 'mark' rejects any transition out of 'proposed' with a 409 — agents can
 * propose and can advance owner-approved rows, but the approval itself is
 * never theirs to make.
 */

import type { ActionFunctionArgs } from 'react-router'
import {
  assertTeamAuth,
  createSuggestion,
  isTeamId,
  listSuggestions,
  markSuggestion,
} from '~/lib/team.server'

const KINDS = ['process', 'strategy', 'instructions', 'agent-def', 'config', 'code', 'campaign', 'promo', 'program']
const RISKS = ['low', 'med', 'high'] as const

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>

  if (b['op'] === 'create') {
    if (!isTeamId(b['team'])) return new Response('Bad Request: unknown team', { status: 400 })
    if (typeof b['category'] !== 'string' || typeof b['suggestion'] !== 'string' || !b['suggestion']) {
      return new Response('Bad Request: category and suggestion required', { status: 400 })
    }
    const kind = typeof b['kind'] === 'string' && KINDS.includes(b['kind']) ? b['kind'] : 'process'
    const cxRisk = (RISKS as readonly string[]).includes(b['cxRisk'] as string)
      ? (b['cxRisk'] as (typeof RISKS)[number])
      : 'low'
    const id = await createSuggestion({
      team:          b['team'],
      targetTeam:    isTeamId(b['targetTeam']) ? b['targetTeam'] : undefined,
      runId:         typeof b['runId'] === 'number' ? b['runId'] : undefined,
      category:      b['category'],
      kind,
      suggestion:    b['suggestion'],
      estSavingsUsd: typeof b['estSavingsUsd'] === 'number' ? b['estSavingsUsd'] : 0,
      cxRisk,
    })
    return Response.json({ id })
  }

  if (b['op'] === 'list') {
    const suggestions = await listSuggestions({
      team:       isTeamId(b['team']) ? b['team'] : undefined,
      targetTeam: isTeamId(b['targetTeam']) ? b['targetTeam'] : undefined,
      status:     typeof b['status'] === 'string' ? b['status'] : undefined,
    })
    return Response.json({ suggestions })
  }

  if (b['op'] === 'mark') {
    if (
      typeof b['id'] !== 'number' ||
      (b['status'] !== 'pr_open' && b['status'] !== 'applied') ||
      typeof b['applyRef'] !== 'string' ||
      !b['applyRef']
    ) {
      return new Response('Bad Request: id, status (pr_open|applied), applyRef required', { status: 400 })
    }
    await markSuggestion(b['id'] as number, b['status'], b['applyRef'])
    return Response.json({ ok: true })
  }

  return new Response('Bad Request', { status: 400 })
}
