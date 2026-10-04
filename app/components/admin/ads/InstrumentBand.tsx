/**
 * One-surface metric band (wires 8.2, 8.3): spend, orders, net ROAS with its
 * break-even, a spend sparkline and the rules fired today. Every figure carries
 * its lookback; lookback chips switch 7d and 30d through the URL. When the data
 * is not live the band says so in words, so a simulated number is never
 * mistaken for a real one.
 */
import { MetricSparkline } from '~/components/admin/social/MetricSparkline'
import { formatMoney, formatRoas, type BreakEven, type LiveBand, type LiveSource } from '~/lib/ad-metrics-core'

export function sourceChipText(source: LiveSource): string | null {
  return source === 'sample' ? 'sample data' : source === 'shop-history' ? 'Shop history' : null
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[11px] uppercase tracking-wide text-ink-3">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-ink">
        {value}
        {note && <span className="ml-1.5 whitespace-nowrap font-normal text-ink-3">{note}</span>}
      </p>
    </div>
  )
}

export function InstrumentBand({
  band, breakEven, source, onLookback,
}: {
  band: LiveBand
  breakEven: BreakEven
  source: LiveSource
  onLookback: (days: 7 | 30) => void
}) {
  const w = `${band.lookbackDays}D`
  const notLive = sourceChipText(source)
  const shop = source === 'shop-history'
  return (
    <section aria-label="Totals" className="rounded-2xl border border-line bg-paper p-4 lg:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Stat label={`Spend ${w}`} value={formatMoney(band.spendCents)} />
          <Stat label={`Orders ${w}`} value={shop ? 'n/a' : String(band.orders)} />
          <Stat
            label={`Net ROAS ${w}`}
            value={shop ? 'n/a' : formatRoas(band.netRoas)}
            note={`BE ${formatRoas(breakEven.roas)}`}
          />
          <Stat label="Rules today" value={String(band.rulesFiredToday)} />
        </div>
        <div role="group" aria-label="Lookback" className="flex shrink-0 gap-1">
          {([7, 30] as const).map(d => (
            <button
              key={d}
              type="button"
              aria-pressed={band.lookbackDays === d}
              onClick={() => onLookback(d)}
              className={`min-h-11 min-w-11 md:min-h-9 md:min-w-9 rounded-full border px-2 font-mono text-[11px] touch-manipulation ${band.lookbackDays === d ? 'border-coral bg-coral-soft text-ink' : 'border-line bg-paper text-ink-3 hover:border-ink-4'}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-ink-3">
        <MetricSparkline points={band.series} label={`Daily spend, last ${band.lookbackDays} days`} className="max-w-full" />
        <p className="text-right font-mono text-[11px] leading-snug">
          {notLive && <span className="block text-ink-2">{notLive}</span>}
          Net revenue excludes shipping and tax. Break-even CPA {formatMoney(breakEven.cpaCents)} at {breakEven.marginPct}% margin.
        </p>
      </div>
    </section>
  )
}
