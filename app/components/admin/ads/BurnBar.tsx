/**
 * Sticky burn bar (wires 3.1): today's spend against the daily cap, orders
 * today, and the simulation badge. 48px tall, sticky under the phone's ink
 * header, and it reserves its height whether or not the figures loaded. An
 * unknown spend reads "spend unknown", never a false $0.00.
 *
 * Needs the admin content column to be overflow-x-clip, not overflow-auto
 * (see app/routes/admin.tsx), or sticky has nothing to stick against.
 */
import { useRevalidator } from 'react-router'
import { RefreshIcon } from '~/components/admin/social/icons'
import { SimulationBadge } from './SimulationBadge'

export interface BurnBarData {
  ok: boolean
  spendCents: number | null
  ordersToday: number | null
  dailyCapCents: number
  spendEnabled: boolean
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function BurnBar({ burn }: { burn: BurnBarData }) {
  const revalidator = useRevalidator()
  const known = burn.ok && burn.spendCents != null
  const cap = Math.max(1, burn.dailyCapCents)
  const ratio = known ? Math.min(1, (burn.spendCents ?? 0) / cap) : 0
  const level = ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok'
  const fill = level === 'over' ? 'bg-red-700' : level === 'warn' ? 'bg-amber-500' : 'bg-ink-2'
  const figure = level === 'over'
    ? 'rounded-full border border-red-300 bg-red-50 px-2 text-red-800'
    : level === 'warn'
      ? 'rounded-full border border-amber-300 bg-amber-50 px-2 text-amber-800'
      : 'text-ink'

  return (
    <div className="sticky top-[52px] md:top-0 z-20 -mx-4 -mt-4 md:-mx-8 md:-mt-8 px-4 md:px-8 h-12 flex items-center gap-3 border-b border-line bg-paper/95 backdrop-blur">
      <span className="hidden md:block font-display text-xl text-ink shrink-0 pr-2">Ad Studio</span>

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="shrink-0 font-mono text-[11px] uppercase tracking-wide text-ink-3">Today</div>
        {known ? (
          <span className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${figure}`}>
            {dollars(burn.spendCents ?? 0)}
            <span className="text-ink-4 font-normal"> / {dollars(burn.dailyCapCents)}</span>
            {level === 'over' && <span className="ml-1 font-normal">cap reached</span>}
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1">
            <span className="font-mono text-xs text-amber-800">spend unknown</span>
            <button
              type="button"
              onClick={() => revalidator.revalidate()}
              aria-label="Retry loading spend"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-3 hover:text-ink touch-manipulation"
            >
              <RefreshIcon size={14} className={revalidator.state === 'loading' ? 'animate-spin motion-reduce:animate-none' : ''} />
            </button>
          </span>
        )}

        <div
          className="h-1 min-w-6 flex-1 max-w-64 overflow-hidden rounded-full bg-paper-3"
          role="progressbar"
          aria-label="Spend against today's cap"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(ratio * 100)}
        >
          <div
            className={`h-full w-full origin-left transition-transform duration-[var(--duration-slow)] ease-[var(--ease-standard)] ${fill}`}
            style={{ transform: `scaleX(${ratio})` }}
          />
        </div>

        <span className="shrink-0 font-mono text-xs tabular-nums text-ink-3">
          {burn.ordersToday == null ? 'orders unknown' : (
            <>
              {burn.ordersToday}<span className="md:hidden"> ord</span><span className="hidden md:inline"> {burn.ordersToday === 1 ? 'order' : 'orders'}</span>
            </>
          )}
        </span>
      </div>

      <SimulationBadge spendEnabled={burn.spendEnabled} />
    </div>
  )
}
