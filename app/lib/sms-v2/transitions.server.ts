import type { Stage } from './types.server'

export const STAGE_TRANSITIONS: Record<Stage, ReadonlyArray<Stage>> = {
  GREETING:       ['CONSENT_GATE', 'DISCOVERY', 'RECONNECT'],
  CONSENT_GATE:   ['DISCOVERY'],
  DISCOVERY:      ['RESEARCH', 'PRESENTATION', 'SUPPORT'],
  RESEARCH:       ['DISCOVERY', 'PRESENTATION'],
  PRESENTATION:   ['OBJECTION', 'UPSELL', 'CHECKOUT', 'DISCOVERY'],
  OBJECTION:      ['PRESENTATION', 'UPSELL', 'CHECKOUT', 'DISCOVERY'],
  UPSELL:         ['CHECKOUT', 'POST_CHECKOUT'],
  CHECKOUT:       ['POST_CHECKOUT'],
  POST_CHECKOUT:  ['POST_PURCHASE', 'DISCOVERY'],
  POST_PURCHASE:  ['SUPPORT', 'POST_PURCHASE', 'DISCOVERY'],
  SUPPORT:        ['POST_PURCHASE', 'DISCOVERY'],
  RECONNECT:      ['DISCOVERY', 'POST_PURCHASE', 'SUPPORT'],
}

export function isValidTransition(from: Stage, to: Stage): boolean {
  if (from === to) return true
  return (STAGE_TRANSITIONS[from] as ReadonlyArray<Stage>).includes(to)
}

/**
 * Validate a proposed stage transition. If invalid, logs a warning and returns
 * DISCOVERY as the safe fallback (per Phase 1 plan).
 */
export function resolveTransition(from: Stage, proposed: Stage): Stage {
  if (isValidTransition(from, proposed)) return proposed
  console.warn(
    `[sms-v2/transitions] illegal transition ${from} → ${proposed}, falling back to DISCOVERY`,
  )
  return 'DISCOVERY'
}
