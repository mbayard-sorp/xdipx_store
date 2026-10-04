/**
 * Simulation badge plus the read-only exit-criteria sheet (wires 3.4).
 *
 * Design rule: the ads_spend_enabled valve is never a toggle inside Ad Studio.
 * Flipping real money on should not sit one thumb away from a rating button.
 * This control only reads it. The four exit lines (plan section 2) show real
 * numbers; a line whose read failed says "unknown" instead of a made-up zero.
 */
import { useState } from 'react'
import { EXIT_TARGETS, type SimulationExit } from '~/lib/ad-spend-core'

function Track({ value, target }: { value: number | null; target: number }) {
  const ratio = value == null ? 0 : Math.min(1, value / target)
  return (
    <span className="ml-2 inline-block h-1 w-14 overflow-hidden rounded-full bg-paper-3 align-middle" aria-hidden="true">
      <span className="block h-full w-full origin-left bg-ink-2" style={{ transform: `scaleX(${ratio})` }} />
    </span>
  )
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-3 uppercase tracking-wide text-[11px]">{label}</dt>
      <dd className="text-ink tabular-nums text-right">{children}</dd>
    </div>
  )
}

export function SimulationBadge({ spendEnabled, exit }: { spendEnabled: boolean; exit?: SimulationExit | null | undefined }) {
  const [open, setOpen] = useState(false)
  const t = EXIT_TARGETS
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
              <Line label="Routine streak">
                {exit?.streakDays == null ? 'unknown' : <>{exit.streakDays} / {t.streakDays} days<Track value={exit.streakDays} target={t.streakDays} /></>}
              </Line>
              <Line label="Hearted creatives">
                {exit?.heartedCreatives == null ? 'unknown' : <>{exit.heartedCreatives} / {t.heartedCreatives}<Track value={exit.heartedCreatives} target={t.heartedCreatives} /></>}
              </Line>
              <Line label="Lanes with hearts">
                {exit?.lanesWithHearts == null ? 'unknown' : <>{exit.lanesWithHearts} / {t.lanesWithHearts}<Track value={exit.lanesWithHearts} target={t.lanesWithHearts} /></>}
              </Line>
              <Line label="Bridge page live">
                {exit?.bridgeLive == null ? 'unknown' : exit.bridgeLive ? 'yes' : 'no'}
              </Line>
              <Line label="Owner says go">
                {exit?.ownerSaysGo ? 'yes' : 'not yet'}
              </Line>
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
