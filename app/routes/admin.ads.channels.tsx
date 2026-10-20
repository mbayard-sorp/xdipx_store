/**
 * /admin/ads/channels: every ad channel and its enablement checklist
 * (ticket #16438, plan sections 6 and 7 phase 7a).
 *
 * The table lists each channel in the registry with its policy state, adapter,
 * capabilities, token health, last entity sync, last insights pull and whether
 * mutate is blocked. Below it, each channel that policy does not prohibit has
 * the nine checklist items from plan section 6, each with a checkbox and an
 * evidence field, saved one item at a time through a fetcher. Prohibited
 * channels show their policy note and no checklist, so there is nothing to
 * enable on them.
 *
 * Reads come from Neon only (loadChannels). Checklist writes happen only in
 * this route's action, behind an admin session. A team-token request has no
 * session cookie and gets the login redirect.
 */
import { useState } from 'react'
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { data, isRouteErrorResponse, useFetcher, useLoaderData, useRevalidator, useRouteError } from 'react-router'
import { getAdminUser, requireAdmin } from '~/lib/session.server'
import { ChecklistInputError, loadChannels, toggleChecklistItem } from '~/lib/ads/channels-page.server'
import {
  PROHIBITED_REASON, capabilitiesWords,
  type ChannelPageRow, type ChecklistItemState,
} from '~/lib/ads/channels-core'
import { ageWords } from '~/lib/ads/console-core'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'
import { ErrorSlab } from '~/components/admin/ads/StateSlabs'

export const meta: MetaFunction = () => [{ title: 'Channels - Ads - xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const page = await loadChannels()
  return { page, now: new Date().toISOString() }
}

export type ChannelsActionData =
  | { ok: true; channel: string; item: string; checked: boolean }
  | { ok: false; channel?: string; item?: string; error: string }

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const user = await getAdminUser(request)
  if (!user) throw new Response('Unauthorized', { status: 401 })

  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  const channel = String(form.get('channel') ?? '')
  const item = String(form.get('item') ?? '')
  if (intent !== 'toggle-check') {
    return data<ChannelsActionData>({ ok: false, channel, item, error: `Unknown intent: ${intent || '(none)'}` }, { status: 400 })
  }
  const checked = form.get('checked') === 'on' || form.get('checked') === 'true'
  const evidence = String(form.get('evidence') ?? '')
  const by = `admin:${user.email || user.id}`

  try {
    await toggleChecklistItem(channel, item, checked, by, evidence)
    return data<ChannelsActionData>({ ok: true, channel, item, checked })
  } catch (err) {
    if (err instanceof ChecklistInputError) {
      return data<ChannelsActionData>({ ok: false, channel, item, error: err.message }, { status: 400 })
    }
    console.error('[admin.ads.channels] checklist write failed', err)
    return data<ChannelsActionData>({ ok: false, channel, item, error: 'Could not save. Try again.' }, { status: 500 })
  }
}

function since(iso: string | null, nowIso: string): string {
  if (!iso) return 'never'
  return `${ageWords(Math.max(0, Date.parse(nowIso) - Date.parse(iso)))} ago`
}

const POLICY_CHIP: Record<ChannelPageRow['policyState'], string> = {
  allowed: 'border-sage/30 bg-paper-2 text-sage',
  restricted: 'border-amber-300 bg-amber-50 text-amber-800',
  prohibited: 'border-red-300 bg-red-50 text-red-800',
}

const TOKEN_TONE: Record<string, string> = {
  ok: 'text-sage',
  expiring: 'text-amber-800',
  invalid: 'text-red-800',
  unknown: 'text-ink-3',
}

function tokenCell(row: ChannelPageRow, now: string, failed: boolean) {
  if (failed) return <span className="text-ink-3">unknown</span>
  if (!row.hasAdapter) return <span className="text-ink-4">n/a</span>
  if (!row.token) return <span className="text-ink-3">not checked yet</span>
  const t = row.token
  // A good token on an account the platform will not serve yet reads as
  // pending, never green. A bad token still wins: that one is the owner's.
  const pending = t.pending && t.state === 'ok' ? t.pending : null
  return (
    <span>
      {pending ? (
        <>
          <span className="font-medium text-amber-800">{pending}</span>
          <span className="block text-[11px] text-ink-3">token ok</span>
        </>
      ) : (
        <span className={`font-medium ${TOKEN_TONE[t.state] ?? 'text-ink'}`}>{t.state}</span>
      )}
      <span className="block text-[11px] text-ink-3">checked {since(t.checkedAt, now)}</span>
      {t.expiresAt && <span className="block text-[11px] text-ink-3">expires {t.expiresAt.slice(0, 10)}</span>}
    </span>
  )
}

function freshnessCell(iso: string | null, now: string, failed: boolean, hasAdapter: boolean) {
  if (failed) return <span className="text-ink-3">unknown</span>
  if (!hasAdapter && !iso) return <span className="text-ink-4">n/a</span>
  return <span>{since(iso, now)}</span>
}

function MutateCell({ row }: { row: ChannelPageRow }) {
  if (!row.mutate.mutateBlocked) return <span className="font-medium text-sage">Open</span>
  return (
    <span>
      <span className="font-medium text-red-800">Blocked</span>
      <span className="block text-[11px] text-ink-3">{row.mutate.reasons.join('; ')}</span>
    </span>
  )
}

function ChecklistItemForm({ channel, item }: { channel: string; item: ChecklistItemState }) {
  const fetcher = useFetcher<ChannelsActionData>()
  const [checked, setChecked] = useState(item.checked)
  const [evidence, setEvidence] = useState(item.evidence ?? '')
  const pending = fetcher.state !== 'idle'
  const result = fetcher.data
  const error = !pending && result && !result.ok ? result.error : null
  const saved = !pending && result?.ok === true
  const dirty = checked !== item.checked || evidence.trim() !== (item.evidence ?? '').trim()
  const inputId = `ev-${channel}-${item.key}`.replace(/[^a-zA-Z0-9_-]/g, '-')

  return (
    <li className="border-b border-line py-3 last:border-b-0">
      <fetcher.Form method="post" className="flex flex-col gap-2" aria-busy={pending}>
        <input type="hidden" name="intent" value="toggle-check" />
        <input type="hidden" name="channel" value={channel} />
        <input type="hidden" name="item" value={item.key} />
        <label className="flex min-h-11 items-start gap-3 touch-manipulation">
          <input
            type="checkbox"
            name="checked"
            checked={checked}
            disabled={pending}
            onChange={e => setChecked(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-coral"
          />
          <span className="min-w-0 text-sm text-ink">{item.label}</span>
        </label>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:pl-8">
          <label htmlFor={inputId} className="sr-only">Evidence for: {item.label}</label>
          <input
            id={inputId}
            name="evidence"
            type="text"
            autoComplete="off"
            maxLength={1000}
            value={evidence}
            readOnly={pending}
            placeholder={item.evidenceHint}
            onChange={e => setEvidence(e.target.value)}
            aria-invalid={!!error}
            className="min-h-11 w-full min-w-0 rounded-xl border border-line bg-paper px-3 text-base text-ink placeholder:text-ink-4 focus:border-ink focus:outline-none md:min-h-9 md:text-sm"
          />
          <button
            type="submit"
            disabled={pending || !dirty}
            className="min-h-11 shrink-0 rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-50 touch-manipulation md:min-h-9"
          >
            {pending ? 'Saving' : 'Save'}
          </button>
        </div>
        <div className="md:pl-8" aria-live="polite">
          {error && <p className="text-xs text-red-800">{error}</p>}
          {saved && !dirty && <p className="text-xs text-sage">Saved.</p>}
          {!error && !saved && item.checkedBy && (
            <p className="text-[11px] text-ink-3">
              {item.checked ? `Checked ${item.checkedAt?.slice(0, 10)} by ${item.checkedBy}` : `Unchecked by ${item.checkedBy}`}
            </p>
          )}
        </div>
      </fetcher.Form>
    </li>
  )
}

function ChannelChecklist({ row }: { row: ChannelPageRow }) {
  if (!row.checklist) return null
  const { checkedCount, totalCount } = row.mutate
  return (
    <details className="group rounded-2xl border border-line bg-paper">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 touch-manipulation">
        <span className="text-sm font-medium text-ink">{row.label}</span>
        <span className="font-mono text-[11px] uppercase tracking-wide text-ink-3">
          {checkedCount} of {totalCount} checked
          <span aria-hidden="true" className="ml-2 inline-block transition-transform group-open:rotate-90">›</span>
        </span>
      </summary>
      <ul className="border-t border-line px-4">
        {row.checklist.map(item => <ChecklistItemForm key={item.key} channel={row.id} item={item} />)}
      </ul>
    </details>
  )
}

export default function AdsChannels() {
  const { page, now } = useLoaderData<typeof loader>()
  const failed = new Set(page.failed)
  const enableable = page.channels.filter(c => c.checklist !== null)
  const prohibited = page.channels.filter(c => c.checklist === null)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-xl md:text-2xl text-ink">Channels</h1>
        <p className="font-mono text-[11px] text-ink-3">Policy states mirror docs/ads-policy.md.</p>
      </header>

      {page.failed.length > 0 && (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Some reads failed ({page.failed.join(', ')}). Columns that depend on them say unknown.
        </p>
      )}

      <section aria-label="Channels" className="space-y-2">
        <ResponsiveTable>
          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line font-mono text-[11px] uppercase tracking-wide text-ink-3">
                <th scope="col" className="py-2 pr-3 font-normal">Channel</th>
                <th scope="col" className="py-2 pr-3 font-normal">Policy</th>
                <th scope="col" className="py-2 pr-3 font-normal">Adapter</th>
                <th scope="col" className="py-2 pr-3 font-normal">Capabilities</th>
                <th scope="col" className="py-2 pr-3 font-normal">Token</th>
                <th scope="col" className="py-2 pr-3 font-normal">Last sync</th>
                <th scope="col" className="py-2 pr-3 font-normal">Last pull</th>
                <th scope="col" className="py-2 font-normal">Mutate</th>
              </tr>
            </thead>
            <tbody>
              {page.channels.map(row => (
                <tr key={row.id} className="border-b border-line align-top last:border-b-0">
                  <td className="max-w-[260px] py-3 pr-3">
                    <span className="font-medium text-ink">{row.label}</span>
                    <span className="block text-[11px] leading-snug text-ink-3">{row.policyNote}</span>
                  </td>
                  <td className="py-3 pr-3">
                    <span className={`inline-block rounded-full border px-2 font-mono text-[10px] uppercase tracking-wide ${POLICY_CHIP[row.policyState]}`}>
                      {row.policyState}
                    </span>
                  </td>
                  <td className="py-3 pr-3">{row.hasAdapter ? 'Yes' : 'No'}</td>
                  <td className="max-w-[200px] py-3 pr-3 text-xs text-ink-2">{capabilitiesWords(row.capabilities)}</td>
                  <td className="py-3 pr-3">{tokenCell(row, now, failed.has('token health'))}</td>
                  <td className="py-3 pr-3">{freshnessCell(row.lastEntitySyncAt, now, failed.has('entity sync'), row.hasAdapter)}</td>
                  <td className="py-3 pr-3">{freshnessCell(row.lastInsightsPullAt, now, failed.has('insights pull'), row.hasAdapter)}</td>
                  <td className="max-w-[200px] py-3"><MutateCell row={row} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTable>
      </section>

      <section aria-label="Enablement checklist" className="space-y-2">
        <p className="kicker">Enablement checklist</p>
        <p className="text-sm text-ink-2">
          Check an item once you have proof, and write the proof in its evidence field. Mutate for a channel opens only when all nine items are checked.
        </p>
        {failed.has('checklist') && (
          <p className="text-sm text-amber-800">The checklist read failed, so every item shows as open.</p>
        )}
        <div className="space-y-2">
          {enableable.map(row => <ChannelChecklist key={row.id} row={row} />)}
        </div>
      </section>

      {prohibited.length > 0 && (
        <section aria-label="Prohibited channels" className="space-y-2">
          <p className="kicker">Prohibited</p>
          <ul className="rounded-2xl border border-line bg-paper px-4">
            {prohibited.map(row => (
              <li key={row.id} className="border-b border-line py-3 last:border-b-0">
                <p className="text-sm font-medium text-ink">{row.label}</p>
                <p className="font-mono text-[11px] uppercase tracking-wide text-red-800">{PROHIBITED_REASON}</p>
                <p className="mt-1 text-xs text-ink-3">{row.policyNote}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export function ErrorBoundary() {
  const error = useRouteError()
  const revalidator = useRevalidator()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl md:text-2xl text-ink">Channels</h1>
      <ErrorSlab
        title="Couldn't load the channels."
        message={message}
        onRetry={() => revalidator.revalidate()}
        retrying={revalidator.state === 'loading'}
      />
    </div>
  )
}
