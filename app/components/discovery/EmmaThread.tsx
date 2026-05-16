/**
 * Container for the Variant B conversation column.
 * Centered, vertical stack, padded top.
 * Smooth height growth as new bubbles append — overflow visible so nothing clips.
 */

import type { ReactNode } from 'react'

interface EmmaThreadProps {
  children: ReactNode
}

export function EmmaThread({ children }: EmmaThreadProps) {
  return (
    <div className="max-w-2xl mx-auto px-4 pt-8 pb-6 flex flex-col gap-5">
      {children}
    </div>
  )
}
