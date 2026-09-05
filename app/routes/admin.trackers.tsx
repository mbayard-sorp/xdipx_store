/**
 * /admin/trackers
 *
 * Read-only view of the program-manager trackers (docs/store-team/trackers).
 * Gives the owner an interface to follow what the program-manager is
 * tracking without opening markdown files: one card per program with overall
 * RAG, the milestone table, and the latest status-log entries.
 */

import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { getTrackers } from '~/lib/tracker.server'
import { measureMilestones } from '~/lib/tracker-probes.server'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'

export const meta: MetaFunction = () => [{ title: 'Trackers · xdipx admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  // Measured verdicts for the milestones that have a registered probe. The RAG
  // pill is a claim someone typed; this column is the evidence, and the page
  // rendered the claim alone until now.
  const measurements = await measureMilestones().catch(() => [])
  return { trackers: getTrackers(), measurements }
}

/** Measured verdict beside an asserted RAG, or an honest blank. */
function EvidenceCell(
  { verdict, measured }: { verdict?: string | undefined; measured?: number | null | undefined },
) {
  if (!verdict) return <span className="text-xs text-gray-400">asserted</span>
  if (verdict === 'unreadable') return <span className="text-xs text-gray-500">unreadable</span>
  const pass = verdict === 'pass'
  return (
    <span className={`text-xs font-medium ${pass ? 'text-emerald-700' : 'text-red-700'}`}>
      {pass ? 'measured pass' : 'measured FAIL'}
      {measured === null || measured === undefined ? '' : ` (${measured})`}
    </span>
  )
}

function RagPill({ rag }: { rag: string }) {
  const cls =
    rag === 'GREEN'
      ? 'bg-emerald-100 text-emerald-800'
      : rag === 'AMBER'
        ? 'bg-amber-100 text-amber-800'
        : rag === 'RED'
          ? 'bg-red-100 text-red-800'
          : 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {rag}
    </span>
  )
}

export default function AdminTrackers() {
  const { trackers, measurements } = useLoaderData<typeof loader>()

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Program trackers</h1>
          <p className="text-sm text-gray-500">
            Audited weekly by the program-manager routine. Source of truth: docs/store-team/trackers on main.
          </p>
        </div>
      </div>

      {trackers.length === 0 && (
        <p className="text-sm text-gray-500">No tracker files found in this deploy.</p>
      )}

      {trackers.map(t => (
        <section key={t.slug} className="rounded-xl border border-gray-200 bg-white p-4 md:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <RagPill rag={t.overall} />
            <h2 className="text-base font-semibold">{t.title || t.slug}</h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {t.program}
            {t.targetEnd ? ` · target end ${t.targetEnd}` : ''}
            {t.started ? ` · started ${t.started}` : ''}
          </p>

          {t.milestones.length > 0 && (
            <ResponsiveTable className="mt-4">
              <table className="min-w-[900px] w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs uppercase text-gray-500">
                    <th className="py-2 pr-3">id</th>
                    <th className="py-2 pr-3">milestone</th>
                    <th className="py-2 pr-3">phase</th>
                    <th className="py-2 pr-3">owner</th>
                    <th className="py-2 pr-3">target</th>
                    <th className="py-2 pr-3">status</th>
                    <th className="py-2 pr-3">RAG</th>
                    <th className="py-2 pr-3">evidence</th>
                    <th className="py-2 pr-3">verified</th>
                    <th className="py-2">notes</th>
                  </tr>
                </thead>
                <tbody>
                  {t.milestones.map(m => {
                    const measurement = measurements.find(x => x.key === `${t.slug}:${m.id}`)
                    // An unearned GREEN is the whole reason this column exists:
                    // done/GREEN with a failing probe reads as finished and is not.
                    const contradicted = m.rag === 'GREEN' && measurement?.verdict === 'fail'
                    return (
                    <tr
                      key={m.id}
                      className={`border-b border-gray-100 align-top${contradicted ? ' bg-red-50' : ''}`}
                    >
                      <td className="py-2 pr-3 font-mono text-xs">{m.id}</td>
                      <td className="py-2 pr-3" title={m.evidenceProbe}>{m.milestone}</td>
                      <td className="py-2 pr-3">{m.phase}</td>
                      <td className="py-2 pr-3">{m.owner}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{m.targetWeek}</td>
                      <td className="py-2 pr-3">{m.status}</td>
                      <td className="py-2 pr-3"><RagPill rag={m.rag} /></td>
                      <td className="py-2 pr-3" title={m.evidenceProbe}>
                        <EvidenceCell
                          verdict={measurement?.verdict}
                          measured={measurement?.measured}
                        />
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{m.lastVerified}</td>
                      <td className="py-2 max-w-[360px]">
                        {m.malformed
                          ? <span className="mr-1 text-xs text-amber-700">[columns may be misaligned]</span>
                          : null}
                        {m.notes}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </ResponsiveTable>
          )}

          {t.statusLog.length > 0 && (
            <div className="mt-4 space-y-3">
              <h3 className="text-sm font-semibold">Status log</h3>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-sm font-medium">{t.statusLog[0]!.heading}</p>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-gray-700">
                  {t.statusLog[0]!.body}
                </pre>
              </div>
              {t.statusLog.length > 1 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-gray-500">
                    Older entries ({t.statusLog.length - 1})
                  </summary>
                  <div className="mt-2 space-y-3">
                    {t.statusLog.slice(1).map(e => (
                      <div key={e.heading} className="rounded-lg bg-gray-50 p-3">
                        <p className="text-sm font-medium">{e.heading}</p>
                        <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-gray-700">
                          {e.body}
                        </pre>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
