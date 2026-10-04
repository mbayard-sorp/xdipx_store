/**
 * Monthly media cap (wires 9.2). Owner-only edit; admins see the figures and the
 * line "Owner only". The monthly cap and the daily guard (the number R7 reads and
 * the burn bar shows) are both saved through the audited settings setter on the
 * server. Pending: Save reads "Saving" and the inputs go readOnly. Success: the
 * form closes and a toast confirms. Error: the form stays open with the message
 * under the inputs. Save cap is the page's one coral button.
 */
import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { useAdsToast } from './AdsToast'
import { formatMoney } from '~/lib/ad-metrics-core'
import type { MonthProjection } from '~/lib/ad-spend-core'

export interface CapControlData {
  month: MonthProjection
  monthlyCapCents: number
  dailyCapCents: number
}

type CapActionData = { ok: true; intent: 'save-caps'; message: string } | { ok: false; intent?: string; error: string }

function monthName(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
}

function plainDollars(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)
}

export function CapControl({ data, isOwner, actionPath }: { data: CapControlData; isOwner: boolean; actionPath: string }) {
  const fetcher = useFetcher<CapActionData>()
  const toast = useAdsToast()
  const [editing, setEditing] = useState(false)
  const [monthly, setMonthly] = useState(plainDollars(data.monthlyCapCents))
  const [daily, setDaily] = useState(plainDollars(data.dailyCapCents))
  const handled = useRef<unknown>(null)
  const pending = fetcher.state !== 'idle'
  const result = fetcher.data

  useEffect(() => {
    if (fetcher.state !== 'idle' || !result || handled.current === result) return
    handled.current = result
    if (result.ok) {
      setEditing(false)
      toast.show({ message: result.message })
    }
  }, [fetcher.state, result, toast])

  const { month } = data
  const pct = data.monthlyCapCents > 0 ? Math.round((month.spentCents / data.monthlyCapCents) * 100) : 0
  const typedCents = Math.round(Number(monthly.replace(/[$,\s]/g, '')) * 100)
  const belowSpend = editing && Number.isFinite(typedCents) && typedCents >= 0 && typedCents < month.spentCents
  const error = result && !result.ok && !pending ? result.error : null
  const lastDay = `${monthName(month.month).slice(0, 3)} ${month.daysInMonth}`

  function startEdit() {
    setMonthly(plainDollars(data.monthlyCapCents))
    setDaily(plainDollars(data.dailyCapCents))
    setEditing(true)
  }

  return (
    <section aria-label="Media cap" className="rounded-2xl border border-line bg-paper p-4 lg:p-5">
      <p className="kicker">Media cap, {monthName(month.month)}</p>

      {!editing ? (
        <>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="font-mono text-3xl font-semibold tabular-nums text-ink">{formatMoney(data.monthlyCapCents).replace(/\.00$/, '')}</p>
            {isOwner && (
              <button
                type="button"
                onClick={startEdit}
                className="min-h-11 rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4 touch-manipulation"
              >
                Edit
              </button>
            )}
          </div>
          <div
            className="mt-3 h-1 overflow-hidden rounded-full bg-paper-3"
            role="progressbar"
            aria-label="Month to date spend against the monthly cap"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div
              className={`h-full w-full origin-left transition-transform duration-[var(--duration-slow)] ease-[var(--ease-standard)] ${pct >= 100 ? 'bg-red-700' : pct >= 80 ? 'bg-amber-500' : 'bg-ink-2'}`}
              style={{ transform: `scaleX(${month.ratio})` }}
            />
          </div>
          <p className="mt-2 font-mono text-xs tabular-nums text-ink-2">
            {formatMoney(month.spentCents)} spent ({pct}%)
          </p>
          <p className="mt-0.5 font-mono text-xs tabular-nums text-ink-3">
            At this pace: {formatMoney(month.projectedCents)} by {lastDay}
          </p>
          <p className="mt-0.5 font-mono text-xs tabular-nums text-ink-3">
            Daily guard {formatMoney(data.dailyCapCents)} <span className="text-ink-4">(R7 pauses everything past it)</span>
          </p>
          {!isOwner && <p className="mt-3 text-sm text-ink-3">Owner only.</p>}
        </>
      ) : (
        <fetcher.Form method="post" action={actionPath} className="mt-2 space-y-3" aria-busy={pending}>
          <input type="hidden" name="intent" value="save-caps" />
          <label className="block">
            <span className="text-xs text-ink-3">Monthly cap</span>
            <span className="mt-1 flex items-center gap-2">
              <span className="font-mono text-ink-3" aria-hidden="true">$</span>
              <input
                name="monthly"
                inputMode="decimal"
                autoComplete="off"
                value={monthly}
                readOnly={pending}
                onChange={e => setMonthly(e.target.value)}
                aria-invalid={!!error}
                className="min-h-11 w-full rounded-xl border border-line bg-paper px-3 font-mono text-base tabular-nums text-ink focus:border-ink focus:outline-none"
              />
            </span>
          </label>
          <label className="block">
            <span className="text-xs text-ink-3">Daily guard</span>
            <span className="mt-1 flex items-center gap-2">
              <span className="font-mono text-ink-3" aria-hidden="true">$</span>
              <input
                name="daily"
                inputMode="decimal"
                autoComplete="off"
                value={daily}
                readOnly={pending}
                onChange={e => setDaily(e.target.value)}
                aria-invalid={!!error}
                className="min-h-11 w-full rounded-xl border border-line bg-paper px-3 font-mono text-base tabular-nums text-ink focus:border-ink focus:outline-none"
              />
            </span>
          </label>
          {belowSpend && (
            <p className="text-sm text-amber-800">
              Below this month&apos;s spend? R7 will pause everything at the next check.
            </p>
          )}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={pending}
              className="min-h-11 rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-60 touch-manipulation"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="min-h-11 rounded-full bg-coral px-4 text-sm font-semibold text-white disabled:opacity-60 touch-manipulation"
            >
              {pending ? 'Saving' : 'Save cap'}
            </button>
          </div>
        </fetcher.Form>
      )}
    </section>
  )
}
