/**
 * Ticket #21947: the engineering half of bus row #21540 clause (a) — "a
 * sentence mentioning IPX7, plus a water-permission phrase, minus any
 * restriction clause" — built in app/lib/ as a tested pure function, the
 * clause row #21540 itself said does not exist.
 *
 * Mirrors faqGrantsUnrestrictedWater (ipx-faq-remediation.ts), the same
 * three-part shape — mentions the code, grants water use, carries no
 * restriction — but for the Notebook blogPost Portable Text surface instead
 * of a single PDP FAQ answer string, and scoped to IPX7 specifically: an
 * IPX7 mark genuinely covers immersion (a still bath, a basin), so a bath
 * claim on its own is not the defect; the defect is extending it to shower,
 * tap, jet, or running-water coverage, which IPX7 does not certify.
 *
 * Validated against the live corpus (content run 2021, dedupeKey
 * ipx-water-grant-detector): a prototype run against all 120 published posts
 * returned 3 hits, every one reviewed as correct text. The SHIPPED version
 * (PRs #1969, #1962) did not actually implement the paragraph above: it
 * treated a bare `bath`/`basin` mention as a grant needing its own
 * restriction clause, contradicting its own stated design, and measured
 * against the corpus on 2026-11-16 at 8 of 8 findings, every one a false
 * positive on already-corrected safety text (ticket #22377, bus row
 * #21540's note). `GRANTS_WATER_RE` no longer includes `bath`/`basin`,
 * which is the fix. See scripts/audit-ipx7-water-grant.ts for the live
 * sweep this module powers.
 *
 * ── Limit ──────────────────────────────────────────────────────────────────
 * A reusable-token checker, the same shape and the same limit as
 * self-consistency.ts's ingress-code predicates: it can only see a grant
 * sentence that names "IPX7" again. A sentence that refers back to the
 * rating by pronoun or epithet ("that code", "the rating") instead of
 * repeating the token is invisible to it, the same gap self-consistency.ts's
 * own header documents for its wash-instruction case. That gap is real on
 * this corpus (two live sentences found by reading rather than by this
 * checker, filed separately rather than papered over here) and a manual
 * re-read remains necessary; this checker only catches the mechanically
 * decidable slice.
 */

import { draftToParagraphs, splitSentences, type DraftInput, type DraftParagraph } from './aphorism-closer'

export type { DraftInput, DraftParagraph }

const MENTIONS_IPX7_RE = /\bIPX7\b/i

/**
 * A plain grant of shower, running-tap, jet, or unqualified running-water
 * use. Still-water immersion — bath, basin, soaking, submersion — is exactly
 * what an IPX7 mark certifies, so it is never itself a grant that needs a
 * restriction clause; `bath`/`basin` were dropped from this list 2026-11-16
 * (ticket #22377) after they produced 8 of 8 false positives on already-
 * corrected text, a 0 percent precision rate measured against the live
 * corpus (see #21540's note on the same corpus).
 */
const GRANTS_WATER_RE = /\bshower\b|\btap\b|\bjets?\b|running water/i

/**
 * The house restriction wording and its accepted paraphrases: immersion-only
 * scoping, the non-stacking rule, a handoff to the maker's own instruction
 * (ticket #21947's own list), plus three more paraphrases added 2026-11-16
 * (ticket #22377) from real corpus sentences that distinguish a permitted
 * still-water claim from a shower/tap/jet claim without using any phrase
 * already on this list: "do not imply each other" (a non-stacking
 * paraphrase), "rather than under/from/in/at the <surface>" (redirecting the
 * water-safe action away from the flagged surface), and a flagged surface
 * immediately negated in the same sentence ("the shower is not"). Tight by
 * design, the same bar self-consistency.ts's closed vocabularies use — add a
 * phrase here only once a second real incident names it, not because a hit
 * "feels" like it should be excluded.
 */
const RESTRICTS_IPX7_RE =
  /immersion only|does not cover jets|carr(?:y|ies) (?:their|its) own ratings?|do(?:es)? not stack|do(?:es)? not imply (?:each other|one another)|needs? its own rating|written instruction from the maker|(?:toy|maker|manufacturer|brand)'?s own (?:instructions?|manual|care guide|directions)|rather than (?:under|from|in|at) the (?:tap|shower|jets?|code|rating)|\b(?:shower|taps?|jets?|running water)\s+(?:is|are) not\b/i

/**
 * True when a single sentence names IPX7 and grants shower/tap/jet/
 * running-water use with no restriction clause anywhere in that same
 * sentence. A bare bath or basin claim never qualifies — still-water
 * immersion is what IPX7 certifies. A false positive here is cheap —
 * whoever reads the sweep output reads one more sentence that turns out
 * fine; a missed instance is a live safety overreach, so this stays
 * deliberately over-inclusive rather than clever.
 */
export function sentenceGrantsUnrestrictedIpx7Water(sentence: string | null | undefined): boolean {
  if (!sentence) return false
  if (!MENTIONS_IPX7_RE.test(sentence)) return false
  if (!GRANTS_WATER_RE.test(sentence)) return false
  if (RESTRICTS_IPX7_RE.test(sentence)) return false
  return true
}

export interface Ipx7WaterGrantHit {
  section: string
  sentence: string
  paragraphIndex: number
}

/** Scans every sentence of a flattened document for the defect. */
export function findIpx7WaterGrants(paragraphs: DraftParagraph[]): Ipx7WaterGrantHit[] {
  const hits: Ipx7WaterGrantHit[] = []
  paragraphs.forEach((para, paragraphIndex) => {
    for (const sentence of splitSentences(para.text)) {
      if (sentenceGrantsUnrestrictedIpx7Water(sentence)) {
        hits.push({ section: para.section, sentence, paragraphIndex })
      }
    }
  })
  return hits
}

/** Convenience: scan a raw draft (title + excerpt + seoTitle + seoDescription + portable-text body). */
export function findIpx7WaterGrantsInDraft(draft: DraftInput): Ipx7WaterGrantHit[] {
  return findIpx7WaterGrants(draftToParagraphs(draft))
}
