import type { ReactNode } from 'react'

interface DangerZoneProps {
  children: ReactNode
}

/**
 * Presentational wrapper for the "Danger zone" section on the profile page.
 * Red-outlined bordered card, visually separated from the normal cards.
 */
export function DangerZone({ children }: DangerZoneProps) {
  return (
    <section className="border border-red-200 rounded-2xl p-5 bg-red-50/30 space-y-3">
      {children}
    </section>
  )
}
