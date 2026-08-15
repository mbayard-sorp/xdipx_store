/**
 * rails-freshness.ts
 *
 * The shared primitive for "did the homepage rails slot actually change this
 * run?". It exists to give the daily merchandiser a definition-of-done gate for
 * rail freshness, the root-cause tooling behind the recurring `sameness:rails`
 * miss (ticket #2080): the homepage-healthcheck cron detects the stale slot
 * after the fact and files a ticket, but nothing lets the merchandising run
 * catch its own no-op before it publishes.
 *
 * This is deliberately pure and dependency-free so both a server module and a
 * standalone `tsx` script (scripts/rails-fingerprint.ts) can import it. The
 * fingerprint formula is kept byte-for-byte identical to the one the healthcheck
 * uses in `app/lib/homepage-healthcheck.server.ts` (`extractPublishedSlate` →
 * `railTitles`, joined with `|`), so a slate this module calls "fresh" is the
 * same slate the detector would call changed. If one formula moves, move both.
 */

/**
 * The storefront renders at most this many `emmaCuratedRail` blocks
 * (`MAX_TEAM_RAILS` in `StorefrontHome.tsx`, `RENDERED_TEAM_RAILS` in the
 * healthcheck). The fingerprint only covers what actually renders.
 */
export const RENDERED_RAILS = 4

/**
 * Fingerprint the rails slate from its ordered rail headings. Pass the headings
 * of the wired rails in render order, including any empties (they are dropped
 * AFTER the first `max` are taken, exactly as the healthcheck slices the raw
 * rail blocks before filtering). The result is stable and comparable across
 * runs: two runs with the same first-`max` non-empty headings, in the same
 * order, produce the same string.
 */
export function railsSlateFingerprint(headings: readonly string[], max = RENDERED_RAILS): string {
  return headings
    .slice(0, max)
    .map((h) => h.trim())
    .filter((h) => h.length > 0)
    .join('|')
}

export interface RailsFreshnessVerdict {
  /** True when the slate is non-empty and differs from the baseline. */
  fresh: boolean
  current: string
  previous: string | null
  /** Human-readable reason, for the run log / DOD output. */
  reason: string
}

/**
 * Compare a freshly-published rails fingerprint against the baseline captured
 * before the run touched the slot. A null baseline (nothing to compare against)
 * is treated as fresh so a first run is never falsely blocked; an empty current
 * slate is never fresh (the run wired no rails, which is itself a failure the
 * gate should surface).
 */
export function evaluateRailsFreshness(previous: string | null, current: string): RailsFreshnessVerdict {
  if (current.length === 0) {
    return { fresh: false, current, previous, reason: 'empty rails slate: no wired rails rendered' }
  }
  if (previous === null) {
    return { fresh: true, current, previous, reason: 'no baseline to compare against; treated as fresh' }
  }
  if (previous === current) {
    return { fresh: false, current, previous, reason: 'rails slate is byte-identical to the baseline' }
  }
  return { fresh: true, current, previous, reason: 'rails slate changed' }
}
