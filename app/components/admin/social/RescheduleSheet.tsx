/**
 * Reschedule sheet (Social Studio v2 Phase 4, #4939): the keyboard and touch
 * equivalent of a drag. Date plus LA wall-clock time, the PDT/PST label that
 * applies at that instant, and "Next open slot" which picks the first cell
 * under cap from now. Esc closes. The sheet never submits on its own; the
 * page owns the fetcher so drag and sheet go through one writer.
 */
import { useState } from 'react'
import { useStudioShortcuts } from './use-shortcuts'
import { CloseIcon, ClockIcon } from './icons'
import { PLATFORM_LABELS } from './types'
import type { CalendarPost } from './calendar-types'
import { laWallClockToUtcIso, laZoneAbbrev, formatLaWallClock } from '~/lib/social-schedule-ui'
import { utcToLaParts } from '~/lib/social-schedule'
import { nextOpenSlot, slotOf } from '~/lib/social-calendar'

export interface RescheduleSheetProps {
  post: CalendarPost
  /** Every row the calendar knows about, for the open-slot search. */
  posts: CalendarPost[]
  caps: Record<string, number>
  /** "Now" in ms, from the loader so SSR and client agree. */
  nowMs: number
  busy?: boolean
  onClose: () => void
  onSubmit: (date: string, time: string) => void
  onUnschedule: () => void
}

export function RescheduleSheet({ post, posts, caps, nowMs, busy = false, onClose, onSubmit, onUnschedule }: RescheduleSheetProps) {
  const current = slotOf(post)
  const initial = current ? utcToLaParts(current) : { date: utcToLaParts(new Date(nowMs)).date, time: '09:00' }
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)

  useStudioShortcuts({ escape: onClose })

  const iso = laWallClockToUtcIso(date, time)
  const zone = iso ? laZoneAbbrev(new Date(iso)) : laZoneAbbrev(new Date(nowMs))
  const human = iso ? formatLaWallClock(iso) : null
  const inPast = iso ? new Date(iso).getTime() < nowMs : false
  const isPublished = post.status === 'posted'
  const cap = caps[post.platform]

  function pickNextOpen() {
    const slot = nextOpenSlot({ posts, caps, from: new Date(nowMs), platform: post.platform, excludeId: post.id })
    if (!slot) return
    setDate(slot.date)
    setTime(slot.time)
  }

  return (
    <div
      className="fixed inset-0 z-[100] bg-ink/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reschedule-title"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <form
        className="w-full md:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl md:rounded-2xl bg-paper border border-line"
        onSubmit={e => {
          e.preventDefault()
          if (!iso || isPublished) return
          onSubmit(date, time)
        }}
      >
        <div className="sticky top-0 bg-paper border-b border-line px-4 py-3 flex items-center justify-between">
          <h2 id="reschedule-title" className="font-display text-lg text-ink">
            Reschedule #{post.id}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-lg text-ink-3 hover:bg-paper-2">
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-ink-3">
            {PLATFORM_LABELS[post.platform] ?? post.platform}
            {current ? <> · now <span className="font-mono text-ink">{formatLaWallClock(current)}</span></> : ' · no slot yet'}
            {cap != null && <> · cap <span className="font-mono text-ink">{cap}/day</span></>}
          </p>

          {isPublished ? (
            <p className="text-sm text-ink-3 rounded-xl border border-line bg-paper-2 p-3">
              This post is already live, so its slot is history, not a plan. Nothing to move.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <label className="flex-1 text-xs text-ink-3">
                  Date (Los Angeles)
                  <input
                    type="date"
                    required
                    autoFocus
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="mt-1 block w-full min-h-11 rounded-lg border border-line bg-paper px-3 font-mono text-sm text-ink"
                  />
                </label>
                <label className="flex-1 text-xs text-ink-3">
                  Time <span className="font-mono text-ink">{zone}</span>
                  <input
                    type="time"
                    required
                    step={300}
                    value={time}
                    onChange={e => setTime(e.target.value)}
                    className="mt-1 block w-full min-h-11 rounded-lg border border-line bg-paper px-3 font-mono text-sm text-ink"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={pickNextOpen}
                className="inline-flex items-center gap-2 min-h-11 px-3 rounded-lg border border-line text-sm text-ink hover:bg-paper-2"
              >
                <ClockIcon size={14} /> Next open slot
              </button>

              <p className="font-mono text-[11px] text-ink-3" aria-live="polite">
                {human ? `Will go at ${human}` : 'Pick a valid date and time'}
                {inPast ? ' · in the past: the publisher treats it as due now' : ''}
              </p>
            </>
          )}
        </div>

        <div className="sticky bottom-0 bg-paper border-t border-line px-4 py-3 flex flex-wrap gap-2 justify-between">
          {!isPublished && current ? (
            <button
              type="button"
              onClick={onUnschedule}
              disabled={busy}
              className="min-h-11 px-3 rounded-lg border border-line text-sm text-ink-3 hover:text-ink disabled:opacity-50"
            >
              Unschedule
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="min-h-11 px-3 rounded-lg border border-line text-sm text-ink">
              Cancel
            </button>
            {!isPublished && (
              <button
                type="submit"
                disabled={busy || !iso}
                className="min-h-11 px-4 rounded-lg bg-plum text-white text-sm font-semibold hover:bg-plum-2 disabled:opacity-50"
              >
                {busy ? 'Saving' : 'Move it'}
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}
