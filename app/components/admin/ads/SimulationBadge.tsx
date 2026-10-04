/**
 * Simulation badge plus the read-only exit-criteria sheet (wires 3.4).
 *
 * Design rule: the ads_spend_enabled valve is never a toggle inside Ad Studio.
 * Flipping real money on should not sit one thumb away from a rating button.
 * This control only reads it.
 */
import { useState } from 'react'

const CRITERIA: Array<{ label: string; target: string }> = [
  { label: 'Routine streak', target: '10 straight days' },
  { label: 'Hearted creatives', target: '30 across 3 lanes' },
  { label: 'Bridge page live', target: 'yes' },
  { label: 'Owner says go', target: 'yes' },
]

export function SimulationBadge({ spendEnabled }: { spendEnabled: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`relative h-7 px-2.5 rounded-full border font-mono text-[11px] uppercase tracking-wide touch-manipulation before:absolute before:-inset-2 before:content-[''] ${
          spendEnabled ? 'border-ink bg-ink text-white' : 'border-plum/20 bg-plum-soft text-plum-2'
        }`}
      >
        {spendEnabled ? 'Spend on' : 'Simulation'}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close simulation details"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 bg-ink/20 md:bg-transparent cursor-default"
          />
          <div
            role="dialog"
            aria-label="Simulation mode"
            className="fixed inset-x-2 bottom-2 z-40 max-h-[80dvh] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-paper p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-lg md:absolute md:inset-x-auto md:bottom-auto md:top-full md:right-0 md:mt-2 md:w-80 md:pb-4"
          >
            <p className="text-sm font-semibold text-ink">
              {spendEnabled ? 'Spend is on' : 'Simulation mode'}
            </p>
            <p className="mt-1 text-xs text-ink-3">
              {spendEnabled
                ? 'Exports can upload and rules can act. Money can move.'
                : 'Ideas and creatives run daily. Exports are built and stored. Nothing uploads and no money moves.'}
            </p>
            <dl className="mt-3 space-y-1.5 font-mono text-xs">
              {CRITERIA.map(c => (
                <div key={c.label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-3 uppercase tracking-wide text-[11px]">{c.label}</dt>
                  <dd className="text-ink tabular-nums text-right">
                    {c.target} <span className="text-ink-4">(not tracked yet)</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-ink-3">
              The spend valve is flipped from the owner valve surface, per the Phase 5 runbook. It is not on this screen.
            </p>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-11 px-4 rounded-full border border-line bg-paper text-sm font-medium text-ink hover:border-ink-4 touch-manipulation"
              >
                Done
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
