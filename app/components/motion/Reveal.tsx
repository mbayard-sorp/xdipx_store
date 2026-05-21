import { motion, type MotionStyle } from 'motion/react'
import type { ElementType, ReactNode } from 'react'
import { useReveal } from '~/lib/use-reveal'
import {
  REVEAL_DISTANCE,
  STAGGER_CLAMP,
  STAGGER_STEP,
  revealVariants,
  springEntrance,
  type RevealVariant,
} from './variants'

interface RevealProps {
  /** fade | up (default) | scale */
  variant?: RevealVariant
  /** Extra entrance delay in seconds. */
  delay?: number
  /** Stagger position — multiplies STAGGER_STEP (clamped). */
  index?: number
  /** Animate once then stop. Default true. */
  once?: boolean
  /** Skip IntersectionObserver and reveal on a time delay (above-the-fold). */
  disabled?: boolean
  /** Rendered element. Default 'div'. */
  as?: ElementType
  className?: string
  style?: MotionStyle
  children: ReactNode
}

/**
 * SSR-safe scroll-reveal wrapper.
 *
 * Server + first client paint render the FINAL (visible) state, so there is
 * never a flash of hidden content if JS is slow/disabled and hydration always
 * matches. Only after mount does the element re-render with a hidden initial
 * state and animate to visible when it scrolls into view. Reduced-motion users
 * always get the final state with no transform. Reveals are transform/opacity
 * only — zero layout shift.
 */
export function Reveal({
  variant = 'up',
  delay = 0,
  index = 0,
  once = true,
  disabled = false,
  as = 'div',
  className,
  style,
  children,
}: RevealProps) {
  const { ref, inView, mounted, reduced } = useReveal({ once, disabled })
  const MotionTag = motion[as as keyof typeof motion] as typeof motion.div

  const animateIn = mounted && !reduced
  const staggerDelay = Math.min(index, STAGGER_CLAMP) * STAGGER_STEP

  return (
    <MotionTag
      ref={ref as never}
      {...(className ? { className } : {})}
      {...(style ? { style } : {})}
      initial={animateIn ? 'hidden' : 'visible'}
      animate={animateIn ? (inView ? 'visible' : 'hidden') : 'visible'}
      variants={revealVariants[variant]}
      transition={{ ...springEntrance, delay: delay + staggerDelay }}
    >
      {children}
    </MotionTag>
  )
}

export { REVEAL_DISTANCE }
