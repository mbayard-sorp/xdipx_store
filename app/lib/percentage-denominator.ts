/**
 * Deterministic pre-flight for the percentage/denominator-incoherence
 * construction: a draft states a percentage figure alongside an integer
 * population count, and the percentage is not arithmetically reachable from
 * that count. Sibling of app/lib/unsourced-frequency.ts: the same
 * draft-flattening machinery (`app/lib/aphorism-closer.ts`'s
 * `draftToParagraphs`/`splitSentences`), a different greppable tell.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * Second nameable occurrence of the brief/announcement-figure denominator
 * class. Ticket #14798 (content run 1377) found a trendTopicBrief figure that
 * turned out to be a partnered-sex subsample rather than the masturbation
 * figure, and recorded the standing lesson that a bare percentage with no
 * stated denominator or subsample scope is unsafe to draft from. Content run
 * 2144 (2026-11-21, can-a-vibrator-help-with-menopause-symptoms) is the
 * second occurrence: the draft paired "researchers recruited 66 women" with
 * "92.9 percent experienced at least one symptom less frequently", and the
 * FAQ paired them outright ("a study of 66 women reported that 92.9
 * percent..."). 92.9 percent of 66 is 61.314, and no whole number of 66
 * people rounds to 92.9 percent (61/66 is 92.4%, 62/66 is 93.9%), so the
 * figure provably was not computed over the 66 enrolled, and the source
 * announcement states no denominator for it. All six existing deterministic
 * checkers exited 0, because every one of them models wording, not
 * arithmetic; it was caught only by sex-wellness-reviewer doing the division
 * by hand.
 *
 * ── What this flags ──────────────────────────────────────────────────────
 * A percentage figure ("92.9 percent", "92.9%") that co-occurs, within a
 * configurable window of paragraphs (default: the same or an adjacent
 * block), with an integer N immediately followed (optionally through a
 * connector like "of"/"enrolled") by a population noun ("66 women",
 * "recruited 61 participants"). A hit is when the percentage is not within
 * half its own written rounding unit of the percentage implied by the
 * NEAREST whole-person count against N — i.e. no realistic headcount over N
 * produces the stated percentage.
 *
 * ── What this deliberately does NOT flag ─────────────────────────────────
 *   - A percentage with no population count nearby in the window: nothing to
 *     check it against, so it is a PASS, not a hit.
 *   - A "percentage of a percentage" ("92.9 percent of the 61 percent who
 *     already track symptoms"): the chained number is followed by "percent",
 *     not a population noun, so it is never extracted as a denominator N in
 *     the first place.
 *
 * ── Limit ────────────────────────────────────────────────────────────────
 * Zero. Any candidate trips the checker (exit 1 from the CLI), the same
 * convention as the aphorism/antithesis/unsourced-frequency checkers.
 */

import { draftToParagraphs, splitSentences, type DraftInput, type DraftParagraph } from './aphorism-closer'

export type { DraftInput, DraftParagraph }

/** Population nouns a bare headcount is plausibly reported against. */
const POPULATION_NOUN =
  'women|men|people|persons?|participants?|patients?|respondents?|subjects?|adults?|couples?|students?|users?|customers?|readers?|volunteers?|individuals?'

/** Connector words tolerated between the integer and the population noun. */
const CONNECTOR = 'of|total|enrolled|surveyed|recruited|randomized|interviewed|sampled'

/**
 * An integer not already part of a decimal number (`(?!\.\d)` blocks "92" out
 * of "92.9"), directly followed, optionally through one connector word, by a
 * population noun. Deliberately does NOT match when a percentage sign or the
 * word "percent" sits between the number and the noun — that is the
 * percentage-of-a-percentage case, which this checker must never read as a
 * denominator.
 */
const DENOMINATOR_RE = new RegExp(
  `\\b(\\d{1,7})\\b(?!\\.\\d)(?:\\s+(?:${CONNECTOR}))?\\s+(?:${POPULATION_NOUN})\\b`,
  'gi',
)

/**
 * A percentage figure, written as "92.9%" or "92.9 percent". The `\b` guards
 * only the "percent" branch (so "percentage" is never mistaken for
 * "percent") — "%" needs no trailing boundary, since it is non-word on both
 * sides of itself and a `\b` there would never match.
 */
const PERCENTAGE_RE = /\b(\d+(?:\.\d+)?)\s*(?:%|percent\b)/gi

/** How many paragraphs away a denominator may sit from a percentage and still count as nearby. */
export const DEFAULT_WINDOW = 1

export interface PercentageCandidate {
  /** The written percentage value, e.g. 92.9. */
  value: number
  /** The exact substring matched, e.g. "92.9 percent". */
  raw: string
  /** Decimal digits in the written value (92.9 → 1), used as the rounding unit. */
  decimals: number
  paragraphIndex: number
  section: string
  sentence: string
}

export interface DenominatorCandidate {
  /** The integer population count, e.g. 66. */
  n: number
  /** The exact substring matched, e.g. "66 women". */
  raw: string
  paragraphIndex: number
  section: string
  sentence: string
}

/** Scan one sentence for every percentage figure it states. */
export function findPercentages(sentence: string): Omit<PercentageCandidate, 'paragraphIndex' | 'section'>[] {
  const hits: Omit<PercentageCandidate, 'paragraphIndex' | 'section'>[] = []
  for (const m of sentence.matchAll(PERCENTAGE_RE)) {
    const digits = m[1]!
    const decimalPart = digits.split('.')[1] ?? ''
    hits.push({ value: Number.parseFloat(digits), raw: m[0], decimals: decimalPart.length, sentence })
  }
  return hits
}

/** Scan one sentence for every integer-near-a-population-noun denominator it states. */
export function findDenominators(sentence: string): Omit<DenominatorCandidate, 'paragraphIndex' | 'section'>[] {
  const hits: Omit<DenominatorCandidate, 'paragraphIndex' | 'section'>[] = []
  for (const m of sentence.matchAll(DENOMINATOR_RE)) {
    hits.push({ n: Number.parseInt(m[1]!, 10), raw: m[0], sentence })
  }
  return hits
}

export interface DenominatorHit {
  percentage: PercentageCandidate
  denominator: DenominatorCandidate
  /** The nearest whole-person count against N that the written percentage could mean. */
  impliedCount: number
  /** That count's own percentage of N, for reviewer context. */
  impliedPercentage: number
}

export interface DenominatorReport {
  hits: DenominatorHit[]
  total: number
  /** True when any candidate was flagged (the limit is zero). */
  overLimit: boolean
}

/**
 * True when `pct` is arithmetically reachable from `denom.n`: the nearest
 * whole-person count against N lands within half of `pct`'s own written
 * rounding unit (92.9 was written to one decimal, so its true value could be
 * anywhere in [92.85, 92.95) — half a unit either side of the stated figure).
 */
function isCoherent(pct: PercentageCandidate, denom: DenominatorCandidate): boolean {
  if (denom.n <= 0) return true // nothing to check against
  const halfUnit = 0.5 * 10 ** -pct.decimals
  const impliedCount = Math.round((pct.value / 100) * denom.n)
  const impliedPercentage = (impliedCount / denom.n) * 100
  return Math.abs(impliedPercentage - pct.value) <= halfUnit + 1e-9
}

export function analyzeParagraphs(paragraphs: DraftParagraph[], window = DEFAULT_WINDOW): DenominatorReport {
  const percentages: PercentageCandidate[] = []
  const denominators: DenominatorCandidate[] = []

  paragraphs.forEach((para, paragraphIndex) => {
    for (const sentence of splitSentences(para.text)) {
      for (const p of findPercentages(sentence)) {
        percentages.push({ ...p, paragraphIndex, section: para.section })
      }
      for (const d of findDenominators(sentence)) {
        denominators.push({ ...d, paragraphIndex, section: para.section })
      }
    }
  })

  const hits: DenominatorHit[] = []
  for (const pct of percentages) {
    const nearby = denominators
      .filter((d) => Math.abs(d.paragraphIndex - pct.paragraphIndex) <= window)
      .sort(
        (a, b) =>
          Math.abs(a.paragraphIndex - pct.paragraphIndex) - Math.abs(b.paragraphIndex - pct.paragraphIndex),
      )
    if (nearby.length === 0) continue // no denominator nearby: nothing to check, PASS

    const denom = nearby[0]!
    if (isCoherent(pct, denom)) continue

    const impliedCount = Math.round((pct.value / 100) * denom.n)
    hits.push({
      percentage: pct,
      denominator: denom,
      impliedCount,
      impliedPercentage: (impliedCount / denom.n) * 100,
    })
  }

  return { hits, total: hits.length, overLimit: hits.length > 0 }
}

/** Convenience: analyze a raw draft (title + excerpt + seoTitle + seoDescription + portable-text body). */
export function analyzeDraft(draft: DraftInput, window = DEFAULT_WINDOW): DenominatorReport {
  return analyzeParagraphs(draftToParagraphs(draft), window)
}
