import type { CSSProperties, ElementType, ReactNode } from 'react'
import { useReveal } from '~/lib/use-reveal'
import { REVEAL_DISTANCE, STAGGER_CLAMP, STAGGER_STEP, type RevealVariant } from './variants'

interface RevealProps {
  /** fade | up (default) | scale */
  variant?: RevealVariant
  /** Extra entrance delay in seconds. */
  delay?: number
  /** Stagger position — multiplies STAGGER_STEP (clamped). */
  index?: number
  /** Animate once then stop. Default true. */
  once?: boolean
  /** Above-the-fold: render visible, never animate. */
  disabled?: boolean
  /** Rendered element. Default 'div'. */
  as?: ElementType
  className?: string
  style?: CSSProperties
  children: ReactNode
}

/**
 * SSR-safe scroll-reveal wrapper. CSS transitions, no JS animation runtime.
 *
 * The server and the browser's first paint render the FINAL (visible) state,
 * so there is never a flash of hidden content if JS is slow or disabled, and
 * hydration always matches. Before the first paint, `useReveal` arms only the
 * elements that are BELOW the fold; those get hidden and transition in when
 * scrolled to. Anything already on screen is left alone, so an entrance
 * animation can never delay FCP or LCP.
 *
 * Reveals are transform/opacity only — zero layout shift. Reduced motion
 * renders the final state with no transform.
 */
export function Reveal({
  variant = 'up',
  delay = 0,
  index = 0,
  once = true,
  disabled = false,
  as: Tag = 'div',
  className,
  style,
  children,
}: RevealProps) {
  const { ref, inView, armed } = useReveal({ once, disabled })

  const staggerDelay = Math.min(index, STAGGER_CLAMP) * STAGGER_STEP
  const classes = ['reveal', `reveal-${variant}`]
  if (armed) classes.push('reveal-armed')
  if (armed && inView) classes.push('reveal-in')
  if (className) classes.push(className)

  const delaySeconds = delay + staggerDelay
  // A CSS custom property is not in CSSProperties; the cast is the standard escape.
  const resolvedStyle =
    delaySeconds > 0
      ? ({ ...style, '--reveal-delay': `${delaySeconds}s` } as CSSProperties)
      : style

  return (
    <Tag ref={ref} className={classes.join(' ')} style={resolvedStyle}>
      {children}
    </Tag>
  )
}

export { REVEAL_DISTANCE }
