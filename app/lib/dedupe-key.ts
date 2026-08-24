/**
 * Dedupe-key canonicalization and near-duplicate detection.
 *
 * The improvement bus and the owner blocker list both dedupe a recurring
 * signal by exact string match on a caller-supplied `dedupe_key`. That works
 * only when every filer picks the same string, and in practice they do not.
 * On 2026-08-24 one defect (`/api/team/conversion-status` 500ing because
 * migration 082 was never applied) occupied four rows under four keys:
 *
 *   tickets   conversion-status-500-regression
 *             qa:conversion-status-500-2026-08-24
 *   blockers  migration-082-outbox-rename-unapplied
 *             apply-migration-082-capi-outbox-rename
 *
 * Two separate failures are visible there, and they need different fixes.
 *
 *  1. **The date stamp.** `qa:conversion-status-500-2026-08-24` cannot dedupe
 *     against itself tomorrow — the key is different by construction, so a
 *     daily check files a fresh row every single day forever. This is
 *     mechanical and is fixed mechanically: a `recurring` key drops date
 *     stamps during canonicalization.
 *
 *     Dates are NOT stripped unconditionally, because at least one caller
 *     means it. `import-enrich.server.ts` files `new-products:enrich:<day>`
 *     for "the products that went live today", which is genuinely one work
 *     item per day. Those callers declare `scope: 'daily'` and keep the date.
 *     Intent is declared, never guessed: the two key shapes are identical, so
 *     no amount of string inspection can tell them apart.
 *
 *  2. **The wording.** `conversion-status-500-regression` and
 *     `qa:conversion-status-500-...` describe one defect in two vocabularies.
 *     No canonicalizer can merge those without also merging things that
 *     genuinely differ, so this half is deliberately ADVISORY: findNearDuplicate
 *     surfaces the suspected twin and the caller records a note. Nothing here
 *     ever merges, dismisses, or rewrites a row on a fuzzy match.
 *
 * Pure module (no DB, no IO) so both the ticket bus and the blocker list can
 * share it and so the interesting cases are unit-testable.
 */

/** `dedupe_key` is varchar(64) on homepage_team_suggestions (migration 070). */
export const MAX_DEDUPE_KEY_LENGTH = 64

/**
 * Whether a key identifies an ongoing condition or one day's occurrence.
 *
 * `recurring` (the default) means "this signal, whenever it trips" — the same
 * condition tomorrow must land on the same row, so a date stamp is dropped.
 * `daily` means "this day's instance of this work" and keeps its date.
 */
export type DedupeScope = 'recurring' | 'daily'

/**
 * ISO-ish date stamps: 2026-08-24, 2026/08/24, 2026-08, 20260824.
 *
 * Bounded to plausible calendar values (year 20xx, month 01-12, day 01-31) so
 * an 8-digit product id or a 4-digit ticket number is not mistaken for a date.
 * The bare `\d{4}` year form is deliberately NOT matched: too many real keys
 * carry a numeric id in that range, so a month is always required.
 *
 * Matched against the whole slugged key rather than against a token, because
 * `-` is both a date separator and a key separator — splitting first turns
 * `2026-08-24` into three innocuous-looking numbers and the stamp escapes.
 */
const DATE_STAMP_RE =
  /(?<=^|[-:._/])20\d{2}[-/.]?(?:0[1-9]|1[0-2])(?:[-/.]?(?:0[1-9]|[12]\d|3[01]))?(?=$|[-:._/])/g

/** Remove every date stamp from an already-slugged key. */
function stripDateStamps(slugged: string): string {
  return slugged
    .replace(DATE_STAMP_RE, '')
    .replace(/[-:._/]{2,}/g, '-')
    .replace(/^[-:._/]+|[-:._/]+$/g, '')
}

/** Separators that delimit parts of a key: `ns:detail-detail/more.thing`. */
const SEPARATORS = /[-:._/\s]+/

/**
 * Tokens that carry no identity — they describe that something is wrong, not
 * what is wrong. Dropped for SIMILARITY SCORING ONLY; the stored key keeps
 * them so existing rows stay recognizable to a human reading the queue.
 *
 * Lane prefixes (`qa`, `rdev`) live here on purpose: which routine noticed a
 * defect is not part of the defect's identity, and treating it as part of the
 * identity is precisely how one bug became two tickets.
 */
const NOISE_TOKENS = new Set([
  'a', 'an', 'the', 'to', 'of', 'for', 'in', 'on', 'is', 'and',
  'bug', 'issue', 'error', 'errors', 'fail', 'failed', 'failure', 'failures',
  'broken', 'regression', 'problem', 'fix', 'apply', 'unapplied', 'missing',
  'p0', 'p1', 'p2', 'p3', 'qa', 'rdev', 'rqa', 'shep', 'watch', 'agent',
  'daily', 'weekly', 'hourly', 'today', 'yesterday', 'sweep', 'check',
])

/** Lowercase, collapse to a key-safe alphabet, trim separator runs. */
function slug(part: string): string {
  return part
    .toLowerCase()
    .replace(/[^a-z0-9._/:-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-:._/]+|[-:._/]+$/g, '')
}

/**
 * Stable, non-cryptographic hash (djb2 -> base36), matching the one in
 * detection-tickets.server.ts. Deterministic across processes and deploys,
 * which is the whole requirement: the same signal tomorrow hashes the same.
 */
export function hashToken(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0
  }
  return h.toString(36)
}

/**
 * Canonical form of a dedupe key: lowercased, slugged, separator-normalized,
 * date-stripped when the scope is `recurring`, and capped at 64 characters
 * with a hash suffix derived from the full pre-truncation key (so two long
 * keys sharing a prefix still dedupe apart).
 *
 * Idempotent: canonical(canonical(k)) === canonical(k), which matters because
 * this runs on both the write path and the lookup path.
 */
export function canonicalDedupeKey(
  raw: string,
  opts: { scope?: DedupeScope; maxLength?: number } = {},
): string {
  const scope = opts.scope ?? 'recurring'
  // owner_blockers.dedupe_key is varchar(80); the ticket bus is varchar(64).
  const max = opts.maxLength ?? MAX_DEDUPE_KEY_LENGTH
  const slugged = slug(raw)
  const dated = scope === 'daily' ? slugged : stripDateStamps(slugged)
  const parts = dated.split(SEPARATORS).filter(p => p.length > 0)

  const joined = parts.join('-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '')
  if (joined.length === 0) return ''
  if (joined.length <= max) return joined

  const suffix = `~${hashToken(joined)}`
  return `${joined.slice(0, max - suffix.length).replace(/-+$/, '')}${suffix}`
}

/** True when a `recurring` key carried a date stamp that was dropped. */
export function hadDateStamp(raw: string): boolean {
  const slugged = slug(raw)
  return stripDateStamps(slugged) !== slugged
}

/** Identity-bearing tokens of a key, with noise and date stamps removed. */
export function dedupeTokens(key: string): Set<string> {
  const tokens = stripDateStamps(slug(key))
    .split(SEPARATORS)
    .filter(p => p.length > 0)
    .filter(p => !NOISE_TOKENS.has(p))
  return new Set(tokens)
}

/**
 * Containment score in [0,1]: |A ∩ B| / min(|A|,|B|).
 *
 * Containment rather than Jaccard because the real-world collisions differ by
 * one side carrying extra words (`apply-migration-082-capi-outbox-rename` vs
 * `migration-082-outbox-rename-unapplied`), which Jaccard punishes for length
 * alone. Returns 0 when either side has no identity tokens left.
 */
export function similarity(a: string, b: string): number {
  const ta = dedupeTokens(a)
  const tb = dedupeTokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / Math.min(ta.size, tb.size)
}

/** Default bar for calling two keys suspicious. Tuned in dedupe-key.test.ts. */
export const NEAR_DUPLICATE_THRESHOLD = 0.8

/**
 * Minimum shared identity tokens. Guards against short keys scoring 1.0 off a
 * single common word — `social-token` and `token-unhealthy` share one token
 * and are not the same signal.
 */
const MIN_SHARED_TOKENS = 3

export interface NearDuplicate<T> {
  candidate: T
  key: string
  score: number
}

/**
 * Best near-duplicate of `key` among `existing`, or null.
 *
 * ADVISORY ONLY. An exact-key collision is handled by the unique index before
 * this is ever called; this answers the softer question "did someone already
 * file this under different words", and the honest answer is sometimes wrong.
 * Callers record it as a note for a human to confirm. Never merge on it.
 */
export function findNearDuplicate<T extends { dedupeKey: string | null }>(
  key: string,
  existing: readonly T[],
  threshold: number = NEAR_DUPLICATE_THRESHOLD,
): NearDuplicate<T> | null {
  const tokens = dedupeTokens(key)
  if (tokens.size < MIN_SHARED_TOKENS) return null

  let best: NearDuplicate<T> | null = null
  for (const candidate of existing) {
    const other = candidate.dedupeKey
    if (!other || other === key) continue

    const otherTokens = dedupeTokens(other)
    let shared = 0
    for (const t of tokens) if (otherTokens.has(t)) shared++
    if (shared < MIN_SHARED_TOKENS) continue

    const score = shared / Math.min(tokens.size, otherTokens.size)
    if (score < threshold) continue
    if (!best || score > best.score) best = { candidate, key: other, score }
  }
  return best
}
