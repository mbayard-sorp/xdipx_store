/**
 * Five gate chips as one expandable button row (wires 5.3). Order is fixed:
 * Vision, Product, Voice, Policy, Text. Glyph plus word, never colour alone.
 * Tap expands each gate's one-line reason in place, in the Social Studio
 * GateVerdictPanel list styling.
 */
import { useState } from 'react'
import { AlertIcon, CheckIcon, CloseIcon, MinusIcon } from '~/components/admin/social/icons'
import { GATE_ORDER, type GateName, type GateResult, type GateState, type GatesJson } from '~/lib/ad-render-rules'

const LABEL: Record<GateName, string> = { vision: 'Vision', product: 'Product', voice: 'Voice', policy: 'Policy', text: 'Text' }

const STYLE: Record<GateState, { cls: string; Icon: (p: { size?: number }) => React.JSX.Element; word: string }> = {
  pass: { cls: 'border-[#BFCDBB] bg-[#EEF3EC] text-[#4F6150]', Icon: CheckIcon, word: 'pass' },
  revise: { cls: 'border-amber-300 bg-amber-50 text-amber-800', Icon: AlertIcon, word: 'revise' },
  block: { cls: 'border-red-300 bg-red-50 text-red-800', Icon: CloseIcon, word: 'block' },
  not_run: { cls: 'border-dashed border-line bg-paper text-ink-4', Icon: MinusIcon, word: 'not run' },
}

function GateChip({ name, gate }: { name: GateName; gate: GateResult | undefined }) {
  const s = STYLE[gate?.state ?? 'not_run']
  const Icon = s.Icon
  return (
    <span
      className={`inline-flex items-center gap-1 h-6 px-2 rounded-full border text-[11px] font-semibold leading-none whitespace-nowrap ${s.cls}`}
      title={`${LABEL[name]}: ${s.word}`}
    >
      <Icon size={12} />
      {LABEL[name]}
      <span className="sr-only">: {s.word}</span>
    </span>
  )
}

export function GateChips({ gates, queuedNote }: { gates: GatesJson | null; queuedNote?: string | null }) {
  const [open, setOpen] = useState(false)
  if (!gates) {
    return <p className="min-h-11 flex items-center text-xs text-ink-4">{queuedNote ?? 'Gates run when the render finishes.'}</p>
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label="Gate results"
        className="min-h-11 w-full flex flex-wrap items-center gap-1.5 text-left touch-manipulation"
      >
        {GATE_ORDER.map(n => <GateChip key={n} name={n} gate={gates[n]} />)}
      </button>
      {open && (
        <ul className="mt-1 mb-2 rounded-xl border border-line divide-y divide-line bg-paper" role="list">
          {GATE_ORDER.map(n => {
            const g = gates[n]
            const s = STYLE[g?.state ?? 'not_run']
            const Icon = s.Icon
            const tone = g?.state === 'pass' ? 'text-[#4F6150]' : g?.state === 'block' ? 'text-red-700' : g?.state === 'revise' ? 'text-amber-800' : 'text-ink-4'
            return (
              <li key={n} className="px-3 py-2 flex items-start gap-2">
                <span className={`mt-0.5 shrink-0 ${tone}`} aria-hidden="true"><Icon size={14} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-ink">{LABEL[n]}</span>
                    <span className={`font-mono text-[11px] uppercase ${tone}`}>{s.word}</span>
                  </div>
                  {g?.reason && <p className="text-xs text-ink-3 mt-0.5 break-words">{g.reason}</p>}
                  {g?.requestId && <p className="font-mono text-[10px] text-ink-4 mt-0.5 break-all">{g.requestId}</p>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
