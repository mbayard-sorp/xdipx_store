/**
 * The ads_audience_sync_enabled switch on /admin/ads/settings (ticket #16687).
 * Owner-only, like every valve on the page. On, the Sunday cron uploads hashed
 * customer and subscriber emails to the two M8 exclusion audiences on Meta;
 * off, it writes a dry_run row with the counts and sends nothing.
 */
import { useEffect, useRef } from 'react'
import { useFetcher } from 'react-router'
import { useAdsToast } from './AdsToast'

export interface AudienceSyncSwitchData {
  enabled: boolean
  last: { id: number; status: string; at: string; buyers: number | null; leads: number | null; error: string | null } | null
}

type ActionData = { ok: true; intent: string; message: string } | { ok: false; intent?: string; error: string }

const fmt = new Intl.NumberFormat('en-US')
const n = (v: number | null) => (v === null ? 'n/a' : fmt.format(v))

export function AudienceSyncSwitch({ data, isOwner, actionPath }: { data: AudienceSyncSwitchData; isOwner: boolean; actionPath: string }) {
  const fetcher = useFetcher<ActionData>()
  const toast = useAdsToast()
  const handled = useRef<unknown>(null)
  const pending = fetcher.state !== 'idle'
  const on = pending && fetcher.formData ? fetcher.formData.get('next') === 'true' : data.enabled
  const result = fetcher.data

  useEffect(() => {
    if (fetcher.state !== 'idle' || !result || handled.current === result) return
    handled.current = result
    if (result.ok) toast.show({ message: result.message })
  }, [fetcher.state, result, toast])

  const last = data.last
  return (
    <section aria-label="Exclusion audience sync" className="flex flex-col gap-3 rounded-xl border border-line bg-paper-2 p-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">
          Exclusion audience sync: <span className={on ? 'text-plum' : 'text-ink-3'}>{on ? 'on' : 'off'}</span>
        </p>
        <p className="mt-0.5 text-xs text-ink-3">
          Every Sunday, uploads hashed emails of buyers and subscribers who gave email consent to the two M8 exclusion audiences on Meta. Off, it only counts them.
        </p>
        {last ? (
          <p className="mt-1 text-xs text-ink-4 break-words">
            Last run #{last.id}, {last.status.replace('_', ' ')}, {last.at.slice(0, 16).replace('T', ' ')} UTC: buyers {n(last.buyers)}, leads {n(last.leads)}.
            {last.error ? ` ${last.error.slice(0, 160)}` : ''}
          </p>
        ) : (
          <p className="mt-1 text-xs text-ink-4">No run yet.</p>
        )}
        {result && !result.ok && !pending && <p role="alert" className="mt-1 text-xs text-red-700">{result.error}</p>}
      </div>
      {isOwner ? (
        <fetcher.Form method="post" action={actionPath} className="shrink-0">
          <input type="hidden" name="intent" value="toggle-audience-sync" />
          <input type="hidden" name="next" value={String(!data.enabled)} />
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-60 touch-manipulation"
          >
            {pending ? 'Saving' : data.enabled ? 'Turn off' : 'Turn on'}
          </button>
        </fetcher.Form>
      ) : (
        <span className="text-xs text-ink-3">Owner only</span>
      )}
    </section>
  )
}
