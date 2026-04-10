import type { ReactElement } from 'react'

interface SubscriptionStatusPillProps {
  status: string
}

const COLORS: Record<string, string> = {
  ACTIVE:    'bg-green-100 text-green-700',
  PAUSED:    'bg-yellow-100 text-yellow-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
  EXPIRED:   'bg-gray-100 text-gray-500',
  STALE:     'bg-yellow-100 text-yellow-700',
  FAILED:    'bg-red-100 text-red-700',
}

const LABELS: Record<string, string> = {
  ACTIVE:    'Active',
  PAUSED:    'Paused',
  CANCELLED: 'Cancelled',
  EXPIRED:   'Expired',
  STALE:     'Stale',
  FAILED:    'Needs attention',
}

export function SubscriptionStatusPill({ status }: SubscriptionStatusPillProps): ReactElement {
  const color = COLORS[status] ?? 'bg-gray-100 text-gray-500'
  const label = LABELS[status] ?? status.charAt(0) + status.slice(1).toLowerCase()

  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${color}`}>
      {label}
    </span>
  )
}
