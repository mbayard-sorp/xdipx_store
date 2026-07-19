/**
 * Server-side data assembly for the homepage Sensation Map instrument.
 *
 * Thin wrapper over the live discovery index: derives the Type + Feel dial
 * notches, the SSR default dial state, and the default matched product set for
 * the loader, plus a single-state matcher for the `/api/sensation-map` resource
 * route. All matching logic is pure and lives in `~/lib/sensation-map`.
 *
 * Server-only (`.server.ts`): never import from a client component.
 */

import { getDiscoveryIndex, computeVocab } from '~/lib/discovery.server'
import {
  deriveTypeNotches,
  deriveFeelNotches,
  defaultSensationState,
  matchSensationMap,
  type TypeNotch,
  type SensationDialState,
  type SensationMatch,
} from '~/lib/sensation-map'

export interface SensationMapData {
  types: TypeNotch[]
  feels: string[]
  /** Null on a cold/empty index — the caller then skips rendering the band. */
  defaultState: SensationDialState | null
  /** The SSR-visible default result set (present iff defaultState is). */
  defaultMatch: SensationMatch | null
}

/**
 * Assemble the loader payload. Reads the discovery index once (already warmed by
 * the rails call in `assembleStorefrontHome`, so this is an in-memory hit) and
 * derives the vocab from that same snapshot with `computeVocab`, so the notches
 * and the matched set are always consistent with each other.
 */
export async function getSensationMapData(): Promise<SensationMapData> {
  const index = await getDiscoveryIndex()
  if (index.length === 0) {
    return { types: [], feels: [], defaultState: null, defaultMatch: null }
  }

  const types = deriveTypeNotches(index)
  const feels = deriveFeelNotches(computeVocab(index).moods)
  const defaultState = defaultSensationState(types, feels)
  const defaultMatch = defaultState ? matchSensationMap(index, defaultState) : null

  return { types, feels, defaultState, defaultMatch }
}

/** Resource-route matcher: resolve one validated dial state against the index. */
export async function matchSensationMapState(state: SensationDialState): Promise<SensationMatch> {
  const index = await getDiscoveryIndex()
  return matchSensationMap(index, state)
}
