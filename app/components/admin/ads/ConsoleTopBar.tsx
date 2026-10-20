/**
 * Sticky top bar for the ads console (/admin/ads): today's spend from the
 * insights mirror against ads_media_daily_cap_cents, and the simulation badge.
 * Same height, stickiness and phone restack as the Ad Studio burn bar
 * (BurnBar.tsx), so moving between the two does not shift the page. An
 * unknown spend reads "spend unknown", never a false $0.00.
 */
import { useRevalidator } from 'react-router'
import { RefreshIcon } from '~/components/admin/social/icons'
import { SimulationBadge } from './SimulationBadge'
import type { SimulationExit } from '~/lib/ad-spend-core'

export interface ConsoleTopBarData {
  spendTodayCents: number | null
  dailyCapCents: number
  spendEnabled: boolean
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function ConsoleTopBar({ bar, exit }: { bar: ConsoleTopBarData; exit?: SimulationExit | null | undefined }) {
  const revalidator = useRevalidator()
  const known = bar.spendTodayCents != null
  const cap = Math.max(1, bar.dailyCapCents)
  const ratio = known ? Math.min(1, (bar.spendTodayCents ?? 0) / cap) : 0
  const level = ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok'
  const fill = level === 'over' ? 'bg-red-700' : level === 'warn' ? 'bg-amber-500' : 'bg-ink-2'
  const figure = level === 'over'
    ? 'rounded-full border border-red-300 bg-red-50 px-2 text-red-800'
    : level === 'warn'
      ? 'rounded-full border border-amber-300 bg-amber-50 px-2 text-amber-800'
      : 'text-ink'

  return (
    <div className="sticky top-[52px] md:top-0 z-20 -mx-4 -mt-4 md:-mx-8 md:-mt-8 px-4 md:px-8 h-12 flex items-center gap-3 border-b border-line bg-paper/95 backdrop-blur">
      <span className="font-display text-lg md:text-xl text-ink shrink-0 md:pr-2">Ads</span>

      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden md:gap-3">
        <div className="sr-only md:not-sr-only shrink-0 font-mono text-[11px] uppercase tracking-wide text-ink-3">Today</div>
        {known ? (
          <span className={`shrink-0 whitespace-nowrap font-mono text-sm font-semibold tabular-nums ${figure}`}>
            {dollars(bar.spendTodayCents ?? 0)}
            <span className="text-ink-4 font-normal"> / {dollars(bar.dailyCapCents)}</span>
            {level === 'over' && <span className="sr-only font-normal md:not-sr-only md:ml-1"> cap reached</span>}
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1">
            <span className="whitespace-nowrap font-mono text-xs text-amber-800">spend unknown</span>
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
          className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-paper-3 md:static md:h-1 md:min-w-6 md:flex-1 md:max-w-64 md:rounded-full"
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
      </div>

      <SimulationBadge spendEnabled={bar.spendEnabled} exit={exit} />
    </div>
  )
}
