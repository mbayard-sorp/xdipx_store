/**
 * Instrument band for the Spend tab (wires 9.1, 9.4, 9.5): media against its
 * cap and compute against its own cap, side by side but never summed. One
 * surface, hairlines between the readings. Phones show two rows (media, compute);
 * md and up add the month reading as a third column.
 */
import { formatMoney } from '~/lib/ad-metrics-core'

export interface SpendBandData {
  mediaTodayCents: number
  dailyCapCents: number
  computeTodayCents: number | null
  computeCapCents: number
  monthSpentCents: number
  monthlyCapCents: number
  spendEnabled: boolean
}

function Reading({ label, value, cap, note, className = '' }: { label: string; value: string; cap: string; note?: string; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="font-mono text-[11px] uppercase tracking-wide text-ink-3">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-ink">
        {value}
        <span className="font-normal text-ink-3"> / {cap}</span>
        {note && <span className="ml-1.5 font-normal text-ink-3">{note}</span>}
      </p>
    </div>
  )
}

export function SpendBand({ band }: { band: SpendBandData }) {
  return (
    <section aria-label="Spend today" className="rounded-2xl border border-line bg-paper p-4 lg:p-5">
      <div className="grid gap-3 md:grid-cols-3 md:gap-0 md:divide-x md:divide-line">
        <Reading
          label="Media today"
          value={formatMoney(band.mediaTodayCents)}
          cap={formatMoney(band.dailyCapCents)}
          className="md:pr-4"
        />
        <Reading
          label="Compute today"
          value={band.computeTodayCents == null ? 'unknown' : formatMoney(band.computeTodayCents)}
          cap={formatMoney(band.computeCapCents)}
          note="renders"
          className="border-t border-line pt-3 md:border-t-0 md:px-4 md:pt-0"
        />
        <Reading
          label="Month"
          value={formatMoney(band.monthSpentCents)}
          cap={formatMoney(band.monthlyCapCents)}
          className="hidden md:block md:pl-4"
        />
      </div>
      <p className="mt-3 text-xs text-ink-3">
        {band.spendEnabled
          ? 'Media is ad platform spend. Compute is image renders. They have separate caps and are never added together.'
          : 'Simulation: media shows imported history, no ad money moves. Compute is image renders, a separate cap.'}
      </p>
    </section>
  )
}
