import type { Transition, Variants } from 'motion/react'

/**
 * Shared motion presets. Numerics mirror the CSS motion tokens in app/app.css
 * (--ease-entrance / --duration-slow / --reveal-distance) so JS-driven and
 * CSS-driven motion feel identical. Springs can't read CSS vars, so parity is
 * maintained by hand — keep these in sync if the tokens change.
 */

/** Weighted entrance spring — settles with body, never bouncy. */
export const springEntrance: Transition = {
  type: 'spring',
  stiffness: 220,
  damping: 30,
  mass: 0.9,
}

/** Subtle, editorial travel distance for "up" reveals (px). Mirrors --reveal-distance. */
export const REVEAL_DISTANCE = 16

/** Seconds between staggered siblings. Small — reading rhythm wins. */
export const STAGGER_STEP = 0.06

/** Max stagger index so long grids don't lag the last item. */
export const STAGGER_CLAMP = 8

export type RevealVariant = 'fade' | 'up' | 'scale'

export const revealVariants: Record<RevealVariant, Variants> = {
  fade: {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  },
  up: {
    hidden: { opacity: 0, y: REVEAL_DISTANCE },
    visible: { opacity: 1, y: 0 },
  },
  scale: {
    hidden: { opacity: 0, scale: 0.97 },
    visible: { opacity: 1, scale: 1 },
  },
}

/**
 * Parent variants for staged child entrances (e.g. the hero text column).
 * Pair with `childItem` on each child. `delayChildren` offsets the whole group.
 */
export function staggerParent(
  delayChildren = 0.05,
  staggerChildren = STAGGER_STEP,
): Variants {
  return {
    hidden: {},
    visible: {
      transition: { delayChildren, staggerChildren },
    },
  }
}

/** Child item for a staggerParent group. Defaults to the "up" feel. */
export const childItem: Variants = revealVariants.up

/**
 * One-shot brand "heartbeat" for the ♥ motif. Fires once on entrance, never
 * loops. Use sparingly — one signature beat per page.
 */
export const heartbeat: Variants = {
  hidden: { scale: 1 },
  visible: {
    scale: [1, 1.15, 1],
    transition: { duration: 0.5, ease: 'easeOut', times: [0, 0.45, 1] },
  },
}
