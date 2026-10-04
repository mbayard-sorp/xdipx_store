/**
 * Admin-only "Render now" on a hearted idea (Ad Studio v2 PR-C). Posts
 * intent=render-now, which enqueues the idea and renders its creatives now,
 * so the owner can test without waiting for the routine's next pass. It
 * respects the ads daily budget and shows the skipped reason. Pending,
 * success and error states are all visible.
 */
import { Link, useFetcher } from 'react-router'
import { RefreshIcon } from '~/components/admin/social/icons'

export interface RenderNowResult {
  ok: boolean
  error?: string
  ideaId?: number
  rendered?: number
  blocked?: number
  failed?: number
  deferred?: number
  skipped?: string[]
}

export function RenderNowButton({ ideaId, action }: { ideaId: number; action: string }) {
  const fetcher = useFetcher<RenderNowResult>()
  const pending = fetcher.state !== 'idle'
  const r = fetcher.data
  return (
    <div className="mt-2 lg:text-right" aria-busy={pending}>
      <button
        type="button"
        disabled={pending}
        onClick={() => fetcher.submit({ intent: 'render-now', ideaId: String(ideaId) }, { method: 'post', action })}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-60 touch-manipulation"
      >
        <RefreshIcon size={14} className={pending ? 'animate-spin motion-reduce:animate-none' : ''} />
        {pending ? 'Rendering' : 'Render now'}
      </button>
      {pending && <p className="mt-1 text-xs text-ink-3">This can take a minute or two.</p>}
      {r?.ok === false && (
        <p role="alert" className="mt-1 break-words text-xs text-red-800">{r.error ?? 'The render did not run.'}</p>
      )}
      {r?.ok === true && !pending && (
        <p role="status" className="mt-1 text-xs text-ink-3">
          {r.rendered ?? 0} rendered{r.blocked ? `, ${r.blocked} blocked` : ''}{r.failed ? `, ${r.failed} failed` : ''}{r.deferred ? `, ${r.deferred} still queued` : ''}.
          {r.skipped && r.skipped.length > 0 && <span className="block text-amber-800">Skipped: {r.skipped.join('; ')}</span>}
          {' '}
          <Link to={`/admin/ad-studio/creatives?idea=${ideaId}&view=all`} className="font-medium text-ink underline-offset-2 hover:underline">See creatives</Link>
        </p>
      )}
    </div>
  )
}
