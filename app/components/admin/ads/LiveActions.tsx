/**
 * Pause or Resume, Scale (or Brake), Refresh (wires 8.1, 10.4, 10.5).
 *
 * In this PR an action only records a decision: one ad_rule_events row with the
 * action and applied_by, no platform call (PR-H wires the real calls behind the
 * same verbs). Every tap shows its pending verb with the other two buttons
 * disabled, flips the row pill optimistically, reverts on error with the error
 * line under the buttons, and on success raises the Undo toast for 6 seconds.
 */
import { useEffect, useRef } from 'react'
import { useFetcher } from 'react-router'
import { useAdsToast } from './AdsToast'
import type { LiveActionKind } from '~/lib/ad-metrics-core'
import { RECOMMENDATION_LABEL, type LiveRow, type Recommendation } from '~/lib/ad-metrics-core'

export const LIVE_ACTION_PATH = '/admin/ad-studio/live'

type ActionData =
  | { ok: true; intent: 'live-action'; eventId: number; message: string; kind: LiveActionKind }
  | { ok: true; intent: 'live-undo'; message: string }
  | { ok: false; intent?: string; error: string }

const PENDING_VERB: Record<LiveActionKind, string> = {
  pause: 'Pausing', resume: 'Resuming', scale: 'Scaling', brake: 'Braking', refresh: 'Queuing',
}

/** The recommendation a tap leaves behind, for the optimistic pill. */
function optimisticRecommendation(kind: LiveActionKind): Recommendation {
  return kind === 'pause' ? 'paused' : 'healthy'
}

export function useLiveRowActions(row: LiveRow) {
  const fetcher = useFetcher<ActionData>()
  const toast = useAdsToast()
  const lastShown = useRef<unknown>(null)
  const data = fetcher.data

  useEffect(() => {
    if (fetcher.state !== 'idle' || !data || lastShown.current === data) return
    lastShown.current = data
    if (data.ok && data.intent === 'live-action') {
      toast.show({
        message: data.message,
        actionLabel: 'Undo',
        onAction: () => fetcher.submit({ intent: 'live-undo', eventId: String(data.eventId) }, { method: 'post', action: LIVE_ACTION_PATH }),
      })
    } else if (data.ok && data.intent === 'live-undo') {
      toast.show({ message: data.message })
    }
  }, [data, fetcher, toast])

  const pendingKind = fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'live-action'
    ? (String(fetcher.formData.get('kind')) as LiveActionKind)
    : null
  const pendingUndo = fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'live-undo'
  const busy = fetcher.state !== 'idle'
  const error = data && !data.ok && fetcher.state === 'idle' ? data.error : null

  function submit(kind: LiveActionKind) {
    const fd: Record<string, string> = { intent: 'live-action', key: row.key, kind }
    if (row.firing) {
      fd['ruleId'] = row.firing.ruleId
      if (row.firing.eventId != null) fd['resolvesEventId'] = String(row.firing.eventId)
    }
    fetcher.submit(fd, { method: 'post', action: LIVE_ACTION_PATH })
  }

  return {
    busy,
    pendingKind,
    pendingUndo,
    error,
    /** What the pill should read right now, including the optimistic state of an in-flight tap. */
    displayed: pendingKind ? optimisticRecommendation(pendingKind) : row.recommendation,
    submit,
  }
}

export type LiveRowActions = ReturnType<typeof useLiveRowActions>

const base = 'min-h-11 px-3 rounded-full text-sm font-medium touch-manipulation whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed'
const primary = `${base} bg-ink text-white`
const secondary = `${base} border border-line bg-paper text-ink hover:border-ink-4`

export function LiveActions({ row, act, className = '' }: { row: LiveRow; act: LiveRowActions; className?: string }) {
  const rec = row.recommendation
  const ruleTag = row.firing ? ` · ${row.firing.ruleId}` : ''
  const showResume = row.paused || rec === 'revive'
  const scaleKind: LiveActionKind = rec === 'brake' ? 'brake' : 'scale'
  const scaleLabel = scaleKind === 'brake' ? 'Brake -30%' : 'Scale +20%'
  const disabledWhilePaused = row.paused ? 'Resume it first' : undefined

  const stopKind: LiveActionKind = showResume ? 'resume' : 'pause'
  const stopRecommended = rec === 'pause' || rec === 'paused' || rec === 'revive'
  const scaleRecommended = rec === 'scale' || rec === 'brake'
  const refreshRecommended = rec === 'refresh'

  const label = (kind: LiveActionKind, text: string, recommended: boolean) =>
    act.pendingKind === kind ? PENDING_VERB[kind] : recommended ? `${text}${ruleTag}` : text

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2" aria-busy={act.busy}>
        <button
          type="button"
          disabled={act.busy}
          onClick={() => act.submit(stopKind)}
          className={stopRecommended ? primary : secondary}
        >
          {label(stopKind, showResume ? 'Resume' : 'Pause', stopRecommended)}
        </button>
        <button
          type="button"
          disabled={act.busy || row.paused}
          title={disabledWhilePaused}
          onClick={() => act.submit(scaleKind)}
          className={scaleRecommended ? primary : secondary}
        >
          {label(scaleKind, scaleLabel, scaleRecommended)}
        </button>
        <button
          type="button"
          disabled={act.busy || row.paused}
          title={disabledWhilePaused}
          onClick={() => act.submit('refresh')}
          className={refreshRecommended ? primary : secondary}
        >
          {label('refresh', 'Refresh', refreshRecommended)}
        </button>
      </div>
      {act.error && <p role="alert" className="mt-2 text-sm text-red-700">{act.error}</p>}
      <span className="sr-only">{RECOMMENDATION_LABEL[act.displayed]}</span>
    </div>
  )
}
