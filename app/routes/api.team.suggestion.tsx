/**
 * POST /api/team/suggestion — the store-wide improvement bus, which doubles as
 * the ticket board for the self-healing loop.
 *
 *   { op: 'create', team, targetTeam?, runId?, category, kind?, suggestion,
 *     estSavingsUsd?, cxRisk?, priority?, dedupeKey?, dueAt?, links?,
 *     supersedesId?, actor? }
 *       -> { id, superseded? } | { deduped: true, id, superseded? }
 *     links (#1686) persist with the filing, so ADR-008's pr link fits in the
 *     one call. supersedesId (#3406) records the row this filing replaces and
 *     moves it out of the active set (proposed/approved -> dismissed with a
 *     note naming the new row; an in-flight row is noted, never yanked);
 *     `superseded: { id, outcome: 'dismissed'|'noted'|'not-found'|'error' }`
 *     reports what happened. actor attributes that dismissal (agent:<slug>;
 *     defaults to agent:<team>).
 *   { op: 'list', team?, targetTeam?, status?, statuses?, kind?, assignee?,
 *     updatedSince?, limit?, orderBy? } -> { suggestions: [...], total }
 *     total (#2071) is the full matching count, so truncation is detectable:
 *     total > suggestions.length means the cap bit. A status-filtered list
 *     with no orderBy returns OLDEST first, so truncation can only delay the
 *     newest rows (re-listed next run), never permanently hide the oldest.
 *   { op: 'mark', id, status: 'pr_open'|'applied', applyRef } -> { ok }
 *   { op: 'claim', assignee, leaseSeconds?, id?, filter? }
 *       -> { claimed: true, ...ticket } | { empty: true }
 *   { op: 'transition', id, to, actor, note?, links?, lastError? }
 *       -> { ok: true, suggestion }
 *     Delegated dismissal (#3573, owner-approved): an agent actor MAY
 *     transition a proposed/approved row to dismissed when the note contains
 *     a supersession reference — a GitHub PR URL, or `#<id>` of a live
 *     replacement row (verified server-side). The event records the agent
 *     actor plus a delegated_by=owner note link. Without a verifying
 *     reference the transition 409s exactly as before.
 *   { op: 'get', id } -> { suggestion, links, events }
 *   { op: 'rekind', id, kind, actor, note? } -> { ok: true, suggestion }
 *   { op: 'retire', id, actor, note, supersededById?, satisfiedBy? }
 *       -> { ok: true, suggestion }
 *     Evidence retire (#2864): with supersededById (a live-or-applied row
 *     whose text names this one) or satisfiedBy (PR URL or doc path#anchor),
 *     agent-editor may also retire instructions/agent-def rows; the evidence
 *     is validated server-side and recorded as links. Evidence-free retires
 *     on those kinds still 409.
 *   { op: 'note', id, ref } -> { ok: true }
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
  addSuggestionNote,
  agentRetireSuggestion,
  assertTeamAuth,
  claimSuggestion,
  countSuggestions,
  createSuggestionDetailed,
  getTicket,
  rekindSuggestion,
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

/**
 * Links from the canonical `links` array, plus a coerced top-level `pr`
 * shorthand (#5054). ADR-008 step 3's prose ("plus a `pr` link pointing at the
 * PR URL") reads as `pr: '<url>'`, but only `links:[{kind,ref,state}]` is
 * validated and stored, so a filing that followed the prose had its PR link
 * silently dropped — and a code PR with no `pr` link and no `#<id>` in its
 * title never resolves to a ticket, so the release engine leaves it drafted
 * forever (the exact draft-invisibility failure of #4144, reached through a
 * different door). Coerce the shorthand into a real link rather than dropping
 * the one field that decides mergeability. `links:[...]` remains canonical.
 */
function parseLinksWithPr(b: Record<string, unknown>): TicketLinkInput[] | undefined {
  const links = parseLinks(b['links']) ?? []
  const pr = b['pr']
  if (typeof pr === 'string' && pr.trim()) {
    const ref = pr.trim()
    if (!links.some(l => l.kind === 'pr' && l.ref === ref)) {
      links.push({ kind: 'pr', ref, state: 'open' })
      console.warn(
        "[api:suggestion] coerced a top-level `pr` key into a links[] entry; " +
          "prefer links:[{kind:'pr',ref:'<url>',state:'open'}]",
      )
    }
  }
  return links.length ? links : undefined
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
    const { id, deduped, superseded } = await createSuggestionDetailed({
      team:          b['team'],
      targetTeam:    isTeamId(b['targetTeam']) ? b['targetTeam'] : undefined,
      runId:         typeof b['runId'] === 'number' ? b['runId'] : undefined,
      category:      b['category'],
      kind,
      suggestion:    b['suggestion'],
      estSavingsUsd: typeof b['estSavingsUsd'] === 'number' ? b['estSavingsUsd'] : 0,
      cxRisk,
      priority,
      dedupeKey:     typeof b['dedupeKey'] === 'string' && b['dedupeKey'] ? b['dedupeKey'].slice(0, 128) : undefined,
      // Canonicalization (date stripping, slugging, the 64-char cap) happens
      // in createSuggestionDetailed so every filer gets it, not only the ones
      // that remembered to call makeDedupeKey. Slice generously here so a
      // longer raw key still canonicalizes rather than being truncated blind.
      dedupeScope:   b['dedupeScope'] === 'daily' ? 'daily' : undefined,
      dueAt:         parseDate(b['dueAt']),
      // #1686: links persist with the filing instead of being silently dropped.
      // #5054: also coerce a top-level `pr` shorthand into a link.
      links:         parseLinksWithPr(b),
      // #3406: record and resolve the supersession the filing declares.
      supersedesId:  typeof b['supersedesId'] === 'number' && Number.isInteger(b['supersedesId']) && b['supersedesId'] > 0
                       ? b['supersedesId'] : undefined,
      actor:         isTicketActor(b['actor']) ? b['actor'] : undefined,
    })
    // A duplicate is a normal outcome, not an error: the signal is already
    // being tracked, and the caller gets the live ticket to comment on.
    return Response.json({
      ...(deduped ? { deduped: true } : {}),
      id,
      ...(superseded ? { superseded } : {}),
    })
  }

  if (b['op'] === 'list') {
    const filter = {
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
    }
    // total (#2071) makes truncation detectable: the limit caps `suggestions`,
    // never the count, so total > suggestions.length means rows fell off.
    const [suggestions, total] = await Promise.all([
      listSuggestions(filter),
      countSuggestions(filter),
    ])
    return Response.json({ suggestions, total })
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
      // #5054: coerce a top-level `pr` shorthand here too — a transition to
      // pr_open is the other place agents attach the mergeability-deciding link.
      links:     parseLinksWithPr(b),
      lastError: typeof b['lastError'] === 'string' ? b['lastError'] : undefined,
    })
    return Response.json({ ok: true, suggestion })
  }

  // Re-file a misfiled row under a kind that actually has an executor. One-way
  // by construction (see rekindSuggestion): allowing the reverse direction would
  // let agent-editor rekind an inconvenient instruction row into a retirable
  // kind and then retire it.
  if (b['op'] === 'rekind') {
    if (typeof b['id'] !== 'number') {
      return new Response('Bad Request: id required', { status: 400 })
    }
    if (typeof b['kind'] !== 'string') {
      return new Response('Bad Request: kind required', { status: 400 })
    }
    if (!isTicketActor(b['actor'])) {
      return new Response("Bad Request: actor must be 'owner' | 'auto' | 'system' | 'agent:<slug>'", { status: 400 })
    }
    const suggestion = await rekindSuggestion(
      b['id'],
      b['kind'],
      b['actor'],
      typeof b['note'] === 'string' ? b['note'] : undefined,
    )
    return Response.json({ ok: true, suggestion })
  }

  // agent-editor retiring an approved row with no executor, during its hygiene
  // pass. The kind fence lives in the ALLOWED map, not here.
  if (b['op'] === 'retire') {
    if (typeof b['id'] !== 'number') {
      return new Response('Bad Request: id required', { status: 400 })
    }
    if (!isTicketActor(b['actor'])) {
      return new Response("Bad Request: actor must be 'owner' | 'auto' | 'system' | 'agent:<slug>'", { status: 400 })
    }
    if (typeof b['note'] !== 'string' || b['note'].trim().length === 0) {
      // A retirement with no stated reason is indistinguishable from a mistake.
      return new Response('Bad Request: note required (say why it is being retired)', { status: 400 })
    }
    // #2864: optional evidence unlocks the instructions/agent-def retire edge.
    // Validation (superseding row must exist, be live-or-applied, and name
    // this row; satisfiedBy must be a PR URL or doc path) lives in
    // agentRetireSuggestion, next to the transition map it feeds.
    const supersededById =
      typeof b['supersededById'] === 'number' && Number.isInteger(b['supersededById']) && b['supersededById'] > 0
        ? b['supersededById'] : undefined
    const satisfiedBy =
      typeof b['satisfiedBy'] === 'string' && b['satisfiedBy'].trim() ? b['satisfiedBy'].trim() : undefined
    const suggestion = await agentRetireSuggestion(
      b['id'],
      b['actor'],
      b['note'],
      supersededById != null || satisfiedBy ? { supersededById, satisfiedBy } : undefined,
    )
    return Response.json({ ok: true, suggestion })
  }

  // Record what a run did to a row it could not close, so the next reader sees
  // the history instead of re-deriving it.
  if (b['op'] === 'note') {
    if (typeof b['id'] !== 'number') {
      return new Response('Bad Request: id required', { status: 400 })
    }
    if (typeof b['ref'] !== 'string' || b['ref'].trim().length === 0) {
      return new Response('Bad Request: ref required', { status: 400 })
    }
    await addSuggestionNote(b['id'], b['ref'])
    return Response.json({ ok: true })
  }

  if (b['op'] === 'get') {
    if (typeof b['id'] !== 'number') return new Response('Bad Request: id required', { status: 400 })
    const ticket = await getTicket(b['id'])
    if (!ticket) return new Response(`Not Found: suggestion ${b['id']}`, { status: 404 })
    return Response.json(ticket)
  }

  return new Response('Bad Request', { status: 400 })
}
