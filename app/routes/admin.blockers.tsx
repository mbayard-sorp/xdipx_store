/**
 * /admin/blockers — the owner blocker list.
 *
 * One question this page answers: what is waiting on Mike, and what ships when
 * he does it. Everything else about the store lives on other admin pages; if
 * this one grows a second concern it stops being a task list.
 *
 * Data flows loader -> useLoaderData; the clear/dismiss buttons post to the
 * route action via <Form>. "Re-check now" runs the probes on demand rather
 * than waiting for the 13:30 UTC cron, which is what you want right after
 * doing one of these things.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Form, useActionData, useLoaderData, useNavigation } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import {
  clearBlocker,
  dismissBlocker,
  listAllBlockers,
  listRecentlyCleared,
  verifyBlockers,
} from '~/lib/owner-blockers.server'
// Pure half only: importing describeProbe from the .server module would drag
// the Neon client into the client bundle and fail the build.
import { describeProbe, type OwnerBlocker } from '~/lib/owner-blockers-core'

export const meta: MetaFunction = () => [{ title: 'Blockers — xdipx Admin' }]

const CATEGORY_COLORS: Record<string, string> = {
  migration:  'bg-plum-soft text-plum',
  valve:      'bg-coral-soft text-coral',
  console:    'bg-paper-3 text-ink-3',
  credential: 'bg-red-100 text-red-700',
  approval:   'bg-plum-soft text-plum',
  merge:      'bg-coral-soft text-coral',
  execute:    'bg-paper-3 text-ink-3',
  other:      'bg-paper-3 text-ink-3',
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const all = await listAllBlockers()
  return {
    open: all.filter(b => b.status === 'open'),
    cleared: await listRecentlyCleared(14, 30),
  }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')

  if (intent === 'verify') {
    const result = await verifyBlockers()
    return { ok: true, message: `Re-checked ${result.checked}: ${result.autoCleared.length} cleared, ${result.stillBlocked} still blocked, ${result.unknown} unknown.` }
  }

  const id = Number(form.get('id') ?? 0)
  if (!id) return { ok: false, message: 'No id.' }

  if (intent === 'clear') {
    await clearBlocker(id, 'owner', String(form.get('note') ?? '') || null)
    return { ok: true, message: `Cleared #${id}.` }
  }
  if (intent === 'dismiss') {
    await dismissBlocker(id, String(form.get('note') ?? '') || null)
    return { ok: true, message: `Dismissed #${id}. It will not come back unless something re-files it.` }
  }
  return { ok: false, message: 'Unknown intent.' }
}

function ageClass(days: number): string {
  return days >= 14 ? 'text-red-600 font-semibold' : days >= 5 ? 'text-amber-600' : 'text-ink-3'
}

function agePhrase(days: number): string {
  if (days <= 0) return 'today'
  return `${days}d`
}

function BlockerRow({ b }: { b: OwnerBlocker }) {
  const probe = describeProbe(b.verifyProbe, b.verifyArg)
  return (
    <tr className="border-t border-line align-top">
      <td className="py-3 pr-3">
        <div className="font-semibold text-ink">{b.title}</div>
        {b.detail && <div className="text-ink-3 mt-1">{b.detail}</div>}
        {b.whereToGo && (
          <div className="mt-1 text-xs">
            <span className="font-semibold text-ink-3">Where: </span>
            <span className="font-mono text-ink-3">{b.whereToGo}</span>
          </div>
        )}
        {b.unblocks && (
          <div className="mt-1 text-xs text-sage">
            <span className="font-semibold">Unblocks: </span>{b.unblocks}
          </div>
        )}
        {b.evidence && (
          <details className="mt-1 text-xs text-ink-4">
            <summary className="cursor-pointer">evidence</summary>
            <div className="mt-1 whitespace-pre-wrap">{b.evidence}</div>
            {b.sourceRef && <div className="mt-1 font-mono">{b.sourceRef}</div>}
          </details>
        )}
      </td>
      <td className="py-3 px-3 whitespace-nowrap">
        <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-mono ${CATEGORY_COLORS[b.category] ?? CATEGORY_COLORS['other']}`}>
          {b.category}
        </span>
        <div className="text-xs text-ink-4 mt-1">P{b.priority} &middot; #{b.id}</div>
      </td>
      <td className={`py-3 px-3 whitespace-nowrap text-xs ${ageClass(b.ageDays)}`}>
        {agePhrase(b.ageDays)}
      </td>
      <td className="py-3 px-3 text-xs text-ink-4">
        {probe ? (
          <>
            <div>clears when {probe}</div>
            {b.lastVerifiedAt && (
              <div className="mt-0.5">checked {b.lastVerifiedAt.slice(0, 16).replace('T', ' ')}</div>
            )}
          </>
        ) : (
          <em>no auto-check</em>
        )}
      </td>
      <td className="py-3 pl-3 whitespace-nowrap">
        <Form method="post" className="flex flex-col gap-1">
          <input type="hidden" name="id" value={b.id} />
          <button
            name="intent" value="clear" type="submit"
            className="px-2 py-1 rounded-md bg-coral text-white text-xs font-semibold hover:bg-coral-2"
          >
            Done
          </button>
          <button
            name="intent" value="dismiss" type="submit"
            className="px-2 py-1 rounded-md bg-paper-3 text-ink-3 text-xs hover:bg-line"
          >
            Not real
          </button>
        </Form>
      </td>
    </tr>
  )
}

export default function AdminBlockers() {
  const { open, cleared } = useLoaderData<typeof loader>()
  const result = useActionData<typeof action>()
  const nav = useNavigation()
  const busy = nav.state !== 'idle'

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h1 className="text-xl font-display text-ink">Blockers</h1>
        <Form method="post">
          <button
            name="intent" value="verify" type="submit" disabled={busy}
            className="px-3 py-1.5 rounded-md border border-line text-sm text-ink-3 hover:bg-paper-2 disabled:opacity-50"
          >
            {busy ? 'Checking…' : 'Re-check now'}
          </button>
        </Form>
      </div>
      <p className="text-sm text-ink-3 mb-5">
        Things no agent can do for you. Rows with a check close themselves once the condition is met.
      </p>

      {result?.message && (
        <p className={`text-sm mb-4 px-3 py-2 rounded-md ${result.ok ? 'bg-plum-soft text-plum' : 'bg-red-100 text-red-700'}`}>
          {result.message}
        </p>
      )}

      {open.length === 0 ? (
        <p className="text-sage py-6">Nothing is waiting on you.</p>
      ) : (
        <ResponsiveTable>
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-4">
                <th className="pb-2 pr-3 font-medium">What</th>
                <th className="pb-2 px-3 font-medium">Kind</th>
                <th className="pb-2 px-3 font-medium">Open</th>
                <th className="pb-2 px-3 font-medium">Auto-check</th>
                <th className="pb-2 pl-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {open.map(b => <BlockerRow key={b.id} b={b} />)}
            </tbody>
          </table>
        </ResponsiveTable>
      )}

      {cleared.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-ink-3 mt-10 mb-2">Cleared, last 14 days</h2>
          <ul className="text-xs text-ink-4 space-y-1">
            {cleared.map(c => (
              <li key={c.id}>
                <span className="text-sage">✓</span> {c.title}
                <span className="text-ink-4"> &middot; #{c.id}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
