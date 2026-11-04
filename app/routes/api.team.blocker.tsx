/**
 * POST /api/team/blocker, the filing surface for the owner blocker list
 * (docs/store-team/routine-blocker-scout.md). Team-token auth, same as every
 * /api/team/* route.
 *
 *   { op: 'file', dedupeKey, title, detail?, unblocks?, whereToGo?, category?,
 *     priority?, source?, sourceRef?, evidence?, verifyProbe?, verifyArg?,
 *     overrideNoProbeReason? }
 *       -> { id, created, reopened }
 *
 * A category that requires a probe (PROBE_REQUIRED_CATEGORIES: every category
 * except console/decision) and has neither verifyProbe, a derivable one, nor
 * overrideNoProbeReason is rejected with 400 (ticket #8028) rather than filed
 * silently probe-less.
 *   { op: 'list', limit?, includeCleared?, clearedDays? }
 *       -> { open: [...], totalOpen, cleared: [...] }
 *   { op: 'get', id }                -> { blocker } or 404 (any status, not just open)
 *   { op: 'clear', id, note? }      -> { ok }
 *   { op: 'dismiss', id, note? }    -> { ok }
 *   { op: 'verify' }                -> { checked, autoCleared, stillBlocked, unknown }
 *   { op: 'probes' }                -> { probes: [{ name, describes }] }
 *
 * `limit` on `list` lets a caller see past the 50-row default; `totalOpen` is
 * the real open count so truncation (limit < totalOpen) is visible even when
 * the caller doesn't raise it. `get` is the only way to check a specific id
 * without scanning a list that may not contain it (ticket #19942: a routine
 * told to check "is blocker N still open?" before re-filing could not,
 * because row 51+ was invisible and there was no other lookup).
 *
 * GET returns the same payload as { op: 'list' }, so a routine can read the
 * current list without a body.
 *
 * Anything filed here is by definition something no agent can do. If an agent
 * CAN do the work, it belongs on the improvement bus as a ticket
 * (POST /api/team/suggestion), not here. Blurring that line is what turns this
 * list back into a backlog nobody reads.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { assertTeamAuth } from '~/lib/team.server'
import {
  BLOCKER_CATEGORIES,
  PROBES,
  clearBlocker,
  countOpenBlockers,
  dismissBlocker,
  fileBlocker,
  getBlockerById,
  listOpenBlockers,
  listRecentlyCleared,
  probeGapReason,
  suggestProbeFor,
  titleClaimsConfirmed,
  verifyBlockers,
} from '~/lib/owner-blockers.server'

/** Caps a caller-supplied limit so `op:'list'` can't be used to pull an
 * unbounded row count; 500 is comfortably above any real open-blocker count. */
function clampLimit(v: unknown, fallback: number, max = 500): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : fallback
}

function str(v: unknown, max = 4000): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined
}

export async function loader({ request }: LoaderFunctionArgs) {
  assertTeamAuth(request)
  const [open, totalOpen, cleared] = await Promise.all([
    listOpenBlockers(),
    countOpenBlockers(),
    listRecentlyCleared(),
  ])
  return Response.json({ open, totalOpen, cleared })
}

export async function action({ request }: ActionFunctionArgs) {
  assertTeamAuth(request)
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const op = b['op']

  if (op === 'file') {
    const dedupeKey = str(b['dedupeKey'], 80)
    const title = str(b['title'], 200)
    if (!dedupeKey || !title) {
      return new Response('Bad Request: dedupeKey and title required', { status: 400 })
    }
    // Evidence is not optional in spirit even though the column is nullable: a
    // blocker with nothing backing it is a guess, and a list of guesses is what
    // made the previous hand-written one unreadable. Warn loudly rather than
    // reject, so a genuinely obvious blocker still lands.
    //
    // EXCEPT a CONFIRMED-titled row (#4702): it asserts a measured fact, so it
    // must name the credential/app/token/path the check ran with, or a
    // credential-scoped absence gets filed as a fact about the world. That one
    // is rejected, not merely warned. (fileBlocker enforces the same for direct
    // callers; this returns a clean 400 instead of a 500 for HTTP clients.)
    if (!str(b['evidence'])) {
      if (titleClaimsConfirmed(title)) {
        return new Response(
          'Bad Request: a CONFIRMED-titled blocker requires an evidence field naming the credential, app, token, or network path the check ran with',
          { status: 400 },
        )
      }
      console.warn(`[api:blocker] filed without evidence: ${dedupeKey}`)
    }
    const category = str(b['category'], 24)
    if (category && !(BLOCKER_CATEGORIES as readonly string[]).includes(category)) {
      return new Response(
        `Bad Request: category must be one of ${BLOCKER_CATEGORIES.join('|')}`,
        { status: 400 },
      )
    }
    const verifyProbe = str(b['verifyProbe'], 32) ?? null
    const overrideNoProbeReason = str(b['overrideNoProbeReason'], 500) ?? null
    // Ticket #8028: a row whose category needs a probe (BLOCKER_CATEGORIES
    // other than console/decision) and has neither a probe nor a derivable
    // one nor an explicit override is rejected with a clean 400 here, mirroring
    // the CONFIRMED-title guard above -- fileBlocker enforces the same for
    // direct callers, this just avoids surfacing it as a 500 to HTTP clients.
    const resolvedCategory = category ?? 'other'
    const derived = suggestProbeFor({ category: resolvedCategory, sourceRef: str(b['sourceRef'], 500) ?? null, verifyProbe })
    const gap = probeGapReason({ category: resolvedCategory, verifyProbe: derived?.verifyProbe ?? verifyProbe })
    if (gap && !overrideNoProbeReason) {
      return new Response(
        `Bad Request: ${gap}. Pass verifyProbe, or a non-empty overrideNoProbeReason explaining why none exists.`,
        { status: 400 },
      )
    }
    const result = await fileBlocker({
      dedupeKey,
      title,
      detail: str(b['detail']) ?? null,
      unblocks: str(b['unblocks'], 2000) ?? null,
      whereToGo: str(b['whereToGo'], 1000) ?? null,
      category: category ?? null,
      priority: typeof b['priority'] === 'number' ? b['priority'] : null,
      source: str(b['source'], 32) ?? null,
      sourceRef: str(b['sourceRef'], 500) ?? null,
      evidence: str(b['evidence']) ?? null,
      verifyProbe,
      verifyArg: str(b['verifyArg'], 200) ?? null,
      overrideNoProbeReason,
    })
    return Response.json(result)
  }

  if (op === 'list') {
    const limit = clampLimit(b['limit'], 50)
    const [open, totalOpen] = await Promise.all([listOpenBlockers(limit), countOpenBlockers()])
    const cleared = b['includeCleared']
      ? await listRecentlyCleared(
        typeof b['clearedDays'] === 'number' && b['clearedDays'] > 0 ? b['clearedDays'] : undefined,
      )
      : []
    return Response.json({ open, totalOpen, cleared })
  }

  if (op === 'get') {
    const id = Number(b['id'] ?? 0)
    if (!id) return new Response('Bad Request: id required', { status: 400 })
    const blocker = await getBlockerById(id)
    if (!blocker) return new Response('Not Found: no blocker with that id', { status: 404 })
    return Response.json({ blocker })
  }

  if (op === 'clear' || op === 'dismiss') {
    const id = Number(b['id'] ?? 0)
    if (!id) return new Response('Bad Request: id required', { status: 400 })
    const note = str(b['note'], 1000) ?? null
    const ok = op === 'clear'
      ? await clearBlocker(id, 'agent', note)
      : await dismissBlocker(id, note)
    if (!ok) return new Response('Not Found: no open blocker with that id', { status: 404 })
    return Response.json({ ok: true, id })
  }

  if (op === 'verify') {
    return Response.json(await verifyBlockers())
  }

  if (op === 'probes') {
    return Response.json({
      probes: Object.entries(PROBES).map(([name, def]) => ({
        name,
        describes: def.describe('<arg>'),
      })),
    })
  }

  return new Response('Bad Request: unknown op', { status: 400 })
}
