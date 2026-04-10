import type { ReactElement } from 'react'
import type { Fulfillment } from '~/lib/shopify.server'

interface OrderTrackingStepperProps {
  financialStatus: string
  fulfillmentStatus: string
  fulfillments: Fulfillment[]
  statusUrl?: string | null
}

type StepState = 'complete' | 'active' | 'failed' | 'future'
interface Step { key: string; label: string; state: StepState }

const CIRCLE: Record<StepState, string> = {
  complete: 'bg-brand-gradient text-white border border-transparent',
  active:   'border-2 border-brand-coral bg-brand-cream text-brand-coral',
  failed:   'border-2 border-red-400 bg-red-50 text-red-500',
  future:   'border border-brand-mist bg-white text-brand-charcoal/30',
}

const SHIPPED_FULFILLMENT = new Set([
  'shipped', 'partially_fulfilled', 'fulfilled',
  'in_transit', 'delivered', 'out_for_delivery',
])
const IN_TRANSIT_FULFILLMENT = new Set([
  'in_transit', 'out_for_delivery', 'delivered',
])

function buildSteps(financialStatus: string, fulfillmentStatus: string): Step[] {
  const fin = financialStatus.toLowerCase()
  const ful = fulfillmentStatus.toLowerCase()

  let paid: StepState
  if (fin === 'paid' || fin === 'partially_paid')                          paid = 'complete'
  else if (fin === 'pending' || fin === 'authorized')                      paid = 'active'
  else if (fin === 'refunded' || fin === 'voided' || fin === 'partially_refunded') paid = 'failed'
  else                                                                     paid = 'future'

  const shipped   = SHIPPED_FULFILLMENT.has(ful)
  const inTransit = IN_TRANSIT_FULFILLMENT.has(ful)
  const delivered = ful === 'delivered'

  const steps: Step[] = [
    { key: 'placed',     label: 'Placed',     state: 'complete' },
    { key: 'paid',       label: 'Paid',       state: paid },
    { key: 'shipped',    label: 'Shipped',    state: shipped   ? 'complete' : 'future' },
    { key: 'in_transit', label: 'In transit', state: inTransit ? 'complete' : 'future' },
    { key: 'delivered',  label: 'Delivered',  state: delivered ? 'complete' : 'future' },
  ]

  // Mark the first future step as "active" so the user sees the frontier.
  if (paid === 'complete') {
    const idx = steps.findIndex((s) => s.state === 'future')
    const step = idx !== -1 ? steps[idx] : undefined
    if (step) step.state = 'active'
  }
  return steps
}

function stateLabel(state: StepState): string {
  if (state === 'complete') return 'done'
  if (state === 'active')   return 'in progress'
  if (state === 'failed')   return 'issue'
  return 'upcoming'
}

/**
 * Color the segment between two adjacent steps. Both halves of a desktop
 * step (left of circle / right of circle) and the vertical mobile rail use
 * this same rule, so the colors stay consistent across the whole rail:
 * a segment is "active" only when *both* endpoints are reached.
 */
function segmentClass(prev: StepState | undefined, next: StepState | undefined): string {
  const reached = (s: StepState | undefined) => s === 'complete' || s === 'active'
  return reached(prev) && reached(next) ? 'bg-brand-coral/60' : 'bg-brand-mist'
}

export function OrderTrackingStepper({
  financialStatus,
  fulfillmentStatus,
  fulfillments,
  statusUrl,
}: OrderTrackingStepperProps): ReactElement {
  const steps = buildSteps(financialStatus, fulfillmentStatus)
  const tracking = fulfillments[0]?.trackingInfo[0] ?? null
  const trackingNumber = tracking?.number ?? null
  const trackingUrl    = tracking?.url ?? statusUrl ?? null
  const carrier        = fulfillments[0]?.trackingCompany ?? tracking?.company ?? null

  return (
    <nav
      aria-label="Order tracking"
      className="bg-white border border-brand-mist rounded-2xl p-4 md:p-5"
    >
      {/* Desktop: horizontal */}
      <ol className="hidden md:flex items-start justify-between gap-2 relative">
        {steps.map((step, i) => {
          const prev = steps[i - 1]?.state
          const next = steps[i + 1]?.state
          return (
            <li key={step.key} className="flex-1 flex flex-col items-center relative min-w-0">
              {i > 0 && (
                <span aria-hidden="true" className={`absolute left-0 right-1/2 top-4 h-[2px] ${segmentClass(prev, step.state)}`} />
              )}
              {i < steps.length - 1 && (
                <span aria-hidden="true" className={`absolute left-1/2 right-0 top-4 h-[2px] ${segmentClass(step.state, next)}`} />
              )}
              <StepCircle step={step} index={i} />
              <span className={`mt-2 text-[11px] font-semibold text-center ${
                step.state === 'future' ? 'text-brand-charcoal/40' : 'text-brand-charcoal'
              }`}>
                {step.label}
              </span>
            </li>
          )
        })}
      </ol>

      {/* Mobile: vertical */}
      <ol className="md:hidden flex flex-col">
        {steps.map((step, i) => {
          const next = steps[i + 1]?.state
          return (
            <li key={step.key} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <StepCircle step={step} index={i} />
                {i < steps.length - 1 && (
                  <span
                    aria-hidden="true"
                    className={`w-[2px] flex-1 min-h-[28px] ${segmentClass(step.state, next)}`}
                  />
                )}
              </div>
              <p
                className={`text-sm font-semibold pb-5 ${
                  step.state === 'future' ? 'text-brand-charcoal/40' : 'text-brand-charcoal'
                }`}
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {step.label}
              </p>
            </li>
          )
        })}
      </ol>

      {(trackingNumber || trackingUrl) && (
        <div className="mt-4 pt-4 border-t border-brand-mist text-xs text-brand-charcoal/60">
          {carrier && (
            <>
              <span className="font-semibold text-brand-charcoal">{carrier}:</span>{' '}
            </>
          )}
          {trackingNumber ? (
            <span className="tabular-nums">{trackingNumber}</span>
          ) : (
            <span>See carrier for details</span>
          )}
          {trackingUrl && (
            <>
              {' · '}
              <a
                href={trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-brand-purple hover:text-brand-purple-light transition-colors"
              >
                Track &rarr;
              </a>
            </>
          )}
        </div>
      )}
    </nav>
  )
}

function StepCircle({ step, index }: { step: Step; index: number }): ReactElement {
  return (
    <span
      role="img"
      aria-label={`${step.label} — ${stateLabel(step.state)}`}
      className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${CIRCLE[step.state]}`}
      style={{ fontFamily: 'var(--font-display)' }}
    >
      <span aria-hidden="true" className={step.state === 'future' || step.state === 'active' ? 'tabular-nums' : ''}>
        {step.state === 'complete' ? '♥' : step.state === 'failed' ? '!' : index + 1}
      </span>
    </span>
  )
}
