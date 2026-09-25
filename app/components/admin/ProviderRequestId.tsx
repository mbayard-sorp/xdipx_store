/**
 * Provider trace chip for Video Studio (ticket #11552): provider, model and
 * the Atlas/fal/Wavespeed request id, with a copy control so the owner can
 * paste an id back into the board search or a ticket.
 */
import { useState } from 'react'

export function ProviderRequestId({
  provider,
  model,
  requestId,
  label,
}: {
  provider?: string | null
  model?: string | null
  requestId: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(requestId).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1 text-[11px] text-ink-3">
      {label ? <span className="font-semibold text-ink-2">{label}</span> : null}
      {provider ? <span>{provider}</span> : null}
      {model ? <span className="text-ink-4">{model}</span> : null}
      <code className="break-all font-mono text-ink" title={requestId}>{requestId}</code>
      <button
        type="button"
        onClick={copy}
        className="rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold text-ink-2 hover:border-coral"
        aria-label={`Copy request id ${requestId}`}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  )
}
