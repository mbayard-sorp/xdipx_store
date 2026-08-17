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

/* ────────────────────────────────────────────────────────────────────────────
 * Multi-slot merchandising fingerprints (ticket #3531).
 *
 * The rails-only gate above caught the recurring `sameness:rails` miss, but a
 * run can just as silently no-op the panel deck, the hero pin, or the couples
 * band (sameness:hero #3225, sameness:couples #3228). These helpers extend the
 * same capture-then-assert contract to the four merchandised slots the daily
 * run owns. Still pure and dependency-free: the Sanity reads live in
 * scripts/rails-fingerprint.ts, these only compare strings.
 * ──────────────────────────────────────────────────────────────────────────── */

export const MERCH_SLOTS = ['rails', 'deck', 'hero', 'couples'] as const
export type MerchSlot = (typeof MERCH_SLOTS)[number]

/** One stable string per merchandised homepage slot. */
export interface MerchSlotFingerprints {
  /** Wired rail ref keys + headings + resolved handle lists, first RENDERED_RAILS. */
  rails: string
  /** `singleton.panelDeck` _updatedAt + tile labels/destinations. Empty = no deck. */
  deck: string
  /** Pinned featured product handle + hero headline. */
  hero: string
  /** Couples band (playTogetherBanner): image ref + copy + resolved handles. */
  couples: string
}

/** A rail as the fingerprint sees it: ref key, heading, resolved handles. */
export interface RailFingerprintInput {
  key: string
  heading: string
  handles: readonly string[]
}

/**
 * Rich rails-slot fingerprint: key + heading + handle list per wired rail, in
 * render order, first `max` (mirrors the slice-then-filter the legacy heading
 * fingerprint uses). Unlike `railsSlateFingerprint`, this moves when a run
 * swaps products inside a rail but keeps the heading — which IS a change and
 * must count as one.
 */
export function railsSlotFingerprint(rails: readonly RailFingerprintInput[], max = RENDERED_RAILS): string {
  return rails
    .slice(0, max)
    .filter((r) => r.heading.trim().length > 0 || r.handles.length > 0)
    .map((r) => `${r.key}#${r.heading.trim()}#${r.handles.join(',')}`)
    .join('|')
}

/** Panel deck fingerprint: publish stamp + every tile's label>destination. */
export function deckSlotFingerprint(
  updatedAt: string | null,
  tiles: readonly { label: string; destination: string }[],
): string {
  if (updatedAt === null && tiles.length === 0) return ''
  const tileParts = tiles.map((t) => `${t.label.trim()}>${t.destination.trim()}`)
  return [updatedAt ?? '', ...tileParts].join('|')
}

/** Hero fingerprint: the pinned handle + the headline. */
export function heroSlotFingerprint(featuredProductHandle: string | null, headline: string | null): string {
  if (!featuredProductHandle && !headline) return ''
  return `${(featuredProductHandle ?? '').trim()}#${(headline ?? '').trim()}`
}

/** Couples band (playTogetherBanner) fingerprint: image + copy + handles. */
export function couplesSlotFingerprint(banner: {
  imageRef: string | null
  heading: string | null
  body: string | null
  handles: readonly string[]
} | null): string {
  if (banner === null) return ''
  return [
    (banner.imageRef ?? '').trim(),
    (banner.heading ?? '').trim(),
    (banner.body ?? '').trim(),
    banner.handles.join(','),
  ].join('#')
}

export interface MerchFreshnessVerdict {
  ok: boolean
  /** Must-change slots that came back byte-identical (or empty). */
  stale: MerchSlot[]
  perSlot: Record<MerchSlot, RailsFreshnessVerdict>
  mustChange: MerchSlot[]
}

/**
 * Compare current slot fingerprints against a baseline. Only the slots in
 * `mustChange` can fail the verdict; the rest are reported but advisory (the
 * panel deck runs a 7-day floor per the mission brief, so it is NOT
 * must-change by default). A slot missing from the baseline is treated as
 * fresh, same as the rails gate's null-baseline rule.
 */
export function evaluateMerchFreshness(
  baseline: Partial<MerchSlotFingerprints> | null,
  current: MerchSlotFingerprints,
  mustChange: readonly MerchSlot[] = ['rails'],
): MerchFreshnessVerdict {
  const perSlot = {} as Record<MerchSlot, RailsFreshnessVerdict>
  for (const slot of MERCH_SLOTS) {
    perSlot[slot] = evaluateRailsFreshness(baseline?.[slot] ?? null, current[slot])
  }
  const stale = mustChange.filter((slot) => !perSlot[slot].fresh)
  return { ok: stale.length === 0, stale: [...stale], perSlot, mustChange: [...mustChange] }
}

/** Parse a `--assert-changed rails,hero` style list. Unknown names throw. */
export function parseMustChangeSlots(raw: string | undefined): MerchSlot[] {
  if (raw === undefined || raw.trim().length === 0) return ['rails']
  const slots = raw.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0)
  for (const s of slots) {
    if (!(MERCH_SLOTS as readonly string[]).includes(s)) {
      throw new Error(`unknown slot "${s}" (expected one of: ${MERCH_SLOTS.join(', ')})`)
    }
  }
  return slots as MerchSlot[]
}
