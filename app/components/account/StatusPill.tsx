import type { ReactElement } from 'react'

interface StatusPillProps {
  value: string | null | undefined
  kind: 'financial' | 'fulfillment'
}

const COLORS: Record<string, string> = {
  paid:                'bg-green-100 text-green-700',
  refunded:            'bg-red-100 text-red-700',
  pending:             'bg-yellow-100 text-yellow-700',
  authorized:          'bg-yellow-100 text-yellow-700',
  fulfilled:           'bg-blue-100 text-blue-700',
  shipped:             'bg-blue-100 text-blue-700',
  in_transit:          'bg-blue-100 text-blue-700',
  delivered:           'bg-green-100 text-green-700',
  unfulfilled:         'bg-gray-100 text-gray-500',
  partially_fulfilled: 'bg-yellow-100 text-yellow-700',
  out_for_delivery:    'bg-blue-100 text-blue-700',
}

export function StatusPill({ value, kind }: StatusPillProps): ReactElement | null {
  if (!value) return null
  const normalized = value.toLowerCase()

  // Suppress the default "unfulfilled" fulfillment state — we don't want to
  // clutter order cards with a pill for the Shopify default pre-ship state.
  if (kind === 'fulfillment' && normalized === 'unfulfilled') return null

  const color = COLORS[normalized] ?? 'bg-gray-100 text-gray-500'
  const label =
    normalized.charAt(0).toUpperCase() + normalized.slice(1).replace(/_/g, ' ')

  return (
    <span
      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${color}`}
    >
      {label}
    </span>
  )
}
