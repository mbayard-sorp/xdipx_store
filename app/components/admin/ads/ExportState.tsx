/**
 * Export row (wires 5.4): a label, a state pill and the actions that state allows.
 *
 *   none          lane has no exporter
 *   not built     Build (only once the creative is hearted and finished)
 *   building      pulse, no action
 *   ready         Download (Search CSV, banner zip) or View payload (Meta paused draft)
 *   failed        Retry (re-runs the render or the export build, whichever failed)
 *   in-platform   "In Meta, paused" and Open in Ads Manager
 *
 * Hard rule from plan section 5: a platform push control never renders while
 * ads_spend_enabled is off, and never for a lane whose exporter cannot push.
 * With the valve on, a Meta creative with a ready payload gets one extra button,
 * "Create paused draft in Meta", with pending, success and error states and the
 * resulting external id.
 */
import { useEffect, useState } from 'react'
import { useFetcher } from 'react-router'
import { ExternalIcon, RefreshIcon } from '~/components/admin/social/icons'
import type { ExportStateView } from '~/lib/ad-creative-types'
import { PayloadSheet } from './PayloadSheet'

interface ActionData {
  ok?: boolean
  error?: string
  errorCode?: string
  summary?: string[]
  externalAdId?: string
  preview?: string[]
  warnings?: string[]
  payload?: unknown
}

const btn = 'inline-flex min-h-11 items-center gap-1 px-2 text-sm font-medium text-ink underline-offset-2 hover:underline disabled:opacity-60 touch-manipulation'
const pillBase = 'inline-flex items-center h-6 px-2 rounded-full border text-[11px] font-semibold leading-none whitespace-nowrap'

export function ExportState({
  state,
  creativeId,
  action,
  filename,
  spendEnabled = false,
}: {
  state: ExportStateView
  creativeId: number
  /** Admin route that handles build-export, view-payload, push-meta-draft and render-creative. */
  action: string
  filename: string
  /** The platform push control renders only while this is true. */
  spendEnabled?: boolean
}) {
  const fetcher = useFetcher<ActionData>()
  const payloadFetcher = useFetcher<ActionData>()
  const pushFetcher = useFetcher<ActionData>()
  const [sheet, setSheet] = useState(false)
  const busy = fetcher.state !== 'idle'
  const pushing = pushFetcher.state !== 'idle'

  useEffect(() => {
    if (payloadFetcher.state === 'idle' && payloadFetcher.data?.payload) setSheet(true)
  }, [payloadFetcher.state, payloadFetcher.data])

  const submit = (intent: string) => fetcher.submit({ intent, creativeId: String(creativeId) }, { method: 'post', action })
  const isMeta = state.exporter === 'meta-paused-draft'

  let body: React.ReactNode
  switch (state.kind) {
    case 'none':
      body = <span className={`${pillBase} border-line text-ink-4`}>No exporter for this lane yet</span>
      break
    case 'not-built':
      body = (
        <>
          <span className={`${pillBase} border-line text-ink-3`}>{busy ? 'Building' : 'Not built'}</span>
          {state.canBuild && (
            <button type="button" disabled={busy} onClick={() => submit('build-export')} className={btn}>
              {busy ? 'Building' : 'Build'}
            </button>
          )}
        </>
      )
      break
    case 'building':
      body = <span className={`${pillBase} border-plum/30 bg-plum-soft text-plum-2 animate-pulse motion-reduce:animate-none`}>Building</span>
      break
    case 'ready':
      body = (
        <>
          <span className={`${pillBase} border-[#BFCDBB] text-[#4F6150]`}>
            {isMeta ? 'Paused draft ready, not uploaded' : 'Ready, not uploaded'}
          </span>
          {state.downloadUrl && (
            <a
              href={`${state.downloadUrl}?download=1`}
              download={state.filename ?? filename}
              target="_blank"
              rel="noreferrer"
              className={btn}
            >
              Download <ExternalIcon size={12} />
            </a>
          )}
          {state.hasPayload && (
            <button
              type="button"
              disabled={payloadFetcher.state !== 'idle'}
              onClick={() => payloadFetcher.submit({ intent: 'view-payload', creativeId: String(creativeId) }, { method: 'post', action })}
              className={btn}
            >
              {payloadFetcher.state !== 'idle' ? 'Loading' : 'View payload'}
            </button>
          )}
          {spendEnabled && isMeta && state.hasPayload && (
            <button
              type="button"
              disabled={pushing}
              onClick={() => pushFetcher.submit({ intent: 'push-meta-draft', creativeId: String(creativeId) }, { method: 'post', action })}
              className="inline-flex min-h-11 items-center rounded-full border border-line bg-paper px-3 text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-60 touch-manipulation"
            >
              {pushing ? 'Creating draft' : 'Create paused draft in Meta'}
            </button>
          )}
        </>
      )
      break
    case 'failed':
      body = (
        <>
          <span className={`${pillBase} border-red-300 text-red-800`}>
            {busy ? 'Retrying' : state.retry === 'export' ? 'Export failed' : 'Render failed'}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => submit(state.retry === 'export' ? 'build-export' : 'render-creative')}
            className={`${btn} touch-manipulation`}
          >
            <RefreshIcon size={12} /> Retry
          </button>
        </>
      )
      break
    case 'in-platform':
      body = (
        <>
          <span className={`${pillBase} border-ink-4 text-ink-2`}>{isMeta ? 'In Meta, paused' : 'In platform, paused'}</span>
          {state.externalUrl && (
            <a href={state.externalUrl} target="_blank" rel="noreferrer" className={btn}>
              Open in Ads Manager <ExternalIcon size={12} />
            </a>
          )}
        </>
      )
      break
  }

  const pushed = pushFetcher.data
  const built = fetcher.data

  return (
    <div aria-busy={state.kind === 'building' || busy || pushing}>
      <div className="min-h-11 flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-3">Export</span>
        {body}
      </div>
      {state.kind === 'failed' && state.message && <p className="break-words text-xs text-red-800">{state.message}</p>}
      {state.kind === 'in-platform' && state.externalId && (
        <p className="font-mono text-[11px] text-ink-3 break-all">Meta ad {state.externalId}. Flip it live in Ads Manager when you are ready.</p>
      )}
      {built && built.ok === false && built.error && state.kind !== 'failed' && <p role="alert" className="break-words text-xs text-red-800">{built.error}</p>}
      {built && built.ok === true && built.summary && !busy && (
        <p role="status" className="break-words text-xs text-ink-3">{built.summary[0]}</p>
      )}
      {payloadFetcher.data && payloadFetcher.data.ok === false && payloadFetcher.data.error && (
        <p role="alert" className="text-xs text-red-800">{payloadFetcher.data.error}</p>
      )}
      {pushed && pushed.ok === false && pushed.error && (
        <p role="alert" className="break-words text-xs text-red-800">
          {pushed.errorCode ? `${pushed.errorCode}: ` : ''}{pushed.error}
        </p>
      )}
      {pushed && pushed.ok === true && !pushing && (
        <p role="status" className="font-mono text-[11px] text-ink-3 break-all">Created paused draft in Meta, ad {pushed.externalAdId}.</p>
      )}
      {sheet && payloadFetcher.data?.payload !== undefined && (
        <PayloadSheet
          title={`Meta paused draft, creative #${creativeId}`}
          preview={payloadFetcher.data.preview ?? []}
          warnings={payloadFetcher.data.warnings ?? []}
          payload={payloadFetcher.data.payload}
          onClose={() => setSheet(false)}
        />
      )}
    </div>
  )
}
