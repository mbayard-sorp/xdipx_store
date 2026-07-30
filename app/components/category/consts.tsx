/**
 * Shared style constants + small helpers for the merchandised category-page
 * blocks. Mirrors the MONO/DISPLAY/BODY consts in StorefrontHome.tsx so the
 * two surfaces read as one brand rather than drifting typefaces.
 */

import type { ReactNode } from 'react'

export const MONO = { fontFamily: 'var(--font-mono)' } as const
export const DISPLAY = { fontFamily: 'var(--font-display)', fontWeight: 400 } as const
export const DISPLAY_MED = { fontFamily: 'var(--font-display)', fontWeight: 500 } as const
export const BODY = { fontFamily: 'var(--font-body)' } as const

/** kicker: 11px uppercase mono, ink-4. Shared className string (no wrapper
 *  component needed, blocks just spread it onto a <p>). */
export const KICKER_CLASS = 'text-[11px] uppercase tracking-[0.18em] text-ink-4'

/**
 * Renders a headline with one word wrapped in `<em className="em">` (italic
 * plum emphasis, Motif 01). Matches the word case-insensitively against the
 * headline and preserves the headline's own casing for the matched span. No
 * match = the headline renders unchanged.
 */
export function renderEmphasizedHeadline(headline: string, italicWord: string | null): ReactNode {
  if (!italicWord) return headline
  const idx = headline.toLowerCase().indexOf(italicWord.toLowerCase())
  if (idx === -1) return headline
  const before = headline.slice(0, idx)
  const match = headline.slice(idx, idx + italicWord.length)
  const after = headline.slice(idx + italicWord.length)
  return (
    <>
      {before}
      <em className="em">{match}</em>
      {after}
    </>
  )
}

export function formatPrice(n: number): string {
  return `$${n.toFixed(2)}`
}
