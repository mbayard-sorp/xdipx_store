/**
 * admin.ads.actions.tsx: the ad_actions ledger in the ads console (ticket
 * #16430, plan §4 and §7 phase 4d).
 *
 * Four tabs: Pending (proposed), Dry run, Applied (applied plus approved rows
 * waiting for the applier) and Failed (failed, rejected and expired). Approve
 * and Reject post here through useFetcher and move a proposed row to approved
 * or rejected. Approving applies nothing to a platform; Phase 5b's hourly
 * applier picks approved rows up. The vocabulary follows the digest in plan
 * §9.8: "Your taps" for what waits on the owner, "Machine did" for tier A.
 */
import { useEffect, useState } from 'react'
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, useFetcher, useLoaderData } from 'react-router'
import { getAdminUser, requireAdmin } from '~/lib/session.server'
import {
  ACTIONS_TABS,
  TAB_LABELS,
  approveAction,
  loadActions,
  parseTab,
  rejectAction,
  type ActionView,
  type ActionsTab,
  type DecisionResult,
} from '~/lib/ads/actions-view.server'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'

export const meta: MetaFunction = () => [{ title: 'Actions - Ads - xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  return loadActions({ tab: parseTab(url.searchParams.get('tab')) })
}

export async function action({ request }: ActionFunctionArgs): Promise<DecisionResult> {
  await requireAdmin(request)
  const admin = await getAdminUser(request)
  const actor = admin?.email || 'owner'
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  const id = Number(form.get('id'))
  if (intent === 'approve') return approveAction(id, actor)
  if (intent === 'reject') return rejectAction(id, actor, String(form.get('note') ?? ''))
  return { ok: false, id, code: 'not_pending', error: 'That button did not send a known decision.' }
}

const EMPTY: Readonly<Record<ActionsTab, string>> = {
  pending: 'Nothing is waiting for you. Proposals from the rules and the buyer land here when they need a tap.',
  dry_run: 'No dry-run rows yet. While ads_spend_enabled or ads_auto_apply_enabled is off, every rule firing is written here instead of reaching a platform.',
  applied: 'Nothing has been approved or applied yet.',
  failed: 'No failed, rejected or expired actions.',
}

function when(isoString: string | null): string {
  if (!isoString) return ''
  return new Date(isoString).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}

const STATUS_TONE: Record<string, string> = {
  proposed: 'text-amber-800',
  dry_run: 'text-plum-2',
  approved: 'text-ink-3',
  applied: 'text-sage',
  failed: 'text-red-800',
  rejected: 'text-ink-3',
  expired: 'text-ink-4',
}

interface Decided {
  id: number
  text: string
  ok: boolean
}

export default function AdsActions() {
  const page = useLoaderData<typeof loader>()
  const [decided, setDecided] = useState<Decided[]>([])
  const onDecided = (d: Decided) => setDecided(prev => [d, ...prev.filter(p => p.id !== d.id)].slice(0, 5))
  const showDecide = page.tab === 'pending'

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-xl md:text-2xl text-ink">Actions</h1>
        <p className="text-xs text-ink-4">Approving queues a row for the hourly applier. Nothing here calls a platform.</p>
      </div>

      <nav aria-label="Action views" className="flex flex-wrap gap-1">
        {ACTIONS_TABS.map(t => {
          const active = t === page.tab
          return (
            <Link
              key={t}
              to={t === 'pending' ? '?' : `?tab=${t}`}
              preventScrollReset
              aria-current={active ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm touch-manipulation ${
                active ? 'border-ink bg-ink text-paper' : 'border-line bg-paper text-ink-3 hover:border-ink-4'
              }`}
            >
              {TAB_LABELS[t]}
              <span className={`font-mono text-[11px] tabular-nums ${active ? 'text-paper/80' : 'text-ink-4'}`}>{page.counts[t]}</span>
            </Link>
          )
        })}
      </nav>

      {decided.length > 0 && (
        <ul role="status" className="space-y-1 rounded-xl border border-line bg-paper-2 px-3 py-2 text-sm">
          {decided.map(d => (
            <li key={d.id} className={d.ok ? 'text-ink' : 'text-red-800'}>{d.text}</li>
          ))}
        </ul>
      )}

      {page.tab === 'pending' && page.rows.length > 0 && (
        <p className="kicker">Your taps</p>
      )}

      {page.rows.length === 0 ? (
        <p className="text-sm text-ink-3">{EMPTY[page.tab]}</p>
      ) : (
        <ResponsiveTable className="rounded-xl border border-line">
          <table className={`w-full text-sm text-left ${showDecide ? 'min-w-[1080px]' : 'min-w-[960px]'}`}>
            <thead className="bg-paper-2 text-[11px] uppercase tracking-wide text-ink-4">
              <tr>
                {['Action', 'Proposed by', 'Reason', 'Tier', 'Before', 'After', 'Status', showDecide ? 'Decide' : 'Outcome'].map(h => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {page.rows.map(row => (
                <ActionRow key={row.id} row={row} showDecide={showDecide} onDecided={onDecided} />
              ))}
            </tbody>
          </table>
        </ResponsiveTable>
      )}

      {page.rows.length >= page.limit && (
        <p className="text-xs text-ink-4">Showing the newest {page.limit}.</p>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 flex min-h-14 items-center justify-between gap-3 border-t border-line bg-paper px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
        <p className="text-sm text-ink">
          <span className="font-mono font-semibold tabular-nums">{page.pendingCount}</span> waiting for you
        </p>
        {page.tab !== 'pending' && page.pendingCount > 0 && (
          <Link to="?" className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm text-ink touch-manipulation">
            Show pending
          </Link>
        )}
      </div>
    </div>
  )
}

function ActionRow({ row, showDecide, onDecided }: {
  row: ActionView
  showDecide: boolean
  onDecided: (d: Decided) => void
}) {
  const machine = row.status === 'applied' && row.tier === 'auto'
  return (
    <tr className="align-top">
      <td className="px-3 py-2">
        <p className="font-medium text-ink">
          {row.verbLabel}
          <span className="ml-2 font-mono text-[11px] text-ink-4">#{row.id}</span>
        </p>
        <p className="break-words text-ink-3">{row.target.label}</p>
        <p className="font-mono text-[11px] text-ink-4">
          {row.platform} {row.target.externalId}
          {row.creativeId != null && <> · creative #{row.creativeId}</>}
          {!row.target.inMirror && <> · not in the mirror</>}
        </p>
        <p className="font-mono text-[11px] text-ink-4">{when(row.createdAt)}</p>
      </td>
      <td className="px-3 py-2 font-mono text-[12px] text-ink-3 break-words">{row.proposedBy}</td>
      <td className="max-w-[260px] px-3 py-2 text-ink-3 break-words">{row.reason ?? ''}</td>
      <td className="px-3 py-2 whitespace-nowrap text-ink-3">{row.tierLabel}</td>
      <td className="px-3 py-2 text-ink-3">{row.before ?? ''}</td>
      <td className="px-3 py-2 text-ink">{row.after ?? ''}</td>
      <td className="px-3 py-2">
        <p className={STATUS_TONE[row.status] ?? 'text-ink-3'}>{machine ? 'Machine did' : row.statusLabel}</p>
        {row.decidedBy && row.decidedAt && (
          <p className="text-[11px] text-ink-4 break-words">
            {row.status === 'rejected' ? 'Rejected' : 'Approved'} by {row.decidedBy}, {when(row.decidedAt)}
          </p>
        )}
        {row.appliedAt && <p className="text-[11px] text-ink-4">Applied {when(row.appliedAt)}</p>}
        {row.expiresAt && row.status === 'proposed' && <p className="text-[11px] text-ink-4">Expires {when(row.expiresAt)}</p>}
      </td>
      <td className="px-3 py-2">
        {showDecide ? (
          <DecideCell row={row} onDecided={onDecided} />
        ) : (
          <>
            {row.outcome && <p className="max-w-[260px] break-words text-[12px] text-ink-3">{row.outcome}</p>}
            {row.lockedReason && row.status !== 'applied' && row.status !== 'approved' && (
              <p className="mt-1 max-w-[260px] text-[11px] text-ink-4">{row.lockedReason}</p>
            )}
          </>
        )}
      </td>
    </tr>
  )
}

function DecideCell({ row, onDecided }: { row: ActionView; onDecided: (d: Decided) => void }) {
  const fetcher = useFetcher<DecisionResult>({ key: `ad-action-${row.id}` })
  const pending = fetcher.state !== 'idle'
  const sending = pending ? String(fetcher.formData?.get('intent') ?? '') : ''
  const result = fetcher.data

  useEffect(() => {
    if (!result) return
    onDecided({
      id: result.id,
      ok: result.ok,
      text: result.ok
        ? result.status === 'approved'
          ? `Approved #${result.id}: ${row.verbLabel.toLowerCase()} ${row.target.label}. The hourly applier picks it up.`
          : `Rejected #${result.id}: ${row.verbLabel.toLowerCase()} ${row.target.label}.`
        : `#${result.id}: ${result.error}`,
    })
    // onDecided and row are stable enough for this; the effect keys on the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  if (!row.decidable) {
    return <p className="max-w-[220px] text-[12px] text-ink-3">{row.lockedReason}</p>
  }

  return (
    <fetcher.Form method="post" className="flex min-w-[220px] flex-col gap-2" aria-busy={pending}>
      <input type="hidden" name="id" value={row.id} />
      <div className="flex gap-2">
        <button
          type="submit"
          name="intent"
          value="approve"
          disabled={pending}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full bg-coral px-4 text-sm font-medium text-paper hover:bg-coral-2 disabled:opacity-60 touch-manipulation"
        >
          {sending === 'approve' ? 'Approving' : 'Approve'}
        </button>
        <button
          type="submit"
          name="intent"
          value="reject"
          disabled={pending}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-60 touch-manipulation"
        >
          {sending === 'reject' ? 'Rejecting' : 'Reject'}
        </button>
      </div>
      <label className="block">
        <span className="sr-only">Note for a rejection, optional</span>
        <input
          type="text"
          name="note"
          maxLength={280}
          placeholder="Why not? (optional, for Reject)"
          disabled={pending}
          className="min-h-11 w-full rounded-lg border border-line bg-paper px-3 text-sm text-ink placeholder:text-ink-4"
        />
      </label>
      {result && !result.ok && (
        <p role="alert" className="text-[12px] text-red-800">{result.error}</p>
      )}
      {result?.ok && !pending && (
        <p role="status" className="text-[12px] text-sage">{result.status === 'approved' ? 'Approved.' : 'Rejected.'}</p>
      )}
    </fetcher.Form>
  )
}
