/**
 * Named-check gate panel for the Composer inspector. "Run gate" posts to
 * /api/admin/social-gate, which runs the deterministic checks only; the PASS
 * is the social-publish-gate agent's to issue (see that route's header).
 */
import { useFetcher } from 'react-router'
import { panelRows, type StoredGateFinding } from '~/lib/social-gate-status'
import { GatePill } from './StatusPill'
import { AlertIcon, CheckIcon, CloseIcon, PauseIcon, RefreshIcon } from './icons'

interface GateResponse {
  ok?: boolean
  error?: string
  gateStatus?: string | null
  gateCheckedAt?: string
  findings?: StoredGateFinding[]
  needsAgentVerdict?: boolean
}

export function GateVerdictPanel({
  postId,
  productHandle,
  gateStatus,
  gateCheckedAt,
  gateFindings,
  dirty,
}: {
  postId: number | null
  productHandle: string | null
  gateStatus: string | null | undefined
  gateCheckedAt: string | Date | null | undefined
  gateFindings: StoredGateFinding[] | null | undefined
  /** Unsaved edits: a run would judge the saved row, not what is on screen. */
  dirty: boolean
}) {
  const fetcher = useFetcher<GateResponse>()
  const latest = fetcher.data?.ok ? fetcher.data : null
  const status = latest ? latest.gateStatus ?? null : gateStatus ?? null
  const checkedAt = latest?.gateCheckedAt ?? gateCheckedAt ?? null
  const findings = latest?.findings ?? gateFindings ?? null
  const rows = panelRows(findings)
  const running = fetcher.state !== 'idle'
  const clean = status === null && !!checkedAt

  function run() {
    if (!postId) return
    fetcher.submit(
      { postId, ...(productHandle ? { productHandle } : {}) },
      { method: 'post', action: '/api/admin/social-gate', encType: 'application/json' },
    )
  }

  return (
    <section aria-label="Publish gate" className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Publish gate</h3>
          <GatePill status={status} />
        </div>
        <button
          type="button"
          onClick={run}
          disabled={!postId || running || dirty}
          title={!postId ? 'Save the draft first' : dirty ? 'Save your edits first; the gate judges the saved row' : undefined}
          className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-full border border-line bg-paper text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-50"
        >
          <RefreshIcon size={14} className={running ? 'animate-spin' : ''} />
          {running ? 'Checking' : 'Run gate'}
        </button>
      </div>

      {!postId && (
        <p className="text-xs text-ink-3">Save the draft to run the mechanical checks against it.</p>
      )}
      {dirty && postId && (
        <p className="text-xs text-amber-800">Unsaved edits. Save, then run the gate so it judges what you see.</p>
      )}
      {fetcher.data?.error && (
        <p className="text-xs text-red-700">{fetcher.data.error}</p>
      )}

      <ul className="rounded-xl border border-line divide-y divide-line bg-paper" role="list">
        {rows.map(r => {
          const Icon = r.verdict === 'pass' ? CheckIcon : r.verdict === 'block' ? CloseIcon : r.verdict === 'hold' ? PauseIcon : AlertIcon
          const tone = r.verdict === 'pass' ? 'text-[#4F6150]' : r.verdict === 'block' ? 'text-red-700' : r.verdict === 'hold' ? 'text-plum-2' : 'text-amber-800'
          return (
            <li key={r.check} className="px-3 py-2 flex items-start gap-2">
              <span className={`mt-0.5 shrink-0 ${checkedAt ? tone : 'text-ink-4'}`} aria-hidden="true">
                <Icon size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-ink">{r.label}</span>
                  <span className={`font-mono text-[11px] uppercase ${checkedAt ? tone : 'text-ink-4'}`}>
                    {checkedAt ? r.verdict : 'not run'}
                  </span>
                </div>
                {r.note && <p className="text-xs text-ink-3 mt-0.5">{r.note}</p>}
              </div>
            </li>
          )
        })}
      </ul>

      {clean && (
        <p className="text-xs text-ink-3">
          Mechanical checks passed on{' '}
          <span className="font-mono">{new Date(checkedAt as string).toISOString().slice(0, 16).replace('T', ' ')}Z</span>.
          The social-publish-gate agent issues the PASS on its next run; this screen never stamps one.
        </p>
      )}
      {status === 'pass' && (
        <p className="text-xs text-ink-3">
          Gate PASS on file from the agent. Editing and saving burns it and the gate looks again.
        </p>
      )}
      {(status === 'block' || status === 'revise' || status === 'hold') && (
        <p className="text-xs text-ink-3">
          {status === 'block' && 'A block has no override: fix the cause above (swap the image for a Library one, rewrite the line, change the product), save, and run again.'}
          {status === 'revise' && 'Fix the noted lines, save, and run again.'}
          {status === 'hold' && 'Held for you: the note above says what needs a human call.'}
        </p>
      )}
    </section>
  )
}
