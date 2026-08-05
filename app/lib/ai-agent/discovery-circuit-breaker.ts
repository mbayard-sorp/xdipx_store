/**
 * discovery-circuit-breaker.ts
 *
 * Pure helpers for the web-chat discovery-gate circuit breaker.
 *
 * The gate machine (discovery-gate.server.ts) keeps forcing pill questions
 * while the shopper sits at MOOD / WHO / MATTERS and searchNow is false. If the
 * shopper keeps answering without producing a slot the extractor recognises,
 * the gate never advances and the shopper is trapped tapping pills forever with
 * no product ever shown. This module tracks how many consecutive gate turns
 * produced no new discovery signal and trips a breaker so the caller can stop
 * forcing pills and search with whatever it has.
 *
 * Pure functions only — no I/O, no vendor SDKs. Safe to unit test in isolation.
 */

import type {
  DiscoverySlots,
  DiscoveryState,
} from '~/lib/sms-v2/discovery-gate.server'

/** Gates where Emma still forces discovery pills instead of searching. */
const FORCING_GATES: ReadonlySet<DiscoveryState['gate']> = new Set([
  'MOOD',
  'WHO',
  'MATTERS',
])

/**
 * How many consecutive forcing-gate turns with no new discovery signal are
 * allowed before the breaker trips. Two: the shopper gets one nudge, and if the
 * second turn still adds nothing, we stop asking and search.
 */
export const GATE_STALL_LIMIT = 2

/**
 * Count the gate-relevant discovery signals present in a slot bag. These are the
 * four fields advanceGate actually branches on — category, audience, mood, and
 * matters. A turn "makes progress" when this count goes up.
 */
export function slotSignalCount(slots: Partial<DiscoverySlots>): number {
  let n = 0
  if (slots.category !== undefined) n++
  if (slots.audience !== undefined) n++
  if ((slots.mood?.length ?? 0) > 0) n++
  if ((slots.matters?.length ?? 0) > 0) n++
  return n
}

export interface GateStallResult {
  /** Stall count to persist for the next turn. */
  stallCount: number
  /** True once the breaker has tripped: stop forcing pills, search now. */
  circuitBroken: boolean
}

/**
 * evaluateGateStall
 *
 * Pure. Given the prior stall count, the slots we had coming in, the slots after
 * merging this turn's extraction, and the resulting gate + searchNow, decide the
 * next stall count and whether the breaker has tripped.
 *
 *   - searchNow already true, or we've left the forcing gates → not stuck, reset.
 *   - a forcing gate that gained a new signal this turn → progress, reset.
 *   - a forcing gate stuck with no new signal → increment; trip at GATE_STALL_LIMIT.
 */
export function evaluateGateStall(args: {
  priorStallCount: number
  priorSlots: Partial<DiscoverySlots>
  mergedSlots: Partial<DiscoverySlots>
  gate: DiscoveryState['gate']
  searchNow: boolean
}): GateStallResult {
  const { priorStallCount, priorSlots, mergedSlots, gate, searchNow } = args

  // Not stuck: the gate already wants to search, or we're past the forcing
  // gates. Nothing to break out of.
  if (searchNow || !FORCING_GATES.has(gate)) {
    return { stallCount: 0, circuitBroken: false }
  }

  const madeProgress =
    slotSignalCount(mergedSlots) > slotSignalCount(priorSlots)
  if (madeProgress) {
    return { stallCount: 0, circuitBroken: false }
  }

  const base = Number.isFinite(priorStallCount) && priorStallCount > 0
    ? Math.floor(priorStallCount)
    : 0
  const stallCount = base + 1
  return { stallCount, circuitBroken: stallCount >= GATE_STALL_LIMIT }
}

/**
 * Read the persisted stall count back out of the discovery_state json blob.
 * The counter rides inside that blob (see chat.server.ts persistGateState) so it
 * survives across turns without a schema change. Anything malformed reads as 0.
 */
export function readStallCount(discoveryState: unknown): number {
  if (discoveryState && typeof discoveryState === 'object') {
    const v = (discoveryState as { stallCount?: unknown }).stallCount
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      return Math.floor(v)
    }
  }
  return 0
}

/**
 * System-prompt directive injected when the breaker trips. Instructs the model
 * to stop asking and search now. The example opener is the agency-preserving
 * line supplied by emma-empathy-reviewer on the source ticket — keep the
 * shopper in control, never silently override.
 */
export const CIRCUIT_BREAKER_DIRECTIVE =
  'CIRCUIT BREAKER: the shopper has answered more than once without narrowing things down. Do not ask another pill question and do not call askQuickChoice. Run a product search right now using the known slots above. If every slot is still (unknown), search using the shopper’s own words from their latest message. Open your reply by keeping their agency, for example: "Here’s what’s closest to what you described so far. Want me to keep adjusting?" Then show what you found.'
