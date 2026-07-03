/**
 * Preset deep links for `/discover?preset=<slug>`.
 *
 * Each preset resolves to an initial `DiscoveryState` selection (mood /
 * audience / matters chips pre-applied) so a shared link lands with the
 * shelf already shaped, no taps required.
 *
 * Values MUST be real, live chip vocabulary (Shopify xdipx.mood_tags /
 * audience_tags / matters_tags metafields, canonicalized through
 * `normalizeTag` — see `app/lib/discovery-tags.ts`). Verified live via
 * `scripts/dump-discovery-vocab.ts` on 2026-07-02:
 *   mood:     Curious, Tender, Comforting, Slow-And-Intimate, ...
 *   audience: Couples, Solo, ...
 *   matters:  Hands-Free, Rechargeable, ...
 *
 * Do not invent vocab values here — anything not present in the live
 * Shopify metafield set simply matches zero products and the rail falls
 * back to its relaxed/empty state.
 */

import { normalizeTag } from '~/lib/discovery-tags'
import { DEFAULT_BUDGET, type DiscoveryState } from '~/types/discovery'

export type PresetSlug =
  | 'just-curious'
  | 'slow-nights'
  | 'for-two'
  | 'hands-free'
  | 'surprise-me'

/** Preset selection — a partial DiscoveryState. Budget/step always default. */
type PresetSelection = Pick<DiscoveryState, 'mood' | 'audience' | 'matters'>

function preset(sel: Partial<PresetSelection>): PresetSelection {
  return {
    mood:     (sel.mood ?? []).map(normalizeTag),
    audience: (sel.audience ?? []).map(normalizeTag),
    matters:  (sel.matters ?? []).map(normalizeTag),
  }
}

/**
 * PRESETS — deep-link slug → initial chip selection.
 *
 *   just-curious  → mood: Curious. Low-commitment browsing, matches the
 *                   "just-curious" audience-tag naming convention used
 *                   elsewhere in the vocab (kept to mood here since the
 *                   slug describes a feeling, not a relationship status).
 *   slow-nights   → mood: Tender + Slow-And-Intimate. Unhurried, comforting.
 *   for-two       → audience: Couples. Direct vocab match.
 *   hands-free    → matters: Hands-Free. Direct vocab match.
 *   surprise-me   → no chips (EMPTY_STATE selection); the caller seeds a
 *                   randomized rail shuffle instead of a filtered brief.
 */
export const PRESETS: Record<PresetSlug, PresetSelection> = {
  'just-curious': preset({ mood: ['Curious'] }),
  'slow-nights':  preset({ mood: ['Tender', 'Slow-And-Intimate'] }),
  'for-two':      preset({ audience: ['Couples'] }),
  'hands-free':   preset({ matters: ['Hands-Free'] }),
  'surprise-me':  preset({}),
}

const PRESET_SLUGS = new Set<string>(Object.keys(PRESETS))

export function isPresetSlug(v: string | null): v is PresetSlug {
  return !!v && PRESET_SLUGS.has(v)
}

/**
 * Resolve a raw `?preset=` query value into a full DiscoveryState ready to
 * seed `DiscoveryProvider`. Returns null for unknown/missing slugs so the
 * caller can fall back to the bare (empty) page unchanged.
 */
export function resolvePresetState(raw: string | null): DiscoveryState | null {
  if (!isPresetSlug(raw)) return null
  const sel = PRESETS[raw]
  return {
    mood:     sel.mood,
    audience: sel.audience,
    matters:  sel.matters,
    budget:   DEFAULT_BUDGET,
    step:     0,
  }
}

/** True when a preset resolves to no chips at all (the "surprise me" case). */
export function isEmptyPresetState(state: DiscoveryState): boolean {
  return state.mood.length === 0 && state.audience.length === 0 && state.matters.length === 0
}
