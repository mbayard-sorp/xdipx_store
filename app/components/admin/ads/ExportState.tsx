/**
 * Export row (wires 5.4): a label, a state pill and at most one action. In this
 * PR the states are none, not built, building, failed, and ready (Download of
 * the stored PNG). A platform push control never renders while
 * ads_spend_enabled is off, and no lane can push yet, so none is rendered here
 * at all: the prop exists so PR-E wires it without changing the contract.
 */
import { useFetcher } from 'react-router'
import { ExternalIcon, RefreshIcon } from '~/components/admin/social/icons'
import type { ExportStateView } from '~/lib/ad-creative-types'

export function ExportState({
  state,
  creativeId,
  action,
  filename,
  spendEnabled = false,
}: {
  state: ExportStateView
  creativeId: number
  /** Admin route that handles intent=render-creative for the retry. */
  action: string
  filename: string
  /** Platform push stays hidden while this is false. No exporter can push in PR-C. */
  spendEnabled?: boolean
}) {
  void spendEnabled
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>()
  const retrying = fetcher.state !== 'idle'
  const pill = 'inline-flex items-center h-6 px-2 rounded-full border text-[11px] font-semibold leading-none whitespace-nowrap'

  let body: React.ReactNode
  switch (state.kind) {
    case 'none':
      body = <span className={`${pill} border-line text-ink-4`}>No exporter for this lane yet</span>
      break
    case 'not-built':
      body = <span className={`${pill} border-line text-ink-3`}>Not built</span>
      break
    case 'building':
      body = <span className={`${pill} border-plum/30 bg-plum-soft text-plum-2 animate-pulse motion-reduce:animate-none`}>Building</span>
      break
    case 'ready':
      body = (
        <>
          <span className={`${pill} border-[#BFCDBB] text-[#4F6150]`}>Ready, not uploaded</span>
          {state.downloadUrl && (
            <a
              href={`${state.downloadUrl}?download=1`}
              download={filename}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1 px-2 text-sm font-medium text-ink underline-offset-2 hover:underline"
            >
              Download <ExternalIcon size={12} />
            </a>
          )}
        </>
      )
      break
    case 'failed':
      body = (
        <>
          <span className={`${pill} border-red-300 text-red-800`}>{retrying ? 'Retrying' : 'Render failed'}</span>
          <button
            type="button"
            disabled={retrying}
            onClick={() => fetcher.submit({ intent: 'render-creative', creativeId: String(creativeId) }, { method: 'post', action })}
            className="inline-flex min-h-11 items-center gap-1 px-2 text-sm font-medium text-ink underline-offset-2 hover:underline disabled:opacity-60 touch-manipulation"
          >
            <RefreshIcon size={12} /> Retry
          </button>
        </>
      )
      break
  }

  return (
    <div aria-busy={state.kind === 'building' || retrying}>
      <div className="min-h-11 flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-3">Export</span>
        {body}
      </div>
      {state.kind === 'failed' && state.message && <p className="text-xs text-red-800 break-words">{state.message}</p>}
      {fetcher.data && fetcher.data.ok === false && fetcher.data.error && (
        <p role="alert" className="text-xs text-red-800">{fetcher.data.error}</p>
      )}
    </div>
  )
}
