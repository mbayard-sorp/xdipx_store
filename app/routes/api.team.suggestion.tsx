/**
 * POST /api/team/suggestion — the store-wide improvement bus, which doubles as
 * the ticket board for the self-healing loop.
 *
 *   { op: 'create', team, targetTeam?, runId?, category, kind?, suggestion,
 *     estSavingsUsd?, cxRisk?, priority?, dedupeKey?, dueAt? }
 *       -> { id } | { deduped: true, id }
 *   { op: 'list', team?, targetTeam?, status?, statuses?, kind?, assignee?,
 *     updatedSince?, limit?, orderBy? } -> { suggestions: [...] }
 *   { op: 'mark', id, status: 'pr_open'|'applied', applyRef } -> { ok }
 *   { op: 'claim', assignee, leaseSeconds?, id?, filter? }
 *       -> { claimed: true, ...ticket } | { empty: true }
 *   { op: 'transition', id, to, actor, note?, links?, lastError? }
 *       -> { ok: true, suggestion }
 *   { op: 'get', id } -> { suggestion, links, events }
 *
 * Lifecycle (app/lib/team.server.ts ALLOWED is the single source of truth):
 *   proposed -> approved (owner, or the acting team's auto-approve valve)
 *            -> in_progress (a dev agent claims it)
 *            -> pr_open (the assignee opens a PR)
 *            -> in_review -> verified (qa-reviewer)
 *            -> applied (the release engine, after merge and green smoke)
 * Any pair the map does not contain is a 409. QA has no edge to `applied`, so
 * it structurally cannot ship its own verdict.
 *
 * The legacy `mark` op is untouched: agent-editor's docs loop
 * (approved -> pr_open -> applied) keeps working exactly as before.
 */

import type { ActionFunctionArgs } from 'react-router'
import {
  assertTeamAuth,
  claimSuggestion,
  createSuggestionDetailed,
  getTicket,
  isTeamId,
  isTicketActor,
  isTicketStatus,
  listSuggestions,
  markSuggestion,
  transitionSuggestion,
  SUGGESTION_LIST_MAX,
  type TicketLinkInput,
  type TicketStatus,
} from '~/lib/team.server'

const KINDS = ['process', 'strategy', 'instructions', 'agent-def', 'config', 'code', 'campaign', 'promo', 'program']
const RISKS = ['low', 'med', 'high'] as const
const ORDER_BY = ['priority', 'age', 'created'] as const

/** Accepts a scalar or an array; returns the members that pass `ok`. */
function stringList(v: unknown, ok: (s: string) => boolean): string[] | undefined {
  const raw = Array.isArray(v) ? v : v === undefined ? [] : [v]
  const out = raw.filter((x): x is string => typeof x === 'string' && ok(x))
  return out.length ? out : undefined
}

function parseDate(v: unknown): Date | undefined {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** Links arrive from agents, so shape-check every member before it hits SQL. */
function parseLinks(v: unknown): TicketLinkInput[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: TicketLinkInput[] = []
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue
    const l = raw as Record<string, unknown>
    if (typeof l['kind'] !== 'string' || typeof l['ref'] !== 'string' || !l['ref']) continue
    out.push({
      kind:  l['kind'],
      ref:   l['ref'],
      state: typeof l['state'] === 'string' ? l['state'] : undefined,
    })
  }
  return out.length ? out : undefined
}

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
    const priority = typeof b['priority'] === 'number' && b['priority'] >= 1 && b['priority'] <= 5
      ? Math.round(b['priority'])
      : undefined
    const { id, deduped } = await createSuggestionDetailed({
      team:          b['team'],
      targetTeam:    isTeamId(b['targetTeam']) ? b['targetTeam'] : undefined,
      runId:         typeof b['runId'] === 'number' ? b['runId'] : undefined,
      category:      b['category'],
      kind,
      suggestion:    b['suggestion'],
      estSavingsUsd: typeof b['estSavingsUsd'] === 'number' ? b['estSavingsUsd'] : 0,
      cxRisk,
      priority,
      dedupeKey:     typeof b['dedupeKey'] === 'string' && b['dedupeKey'] ? b['dedupeKey'].slice(0, 64) : undefined,
      dueAt:         parseDate(b['dueAt']),
    })
    // A duplicate is a normal outcome, not an error: the signal is already
    // being tracked, and the caller gets the live ticket to comment on.
    return Response.json(deduped ? { deduped: true, id } : { id })
  }

  if (b['op'] === 'list') {
    const suggestions = await listSuggestions({
      team:         isTeamId(b['team']) ? b['team'] : undefined,
      targetTeam:   isTeamId(b['targetTeam']) ? b['targetTeam'] : undefined,
      status:       typeof b['status'] === 'string' ? b['status'] : undefined,
      statuses:     stringList(b['statuses'], isTicketStatus),
      kinds:        stringList(b['kind'] ?? b['kinds'], s => KINDS.includes(s)),
      assignee:     typeof b['assignee'] === 'string' ? b['assignee'] : undefined,
      updatedSince: parseDate(b['updatedSince']),
      limit:        typeof b['limit'] === 'number' ? Math.min(SUGGESTION_LIST_MAX, b['limit']) : undefined,
      orderBy:      (ORDER_BY as readonly string[]).includes(b['orderBy'] as string)
                      ? (b['orderBy'] as (typeof ORDER_BY)[number])
                      : undefined,
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

  if (b['op'] === 'claim') {
    if (!isTicketActor(b['assignee'])) {
      return new Response("Bad Request: assignee must be 'owner' | 'system' | 'agent:<slug>'", { status: 400 })
    }
    const filterRaw = (b['filter'] ?? {}) as Record<string, unknown>
    const result = await claimSuggestion({
      assignee:     b['assignee'],
      leaseSeconds: typeof b['leaseSeconds'] === 'number' ? b['leaseSeconds'] : undefined,
      id:           typeof b['id'] === 'number' ? b['id'] : undefined,
      filter: {
        kind:       typeof filterRaw['kind'] === 'string' && KINDS.includes(filterRaw['kind'])
                      ? filterRaw['kind'] : undefined,
        status:     isTicketStatus(filterRaw['status']) ? filterRaw['status'] : undefined,
        team:       isTeamId(filterRaw['team']) ? filterRaw['team'] : undefined,
        targetTeam: isTeamId(filterRaw['targetTeam']) ? filterRaw['targetTeam'] : undefined,
      },
    })
    if (result.empty) return Response.json({ empty: true })
    const ticket = await getTicket(result.id)
    return Response.json({ claimed: true, id: result.id, ...(ticket ?? {}) })
  }

  if (b['op'] === 'transition') {
    if (typeof b['id'] !== 'number') {
      return new Response('Bad Request: id required', { status: 400 })
    }
    if (!isTicketStatus(b['to'])) {
      return new Response('Bad Request: unknown target status', { status: 400 })
    }
    if (!isTicketActor(b['actor'])) {
      return new Response("Bad Request: actor must be 'owner' | 'auto' | 'system' | 'agent:<slug>'", { status: 400 })
    }
    const suggestion = await transitionSuggestion(b['id'], b['to'] as TicketStatus, b['actor'], {
      note:      typeof b['note'] === 'string' ? b['note'] : undefined,
      links:     parseLinks(b['links']),
      lastError: typeof b['lastError'] === 'string' ? b['lastError'] : undefined,
    })
    return Response.json({ ok: true, suggestion })
  }

  if (b['op'] === 'get') {
    if (typeof b['id'] !== 'number') return new Response('Bad Request: id required', { status: 400 })
    const ticket = await getTicket(b['id'])
    if (!ticket) return new Response(`Not Found: suggestion ${b['id']}`, { status: 404 })
    return Response.json(ticket)
  }

  return new Response('Bad Request', { status: 400 })
}
