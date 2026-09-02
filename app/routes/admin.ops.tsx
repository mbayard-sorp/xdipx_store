/**
 * /admin/ops — the third rendering of `computeOwnerQueue()`.
 *
 * The same computation the daily email and `/api/team/status` carry, so the
 * three never disagree. That is the whole of invariant 4: before this, the
 * owner's picture of what needed doing was assembled by reading fifteen emails
 * from fifteen senders, each of which had decided independently that it
 * mattered.
 *
 * Deliberately read-only. Every entry names the single move and links to where
 * it happens; none of them is performed from here. Adding buttons would make
 * this a second place to act, and a second place to act is a second place for
 * the two to drift — which is the failure being removed, reintroduced with a
 * nicer UI.
 */

import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData } from 'react-router'

import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import { computeOwnerQueue } from '~/lib/owner-queue.server'
import { requireAdmin } from '~/lib/session.server'

export const meta: MetaFunction = () => [{ title: 'Ops — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  // Never 500 the page on a gatherer failure: a queue that cannot be computed
  // must still render, saying so, because a blank ops page and a clear one look
  // identical and only one of them is good news.
  const queue = await computeOwnerQueue().catch((err) => {
    console.error('[admin/ops] queue unavailable', err)
    return null
  })
  return { queue }
}

/** `null` is "could not read", and must never render as a zero. */
function Money({ label, value, suffix }: { label: string; value: number | null; suffix?: string }) {
  return (
    <div className="rounded-[--radius-sm] border border-line bg-paper-2 p-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-4">{label}</div>
      <div className="mt-1 text-lg font-semibold text-ink">
        {value === null
          ? <span className="text-base font-normal text-coral">could not read</span>
          : `${suffix === '$' ? '$' : ''}${value.toFixed(suffix === '$' ? 2 : 0)}`}
      </div>
    </div>
  )
}

export default function AdminOps() {
  const { queue } = useLoaderData<typeof loader>()

  if (!queue) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>Ops</h1>
        <p className="rounded-[--radius-sm] border border-coral bg-coral-soft p-4 text-sm text-ink">
          The owner queue could not be computed. This is a failure, not an empty queue: treat it as
          unknown rather than as clear, and check the server logs.
        </p>
      </div>
    )
  }

  const { money, entries, health, gaps } = queue

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>Ops</h1>
      <p className="mb-6 text-xs text-ink-3">
        The same queue the daily email sends and <code>/api/team/status</code> serves. Read-only:
        every entry names where the move happens.
      </p>

      {gaps.length > 0 && (
        <p className="mb-6 rounded-[--radius-sm] border border-coral bg-coral-soft p-3 text-sm text-ink">
          <strong>This queue is incomplete.</strong> Could not read: {gaps.join(', ')}. Treat what
          follows as partial, not as clear.
        </p>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-3">Money</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Money label="Orders, 7d" value={money.ordersLast7} />
          <Money label="Revenue, 7d" value={money.revenueLast7Usd} suffix="$" />
          <Money label="Profit, 30d" value={money.profitLast30Usd} suffix="$" />
          <Money label="Estate spend, 30d" value={money.estateSpendLast30Usd} suffix="$" />
        </div>
        <p className="mt-3 text-sm text-ink-2">{money.verdict}</p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-3">
          Your queue{entries.length > 0 ? ` (${entries.length})` : ''}
        </h2>
        {entries.length === 0 ? (
          <p className="text-sm text-sage">Nothing is waiting on you.</p>
        ) : (
          <ul className="space-y-4">
            {entries.map((e) => (
              <li key={e.id} className="border-l-2 border-line pl-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="rounded bg-plum-soft px-1.5 py-0.5 text-[11px] font-semibold text-plum-2">
                    P{e.priority}
                  </span>
                  <span className="text-[11px] text-ink-4">{e.cls}</span>
                  <span className="text-sm text-ink">{e.title}</span>
                </div>
                <div className="mt-1 text-sm font-semibold text-ink">&rarr; {e.move}</div>
                <div className="mt-0.5 text-[11px] text-ink-4">
                  {e.source} &middot; {e.ageDays}d &middot;{' '}
                  {e.probe === null
                    ? 'no probe'
                    : e.probe.stale
                      // A stale probe is not a failing one. Rendering its last
                      // verdict here would present an unread check as a result.
                      ? <span className="text-coral">probe {e.probe.kind} not evaluated in 24h</span>
                      : `probe ${e.probe.kind}, ${e.probe.lastOk ? 'still true' : 'cleared'}`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-3">
          Lane flow, last 14 days
        </h2>
        <p className="mb-3 text-xs text-ink-3">
          Intake against terminal, per kind. A positive net is a lane filling faster than anything
          empties it, which is this program&rsquo;s founding diagnosis rather than a curiosity.
        </p>
        <ResponsiveTable>
          <table className="min-w-[420px] w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-4">
                <th className="py-1 pr-4 font-medium">Kind</th>
                <th className="py-1 pr-4 font-medium">Created</th>
                <th className="py-1 pr-4 font-medium">Closed</th>
                <th className="py-1 font-medium">Net / day</th>
              </tr>
            </thead>
            <tbody>
              {health.laneFlow.map((f) => (
                <tr key={f.kind} className="border-b border-line-2">
                  <td className="py-1 pr-4 text-ink">{f.kind}</td>
                  <td className="py-1 pr-4 text-ink-3">{f.created14d}</td>
                  <td className="py-1 pr-4 text-ink-3">{f.terminal14d}</td>
                  <td className={`py-1 font-semibold ${f.netPerDay > 0 ? 'text-coral' : 'text-sage'}`}>
                    {f.netPerDay > 0 ? '+' : ''}{f.netPerDay}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTable>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Money label="Blocked tickets" value={health.blocked} />
          <Money label="…at 0 attempts" value={health.blockedAtZeroAttempts} />
          <Money label="Open blockers" value={health.openBlockers} />
          <Money label="…without a probe" value={health.blockersWithoutProbe} />
        </div>
        <p className="mt-2 text-[11px] text-ink-4">
          &ldquo;At 0 attempts&rdquo; is the three-strikes ladder that has never fired:
          <code> MAX_TICKET_ATTEMPTS</code> is 3, and every blocked row has been tried zero times.
        </p>

        {health.recentValveChanges.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-3">
              Valve changes, last 24h
            </h3>
            <ul className="space-y-1 text-sm">
              {health.recentValveChanges.map((c) => (
                <li key={`${c.key}-${c.changedAt}`} className="text-ink-2">
                  <code className="text-ink">{c.key}</code>{' '}
                  {c.oldValue ?? '(unset)'} &rarr; <strong>{c.newValue ?? '(unset)'}</strong>{' '}
                  {c.unattributed
                    // Not an accusation, a gap in the record. Four team valves
                    // were flipped on 2026-07-18 while the docs said otherwise
                    // for eleven days, and only the owner can say whose it was.
                    ? <span className="text-coral">by an unrecorded actor</span>
                    : <span className="text-ink-4">by {c.actor}{c.source ? ` (${c.source})` : ''}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}
