import type { ReactElement } from 'react'
import type { ReturnStatus } from '../../../db/schema'

const LABELS: Record<ReturnStatus, string> = {
  requested:  'Requested',
  approved:   'Approved',
  label_sent: 'Label sent',
  in_transit: 'In transit',
  received:   'Received',
  refunded:   'Refunded',
  closed:     'Closed',
  denied:     'Denied',
  canceled:   'Canceled',
}

const COLORS: Record<ReturnStatus, string> = {
  requested:  'bg-yellow-100 text-yellow-700',
  approved:   'bg-yellow-100 text-yellow-700',
  label_sent: 'bg-blue-100 text-blue-700',
  in_transit: 'bg-blue-100 text-blue-700',
  received:   'bg-purple-100 text-purple-700',
  refunded:   'bg-green-100 text-green-700',
  closed:     'bg-gray-100 text-gray-500',
  denied:     'bg-red-100 text-red-700',
  canceled:   'bg-red-100 text-red-700',
}

export function ReturnStatusPill({ status }: { status: ReturnStatus | string }): ReactElement {
  const key = (status as ReturnStatus) in LABELS ? (status as ReturnStatus) : 'requested'
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${COLORS[key]}`}>
      {LABELS[key]}
    </span>
  )
}
