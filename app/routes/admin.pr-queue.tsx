/**
 * /admin/pr-queue — owner all-hands 2026-10-04, owner words: "help manage the
 * PR queue so we can see what we have been working on".
 *
 * Joins GitHub's open PRs with the ticket bus (homepage_team_suggestions) so
 * one page answers "what is open, what is it waiting on, and is anything
 * stuck" without reading GitHub and the bus separately. Three sections:
 * open PRs (grouped by branch lane and by title-prefix program), PRs merged
 * in the last 7 days, and tickets sitting at `verified` with no open PR
 * (stale verdicts that never closed out — see CLAUDE.md's ticket-loop
 * janitor section for why those can happen).
 *
 * Read-only. Nothing here writes to GitHub or the bus; it only reads both
 * and renders the join. `resolveTicketForPr` is the same function the
 * release engine itself uses, imported rather than reimplemented, so this
 * page can never disagree with the engine about which ticket a PR belongs to.
 */
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import {
  classifyChangedFiles,
  getChecksForRef,
  githubRequest,
  listOpenPullRequests,
  listPullRequestFiles,
  type PullRequestSummary,
} from '~/lib/github.server'
import { resolveTicketForPr, type TicketFacts } from '~/lib/release-engine.server'
import { db } from '~/lib/db.server'
import { homepageTeamSuggestions, suggestionLinks } from '../../db/schema'
import { and, desc, eq } from 'drizzle-orm'

export const meta: MetaFunction = () => [{ title: 'PR Queue · xdipx admin' }]

const AGENT_BRANCH_LANES = ['ticket/', 'agents/', 'claude/', 'phase1/', 'tonight/', 'fix/', 'pm/', 'revert/pr-'] as const

function laneOf(headRef: string): string {
  return AGENT_BRANCH_LANES.find(p => headRef.startsWith(p)) ?? 'other'
}

/** Coarse program grouping from the title prefix. Hand-maintained because
 *  program names are a convention, not a bus field — add a prefix here when
 *  a new program's titles settle on one. */
function programOf(title: string): string {
  if (/^agents:/i.test(title)) return 'agent-editor applies'
  if (/^ticket[:#]/i.test(title)) return 'R-DEV tickets'
  if (/ad studio v2/i.test(title)) return 'Ad Studio v2'
  return 'other'
}

interface OpenPrRow {
  number: number
  title: string
  htmlUrl: string
  lane: string
  program: string
  draft: boolean
  mergeableState: string
  updatedAt: string
  protected: boolean
  protectedGlobs: string[]
  failingChecks: string[]
  pendingChecks: string[]
  ticket: TicketFacts | null
  waitingOn: string
}

interface MergedPrRow {
  number: number
  title: string
  htmlUrl: string
  mergedAt: string
}

interface StaleVerifiedRow {
  id: number
  kind: string
  summary: string
  prRef: string | null
}

function waitingOnFor(pr: PullRequestSummary, failing: string[], pending: string[], protectedPath: boolean, ticket: TicketFacts | null): string {
  if (failing.length > 0) return `CI failing: ${failing.join(', ')}`
  if (pending.length > 0) return 'CI running'
  if (pr.mergeableState === 'dirty') return `rebase onto ${pr.baseRef}`
  if (protectedPath) return 'owner merge (protected path)'
  if (!ticket) return 'ticket (auto-files on the engine’s next cycle)'
  if (ticket.status === 'blocked') return 'blocked — see ticket'
  if (ticket.status === 'pr_open') return 'QA pass'
  if (ticket.status === 'in_review') return 'QA review'
  if (ticket.status === 'verified') return 'release engine merge'
  if (ticket.status === 'applied') return 'already applied — PR should be closed'
  return `ticket ${ticket.status}`
}

async function gatherOpenPrRows(): Promise<{ rows: OpenPrRow[]; openNumbers: Set<number> } | null> {
  const openRes = await listOpenPullRequests()
  if (!openRes.ok) return null
  const openNumbers = new Set(openRes.data.map(p => p.number))

  const rows = await Promise.all(
    openRes.data.map(async (pr): Promise<OpenPrRow> => {
      const [checksRes, filesRes, ticket] = await Promise.all([
        getChecksForRef(pr.headSha),
        listPullRequestFiles(pr.number),
        resolveTicketForPr(pr).catch(() => null),
      ])
      const checks = checksRes.ok ? checksRes.data : null
      const classification = classifyChangedFiles(filesRes.ok ? filesRes.data : [])
      const failing = checks?.failing ?? []
      const pending = checks?.pending ?? []
      return {
        number: pr.number,
        title: pr.title,
        htmlUrl: pr.htmlUrl,
        lane: laneOf(pr.headRef),
        program: programOf(pr.title),
        draft: pr.draft,
        mergeableState: pr.mergeableState,
        updatedAt: pr.updatedAt,
        protected: classification.protected,
        protectedGlobs: classification.globs,
        failingChecks: failing,
        pendingChecks: pending,
        ticket,
        waitingOn: waitingOnFor(pr, failing, pending, classification.protected, ticket),
      }
    }),
  )
  return { rows, openNumbers }
}

async function gatherMergedLast7Days(): Promise<MergedPrRow[]> {
  const res = await githubRequest<Array<{
    number: number
    title: string
    html_url: string
    merged_at: string | null
  }>>('/repos/{owner}/{repo}/pulls?state=closed&per_page=50&sort=updated&direction=desc')
  if (!res.ok) return []
  const sinceMs = Date.now() - 7 * 24 * 60 * 60 * 1000
  return res.data
    .filter(p => p.merged_at && new Date(p.merged_at).getTime() >= sinceMs)
    .map(p => ({ number: p.number, title: p.title, htmlUrl: p.html_url, mergedAt: p.merged_at! }))
    .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt))
}

async function gatherStaleVerified(openNumbers: Set<number>): Promise<StaleVerifiedRow[]> {
  const verified = await db
    .select({ id: homepageTeamSuggestions.id, kind: homepageTeamSuggestions.kind, suggestion: homepageTeamSuggestions.suggestion })
    .from(homepageTeamSuggestions)
    .where(eq(homepageTeamSuggestions.status, 'verified'))
    .orderBy(desc(homepageTeamSuggestions.id))
    .limit(50)
  if (verified.length === 0) return []

  const out: StaleVerifiedRow[] = []
  for (const row of verified) {
    const links = await db
      .select({ ref: suggestionLinks.ref })
      .from(suggestionLinks)
      .where(and(eq(suggestionLinks.suggestionId, row.id), eq(suggestionLinks.kind, 'pr')))
      .orderBy(desc(suggestionLinks.createdAt))
      .limit(1)
    const prRef = links[0]?.ref ?? null
    const prNumber = prRef ? Number(prRef.match(/\/pull\/(\d+)/)?.[1] ?? prRef.replace('#', '')) : null
    // "No open PR" is the stale signal: a verified ticket whose PR already
    // merged should have reached `applied` by now (the release engine's own
    // job); one still sitting at `verified` is the thing this section exists
    // to surface. A verified ticket with no pr link at all is the same shape
    // (nothing left for the engine to track) and is included too.
    if (prNumber === null || !openNumbers.has(prNumber)) {
      out.push({ id: row.id, kind: row.kind, summary: row.suggestion.slice(0, 140), prRef })
    }
  }
  return out
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)

  const openResult = await gatherOpenPrRows().catch((err) => {
    console.warn('[admin.pr-queue] open PR gather failed:', err)
    return null
  })
  const [merged, staleVerified] = await Promise.all([
    gatherMergedLast7Days().catch((err) => {
      console.warn('[admin.pr-queue] merged-PR gather failed:', err)
      return [] as MergedPrRow[]
    }),
    openResult ? gatherStaleVerified(openResult.openNumbers).catch((err) => {
      console.warn('[admin.pr-queue] stale-verified gather failed:', err)
      return [] as StaleVerifiedRow[]
    }) : Promise.resolve([] as StaleVerifiedRow[]),
  ])

  return {
    openRows: openResult?.rows ?? null,
    merged,
    staleVerified,
  }
}

function agePhrase(iso: string): string {
  if (!iso) return 'unknown'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  return `${days}d ago`
}

function OpenPrRowView({ r }: { r: OpenPrRow }) {
  const stuck = (Date.now() - new Date(r.updatedAt).getTime()) > 24 * 60 * 60 * 1000
  return (
    <tr className="border-t border-line align-top">
      <td className="py-3 pr-3">
        <a href={r.htmlUrl} target="_blank" rel="noreferrer" className="font-semibold text-ink hover:text-coral">
          #{r.number} {r.title}
        </a>
        <div className="text-xs text-ink-4 mt-1">{r.lane} &middot; {r.program}{r.draft ? ' · draft' : ''}</div>
        {r.protected && (
          <div className="text-xs text-plum mt-1">protected: {r.protectedGlobs.join(', ')}</div>
        )}
      </td>
      <td className="py-3 px-3 whitespace-nowrap text-xs">
        {r.ticket ? (
          <>
            <div className="font-mono text-ink-3">#{r.ticket.id} {r.ticket.status}</div>
            {r.ticket.attemptCount > 0 && <div className="text-amber-600">attempt {r.ticket.attemptCount}/3</div>}
          </>
        ) : (
          <span className="text-ink-4">no ticket yet</span>
        )}
      </td>
      <td className="py-3 px-3 text-xs">
        <span className={r.failingChecks.length > 0 ? 'text-red-600 font-semibold' : r.pendingChecks.length > 0 ? 'text-amber-600' : 'text-sage'}>
          {r.waitingOn}
        </span>
      </td>
      <td className={`py-3 pl-3 whitespace-nowrap text-xs ${stuck ? 'text-red-600 font-semibold' : 'text-ink-4'}`}>
        {agePhrase(r.updatedAt)}
      </td>
    </tr>
  )
}

export default function AdminPrQueue() {
  const { openRows, merged, staleVerified } = useLoaderData<typeof loader>()

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-display text-ink mb-1">PR Queue</h1>
      <p className="text-sm text-ink-3 mb-5">
        Every open agent PR joined with its ticket, and what it is waiting on.
      </p>

      {openRows === null ? (
        <p className="text-sm text-red-600">Could not read GitHub's open PR list this load. Try again shortly.</p>
      ) : openRows.length === 0 ? (
        <p className="text-sage py-6">No open PRs.</p>
      ) : (
        <ResponsiveTable>
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-4">
                <th className="pb-2 pr-3 font-medium">PR</th>
                <th className="pb-2 px-3 font-medium">Ticket</th>
                <th className="pb-2 px-3 font-medium">Waiting on</th>
                <th className="pb-2 pl-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {openRows.map(r => <OpenPrRowView key={r.number} r={r} />)}
            </tbody>
          </table>
        </ResponsiveTable>
      )}

      <h2 className="text-sm font-semibold text-ink-3 mt-10 mb-2">Merged, last 7 days ({merged.length})</h2>
      {merged.length === 0 ? (
        <p className="text-xs text-ink-4">Nothing merged in the last 7 days.</p>
      ) : (
        <ul className="text-xs text-ink-4 space-y-1">
          {merged.map(m => (
            <li key={m.number}>
              <a href={m.htmlUrl} target="_blank" rel="noreferrer" className="text-ink-3 hover:text-coral">
                #{m.number} {m.title}
              </a>
              <span> &middot; merged {m.mergedAt.slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="text-sm font-semibold text-ink-3 mt-10 mb-2">
        Verified with no open PR ({staleVerified.length})
      </h2>
      {staleVerified.length === 0 ? (
        <p className="text-xs text-sage">None — every verified ticket is either applied or still tracked by an open PR.</p>
      ) : (
        <ul className="text-xs text-ink-4 space-y-1">
          {staleVerified.map(s => (
            <li key={s.id}>
              <span className="font-mono text-ink-3">#{s.id}</span> ({s.kind}) {s.summary}
              {s.prRef && <span className="text-ink-4"> &middot; last pr: {s.prRef}</span>}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-ink-4 mt-8">
        <Link to="/admin/ops" className="link-coral">/admin/ops</Link> has the one-line owner queue; this page is the detail behind it.
      </p>
    </div>
  )
}
