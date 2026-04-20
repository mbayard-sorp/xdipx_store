import type { ReactElement } from 'react'
import type { ReturnStatus } from '../../../db/schema'

interface Step {
  key: ReturnStatus
  label: string
}

const STEPS: Step[] = [
  { key: 'requested',  label: 'Requested' },
  { key: 'label_sent', label: 'Label sent' },
  { key: 'in_transit', label: 'In transit' },
  { key: 'received',   label: 'Received' },
  { key: 'refunded',   label: 'Refunded' },
]

const ORDER: Record<ReturnStatus, number> = {
  requested:  0,
  approved:   0,
  label_sent: 1,
  in_transit: 2,
  received:   3,
  refunded:   4,
  closed:     4,
  denied:    -1,
  canceled:  -1,
}

export function ReturnTimeline({ status }: { status: ReturnStatus | string }): ReactElement {
  const current = ORDER[status as ReturnStatus] ?? 0
  const terminal = status === 'denied' || status === 'canceled'

  if (terminal) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
        <p className="text-sm font-semibold text-red-700">
          Return {status === 'denied' ? 'denied' : 'canceled'}
        </p>
        <p className="text-xs text-red-600/80 mt-1">
          Contact support if you have questions.
        </p>
      </div>
    )
  }

  return (
    <ol className="flex items-start justify-between gap-1 text-center">
      {STEPS.map((step, i) => {
        const done = i < current
        const active = i === current
        const dotColor = done
          ? 'bg-sage border-sage'
          : active
          ? 'bg-coral border-coral'
          : 'bg-white border-cream-2'
        const lineColor = i < current ? 'bg-sage' : 'bg-cream-2'

        return (
          <li key={step.key} className="flex-1 relative">
            {i > 0 && (
              <span
                aria-hidden="true"
                className={`absolute right-[calc(50%+12px)] left-0 top-[11px] h-[2px] ${lineColor}`}
              />
            )}
            <div className="flex flex-col items-center">
              <span
                className={`relative z-10 w-6 h-6 rounded-full border-2 ${dotColor} flex items-center justify-center`}
                aria-hidden="true"
              >
                {done && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </span>
              <span
                className={`mt-1.5 text-[10px] leading-tight ${
                  active || done ? 'text-ink font-semibold' : 'text-ink/40'
                }`}
              >
                {step.label}
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
