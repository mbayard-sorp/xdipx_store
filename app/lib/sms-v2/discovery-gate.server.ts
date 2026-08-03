/**
 * discovery-gate.server.ts
 *
 * Pure-function state machine for Emma's discovery progression.
 * Models the gate sequence: MOOD → WHO → MATTERS → READY
 * with two side states:
 *   - EXPLAIN: an advice side-trip that suspends the gate and resumes it after
 *   - vulnerability soft-beat: a flag on the turn (NOT a gate value)
 *
 * Architecture plan: /Users/mikebayard/.claude/plans/i-m-seeing-a-lot-wise-hellman.md
 *
 * Constraints:
 *   - No vendor SDK imports (Anthropic, Twilio, Express, Vercel, Drizzle)
 *   - No I/O, no async, no console logs
 *   - Pure functions only — safe for Oxygen migration
 *
 * Question prose is returned as a sentinel placeholder string (e.g. "<<WHO>>").
 * The calling discovery handler maps these to actual copy bank entries.
 * This keeps copy changes from breaking gate-logic tests.
 */

import type { ProductTypeDial, ProductSubtypeDial } from '../../types/index'

// ─── Re-export upstream types so callers only need this import ────────────────

export type { ProductTypeDial, ProductSubtypeDial }

// ─── Gate values ─────────────────────────────────────────────────────────────

export type DiscoveryGate = 'MOOD' | 'WHO' | 'MATTERS' | 'READY' | 'EXPLAIN'

// ─── Slots ────────────────────────────────────────────────────────────────────

export interface DiscoverySlots {
  category?:               ProductTypeDial
  subtype?:                ProductSubtypeDial
  audience?:               'for-her' | 'for-him' | 'couples' | 'gift'
  experience?:             'first-time' | 'curious' | 'experienced' | 'advanced'
  mood?:                   string[]
  matters?:                string[]
  priceMax?:               number
  isAdviceRequest?:        boolean
  vulnerabilitySignaled?:  boolean
  giftWithNoRecipientHint?: boolean
}

// ─── State ────────────────────────────────────────────────────────────────────

export type DiscoveryState =
  | { gate: 'MOOD';    slots: Partial<DiscoverySlots> }
  | { gate: 'WHO';     slots: Partial<DiscoverySlots> }
  | { gate: 'MATTERS'; slots: Partial<DiscoverySlots> }
  | { gate: 'READY';   slots: Partial<DiscoverySlots> & { audience: NonNullable<DiscoverySlots['audience']> } }
  | { gate: 'EXPLAIN'; resumeGate: 'MOOD' | 'WHO' | 'MATTERS' | 'READY'; slots: Partial<DiscoverySlots> }

// ─── Gate question ────────────────────────────────────────────────────────────

export interface GateQuestion {
  /** Sentinel placeholder — the discovery handler maps this to a copy-bank entry.
   *  Values: "<<MOOD>>", "<<WHO>>", "<<MATTERS>>". Never null here; null lives on
   *  GateAdvancement.question to signal readiness. */
  prose: string
  /** Present only for WHO and MATTERS gates — web renders these as quick-choice pills. */
  quickChoiceOpts?: string[]
  /** Always true — every gate question carries a skip affordance. */
  allowSkip: boolean
}

// ─── Advancement result ───────────────────────────────────────────────────────

export interface GateAdvancement {
  nextState: DiscoveryState
  /** null when the gate machine has enough signal to search immediately. */
  question: GateQuestion | null
  /** true when slots are sufficient even if a gate is technically unfilled
   *  (e.g. customer said "just show me", or all three gates are satisfied). */
  searchNow: boolean
}

// ─── Quick-choice option constants ────────────────────────────────────────────

const WHO_OPTS: string[] = ['For me', 'For a partner', 'For us', 'A gift']

/**
 * Quick-choice pills shown at the MATTERS gate. SMS subset of MATTERS_V2 —
 * Co-Work final sign-off. Filter-test grounded; first-impression friendly.
 * See docs/what-matters-final-signoff.md.
 */
const MATTERS_OPTS: string[] = [
  'Beginner-friendly',
  'Discreet',
  'Waterproof',
  'Hands-free',
  'Just show me',
]

// ─── Sentinel: skip-ahead mood value ─────────────────────────────────────────

/** When the slot extractor sees "just show me" (or equivalent), it sets
 *  mood to this sentinel. advanceGate treats it as a skip-ahead signal.
 *  Exported so telemetry sites can detect the skip cleanly (Migration 036). */
export const SKIP_SENTINEL = 'just-show-me'

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * isHighStakesCategory
 *
 * Returns true for categories where Emma must always ask WHO before searching.
 * High-stakes = anatomically-specific fit concerns: plug, dildo, harness, wear.
 * Other categories (vibrator, lube, wand, stroker, …) can search with partial signal.
 */
export function isHighStakesCategory(
  category: ProductTypeDial | undefined,
): boolean {
  if (category === undefined) return false
  return (
    category === 'anal' ||
    category === 'dildo' ||
    category === 'harness' ||
    category === 'wear'
  )
}

/**
 * mergeSlots
 *
 * Shallow merge with special-case semantics:
 *   - Array fields (mood, matters): concatenated + de-duplicated; incoming appended.
 *   - boolean OR fields (vulnerabilitySignaled, isAdviceRequest): OR'd.
 *   - priceMax: incoming wins if present, otherwise keep existing.
 *   - All other single-value fields: incoming wins if present, otherwise keep existing.
 */
export function mergeSlots(
  existing: Partial<DiscoverySlots>,
  incoming: Partial<DiscoverySlots>,
): Partial<DiscoverySlots> {
  const merged: Partial<DiscoverySlots> = { ...existing }

  // Single-value fields: incoming overrides if defined.
  //
  // subtype is scoped to its category: 'plug' only means something under
  // 'anal', 'wand' only under 'vibrator'. When the category changes and the
  // new message doesn't supply a subtype, the old one is not just stale, it is
  // contradictory — a live conversation carried category=vibrator alongside
  // subtype=plug, which reaches searchProducts as productTypeDial=vibrator +
  // productSubtypeDial=plug and filters every result to zero. Drop it.
  if (incoming.category !== undefined) {
    const categoryChanged = incoming.category !== existing.category
    merged.category = incoming.category
    if (categoryChanged && incoming.subtype === undefined) {
      delete merged.subtype
    }
  }
  if (incoming.subtype  !== undefined)  merged.subtype   = incoming.subtype
  if (incoming.audience !== undefined)  merged.audience  = incoming.audience
  if (incoming.experience !== undefined) merged.experience = incoming.experience

  // priceMax: most-recent non-undefined wins
  if (incoming.priceMax !== undefined) merged.priceMax = incoming.priceMax

  // Boolean OR fields
  if (incoming.vulnerabilitySignaled !== undefined) {
    merged.vulnerabilitySignaled =
      (existing.vulnerabilitySignaled ?? false) || incoming.vulnerabilitySignaled
  }
  if (incoming.isAdviceRequest !== undefined) {
    merged.isAdviceRequest =
      (existing.isAdviceRequest ?? false) || incoming.isAdviceRequest
  }
  if (incoming.giftWithNoRecipientHint !== undefined) {
    merged.giftWithNoRecipientHint =
      (existing.giftWithNoRecipientHint ?? false) || incoming.giftWithNoRecipientHint
  }

  // Array fields: concatenate + de-duplicate (order: existing first, then new)
  if (incoming.mood !== undefined) {
    const base = existing.mood ?? []
    const combined = [...base, ...incoming.mood]
    merged.mood = [...new Set(combined)]
  }
  if (incoming.matters !== undefined) {
    const base = existing.matters ?? []
    const combined = [...base, ...incoming.matters]
    merged.matters = [...new Set(combined)]
  }

  return merged
}

// ─── State initialiser ────────────────────────────────────────────────────────

/** Returns a fresh gate state at MOOD with empty slots. */
export function initDiscoveryState(): DiscoveryState {
  return { gate: 'MOOD', slots: {} }
}

// ─── Gate question builders ───────────────────────────────────────────────────

function moodQuestion(): GateQuestion {
  return { prose: '<<MOOD>>', allowSkip: true }
}

function whoQuestion(): GateQuestion {
  return { prose: '<<WHO>>', quickChoiceOpts: WHO_OPTS, allowSkip: true }
}

function mattersQuestion(): GateQuestion {
  return { prose: '<<MATTERS>>', quickChoiceOpts: MATTERS_OPTS, allowSkip: true }
}

// ─── Core advancement logic ───────────────────────────────────────────────────

/**
 * advanceGate
 *
 * Computes the next DiscoveryState given the current state and a new batch of
 * incoming slots extracted from the customer's latest message.
 *
 * Gate-advancement rules (evaluated in priority order):
 *
 *  0. null current → treat as initDiscoveryState().
 *  1. EXPLAIN current → caller must use resumeFromExplain(); return unchanged.
 *  2. Skip-ahead sentinel (mood contains 'just-show-me') → searchNow=true at
 *     whatever gate we're at; do not advance further.
 *  3. All three signals present (category + audience + mood-or-matters) → READY.
 *  4. High-stakes category + no audience → WHO (anatomical fit concern).
 *  5. audience present but no mood → MATTERS (audience is strong; skip MOOD).
 *  6. mood present but no audience → WHO.
 *  7. mood + audience but no matters → MATTERS.
 *  8. category present (non-high-stakes) + no audience → WHO (need to know who).
 *  9. Default → stay at MOOD.
 *
 * Note on rule 8: even non-high-stakes categories benefit from knowing the audience
 * before searching. We jump to WHO rather than asking an open MOOD question when
 * the customer has already named what they want. This is documented explicitly in
 * the test suite.
 */
export function advanceGate(
  current: DiscoveryState | null,
  incoming: Partial<DiscoverySlots>,
): GateAdvancement {
  // Rule 0: null current
  const base: DiscoveryState = current ?? initDiscoveryState()

  // Rule 1: EXPLAIN state — caller must drive resumption
  if (base.gate === 'EXPLAIN') {
    return {
      nextState: base,
      question: null,
      searchNow: false,
    }
  }

  const merged = mergeSlots(base.slots, incoming)

  // Rule 2: skip-ahead sentinel
  const hasSkip = merged.mood?.includes(SKIP_SENTINEL) ?? false
  if (hasSkip) {
    // Stay at current gate but signal caller to search now with whatever slots exist
    const nextState: DiscoveryState = { gate: base.gate, slots: merged } as DiscoveryState
    return {
      nextState,
      question: null,
      searchNow: true,
    }
  }

  const hasCategory  = merged.category  !== undefined
  const hasAudience  = merged.audience  !== undefined
  const hasMood      = (merged.mood?.length ?? 0) > 0
  const hasMatters   = (merged.matters?.length ?? 0) > 0

  // Rule 3: all three core signals — advance to READY
  if (hasCategory && hasAudience && (hasMood || hasMatters)) {
    // READY requires audience to be non-nullable
    const audience = merged.audience!
    return {
      nextState: { gate: 'READY', slots: { ...merged, audience } },
      question: null,
      searchNow: true,
    }
  }

  // Rule 4: high-stakes category, audience unknown — must ask WHO
  if (hasCategory && isHighStakesCategory(merged.category) && !hasAudience) {
    return {
      nextState: { gate: 'WHO', slots: merged },
      question: whoQuestion(),
      searchNow: false,
    }
  }

  // Rule 5: audience known but no mood yet — skip MOOD, ask MATTERS
  if (hasAudience && !hasMood && !hasMatters) {
    return {
      nextState: { gate: 'MATTERS', slots: merged },
      question: mattersQuestion(),
      searchNow: false,
    }
  }

  // Rule 6: mood known but no audience — ask WHO
  if (hasMood && !hasAudience) {
    return {
      nextState: { gate: 'WHO', slots: merged },
      question: whoQuestion(),
      searchNow: false,
    }
  }

  // Rule 7: mood + audience, no matters — ask MATTERS
  if (hasMood && hasAudience && !hasMatters) {
    return {
      nextState: { gate: 'MATTERS', slots: merged },
      question: mattersQuestion(),
      searchNow: false,
    }
  }

  // Rule 8: non-high-stakes category named but no audience — jump to WHO
  // Rationale: customer has already told us what they want; the next most useful
  // question is who it's for rather than an open mood question.
  if (hasCategory && !isHighStakesCategory(merged.category) && !hasAudience) {
    return {
      nextState: { gate: 'WHO', slots: merged },
      question: whoQuestion(),
      searchNow: false,
    }
  }

  // Rule 9: default — stay at MOOD
  return {
    nextState: { gate: 'MOOD', slots: merged },
    question: moodQuestion(),
    searchNow: false,
  }
}

// ─── EXPLAIN side-trip ────────────────────────────────────────────────────────

/**
 * suspendForExplain
 *
 * Wraps the current state as an EXPLAIN gate, preserving slots and recording
 * the gate to resume to. Idempotent: if already EXPLAIN, keeps the existing
 * resumeGate (i.e. a second suspend does not overwrite the original resume target).
 */
export function suspendForExplain(current: DiscoveryState): DiscoveryState {
  if (current.gate === 'EXPLAIN') {
    // Already suspended — do not overwrite the original resumeGate
    return current
  }
  const resumeGate = current.gate as 'MOOD' | 'WHO' | 'MATTERS' | 'READY'
  return { gate: 'EXPLAIN', resumeGate, slots: current.slots }
}

/**
 * resumeFromExplain
 *
 * Reconstructs the pre-explain state from an EXPLAIN state. Slots carry forward
 * so any signals captured during the explain turn are preserved.
 */
export function resumeFromExplain(
  current: DiscoveryState & { gate: 'EXPLAIN' },
): DiscoveryState {
  const { resumeGate, slots } = current

  if (resumeGate === 'READY') {
    // READY requires audience — if it was present when we suspended, it's still here
    const audience = slots.audience
    if (audience !== undefined) {
      return { gate: 'READY', slots: { ...slots, audience } }
    }
    // Audience was lost somehow — fall back to MATTERS
    return { gate: 'MATTERS', slots }
  }

  return { gate: resumeGate, slots }
}
