import type { ReactNode } from 'react'

/**
 * Horizontal-scroll wrapper for admin tables. On small screens the table
 * bleeds to the viewport edge (negative margin) and scrolls within the
 * wrapper; the page body never scrolls sideways. Give the inner <table>
 * a min-width (e.g. `min-w-[640px]`) so fixed column layouts hold their
 * widths instead of collapsing.
 */
export function ResponsiveTable({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 ${className}`}>
      {children}
    </div>
  )
}
