/**
 * Single chat bubble for the Variant B "Emma Asks" conversation thread.
 *
 * Emma bubbles: paper bg, ink text, small Emma avatar inline-left,
 * rounded-tl-sm (flat top-left corner like a chat app reply).
 * User ("you") bubbles: ink bg, paper text, right-aligned, no avatar.
 * `sub` renders muted small text below the bubble body.
 * `muted` reduces opacity for prior exchanges the user has already answered.
 */

import type { ReactNode } from 'react'

interface EmmaBubbleProps {
  from: 'emma' | 'you'
  children: ReactNode
  sub?: string
  muted?: boolean
}

export function EmmaBubble({ from, children, sub, muted = false }: EmmaBubbleProps) {
  if (from === 'you') {
    return (
      <div
        className={[
          'flex justify-end transition-opacity duration-300',
          muted ? 'opacity-40' : 'opacity-100',
        ].join(' ')}
      >
        <div
          className="bg-ink text-paper rounded-2xl rounded-tr-sm px-5 py-3 max-w-xs text-sm leading-snug"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          {children}
          {sub && (
            <p className="mt-1 text-paper/50 text-xs">{sub}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={[
        'flex gap-3 items-start transition-opacity duration-300',
        muted ? 'opacity-40' : 'opacity-100',
      ].join(' ')}
    >
      {/* Emma avatar — 28px round */}
      <img
        src="/emma.png"
        alt="Emma"
        width={28}
        height={28}
        className="rounded-full flex-none mt-1 object-cover"
        aria-hidden="true"
      />

      <div
        className="bg-paper border border-line rounded-2xl rounded-tl-sm px-5 py-4 max-w-xl shadow-sm"
      >
        <div style={{ fontFamily: 'var(--font-display)' }}>
          {children}
        </div>
        {sub && (
          <p
            className="mt-1.5 text-sm text-muted leading-snug"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            {sub}
          </p>
        )}
      </div>
    </div>
  )
}
