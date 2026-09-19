/**
 * Deterministic pre-count of the "X, not Y" antithesis construction in a
 * Notebook draft, run BEFORE the emma-empathy-reviewer voice gate so the
 * writer trims to the content-plan section 7 caps (2-3 per post, at most 1 on
 * a heading) without a repeat of the divergent hand-counts that prompted this
 * checker (ticket #10116): run 687 shipped eight instances in one post
 * against a clean check-fresh-language.ts result, because that checker
 * compares word 6-grams and the antithesis mold repeats without the words
 * repeating; run 942 hand-counted 2 surviving instances while the voice gate
 * independently counted 5-6, because the writer's manual count excluded every
 * "rather than" construction while the gate counted it as the same
 * rhetorical family, and both missed two heading instances against a cap of
 * 1 on a heading. Sibling of app/lib/aphorism-closer.ts: the same
 * draft-flattening machinery, a different greppable tell.
 *
 * ── What this flags ──────────────────────────────────────────────────────────
 * The charter's binding definition (docs/store-team/content-plan.md, section
 * 7) is a copula or verb, then a comma or full stop, then "not" plus a
 * contrasting noun phrase. Two decidable shapes:
 *
 *   STRONG      — same-sentence comma antithesis: "<clause>, not <phrase>"
 *                 ("a change, not a loss"). Fully structural: a comma
 *                 directly followed by the word "not". Counts toward the caps.
 *   BORDERLINE  — cross-sentence negation/affirmation: a sentence containing a
 *                 negated verb ("does not", "is not", "cannot", ...)
 *                 immediately followed, in the same paragraph, by a short
 *                 sentence with no negation of its own ("It does not lower
 *                 the threshold. It meets it."). Whether the second sentence
 *                 is really the contrasting beat or an unrelated following
 *                 sentence is a judgment call, so this is surfaced but not
 *                 counted, the same borderline/strong split
 *                 app/lib/aphorism-closer.ts uses for its own semantic
 *                 condition.
 *
 * ── What this deliberately does NOT flag ─────────────────────────────────────
 * "Rather than" and "instead of" constructions are a DIFFERENT rhetorical
 * family under the charter's own binding definition, which names only "not"
 * plus a contrasting noun phrase. Ticket #10116's own divergence was the
 * voice gate counting "rather than" as the same shape while the writer's
 * manual count excluded it; this checker settles it by construction: neither
 * phrase is matched by any rule below, strong or borderline, so a "rather
 * than" or "instead of" sentence never counts against the cap. "Not only ...
 * but also ..." is excluded the same way: it is an addition, not a contrast,
 * even though it shares the leading "not".
 *
 * ── Caps (content-plan.md section 7) ─────────────────────────────────────────
 * At most 3 strong hits per post, at most 1 on a heading, counted
 * whole-document including the FAQ block. The FAQ block is ordinary body
 * content under an h2 on `blogPost` (there is no separate FAQ field), so the
 * regular section-counting below already covers it without special-casing.
 */

import {
  draftToParagraphs,
  splitSentences,
  type DraftInput,
  type DraftParagraph,
} from './aphorism-closer'

export type { DraftInput, DraftParagraph }

export const ANTITHESIS_CAPS = {
  perPost: 3,
  perHeading: 1,
} as const

export type AntithesisStrength = 'strong' | 'borderline'

export interface AntithesisCandidate {
  /** The full sentence (or sentence pair, for a borderline hit) text. */
  sentence: string
  strength: AntithesisStrength
  /** The exact matched substring, for the writer to locate the clause. */
  match: string
}

const NEGATED_VERB =
  /\b(does not|do not|did not|is not|are not|was not|were not|cannot|can't|won't|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|will not)\b/i

/**
 * Same-sentence "<clause>, not <phrase>" — fully structural, decidable from
 * the sentence alone. Excludes "not only ..." (an addition, not a contrast)
 * so it is never treated as the same shape.
 */
export function matchCommaAntithesis(rawSentence: string): AntithesisCandidate | null {
  const sentence = rawSentence.trim()
  if (!sentence) return null
  const m = /,\s*(not\s+(?!only\b)\S.*)$/i.exec(sentence)
  if (!m) return null
  return { sentence, strength: 'strong', match: m[1]!.trim().replace(/[.!?]+$/, '') }
}

/**
 * Cross-sentence "<negated clause>. <short positive clause>." Requires the
 * second sentence to carry no negation of its own and to read short enough to
 * be the tight contrasting beat the charter's own example uses ("It does not
 * lower the threshold. It meets it."), not an unrelated sentence that happens
 * to follow a negation.
 */
export function matchCrossSentenceAntithesis(
  sentenceA: string,
  sentenceB: string,
): AntithesisCandidate | null {
  const a = sentenceA.trim()
  const b = sentenceB.trim()
  if (!a || !b) return null
  const negation = NEGATED_VERB.exec(a)
  if (!negation) return null
  if (NEGATED_VERB.test(b)) return null // second sentence negates too: not this shape
  const wordCount = b.split(/\s+/).filter(Boolean).length
  if (wordCount > 8) return null // too long to read as the tight contrasting beat
  return { sentence: `${a} ${b}`, strength: 'borderline', match: `${negation[0]} … ${b}` }
}

export interface AntithesisHit extends AntithesisCandidate {
  section: string
  isHeading: boolean
  /** Zero-based index into the analyzed paragraph list. */
  paragraphIndex: number
}

export interface AntithesisReport {
  /** Strong hits — counted against the caps. */
  hits: AntithesisHit[]
  /** Cross-sentence candidates — reviewer confirms the contrast. Not counted. */
  borderline: AntithesisHit[]
  /** Strong hits landing on a heading paragraph. */
  headingHits: number
  /** Strong hits landing on ordinary body text. */
  bodyHits: number
  /** Total strong hits across the whole post. */
  totalPost: number
  /** Human-readable cap violations. Empty when within caps. */
  violations: string[]
  /** True when any cap is exceeded. */
  overCap: boolean
}

export function analyzeParagraphs(paragraphs: DraftParagraph[]): AntithesisReport {
  const hits: AntithesisHit[] = []
  const borderline: AntithesisHit[] = []

  paragraphs.forEach((para, paragraphIndex) => {
    const sentences = splitSentences(para.text)
    const isHeading = Boolean(para.isHeading)

    sentences.forEach((sentence, i) => {
      const comma = matchCommaAntithesis(sentence)
      if (comma) hits.push({ ...comma, section: para.section, isHeading, paragraphIndex })

      const next = sentences[i + 1]
      if (next) {
        const cross = matchCrossSentenceAntithesis(sentence, next)
        if (cross) borderline.push({ ...cross, section: para.section, isHeading, paragraphIndex })
      }
    })
  })

  const headingHits = hits.filter(h => h.isHeading).length
  const bodyHits = hits.length - headingHits
  const totalPost = hits.length

  const violations: string[] = []
  if (totalPost > ANTITHESIS_CAPS.perPost) {
    violations.push(`${totalPost} antithesis hits across the post (cap ${ANTITHESIS_CAPS.perPost}).`)
  }
  if (headingHits > ANTITHESIS_CAPS.perHeading) {
    violations.push(`${headingHits} on a heading (cap ${ANTITHESIS_CAPS.perHeading} on a heading).`)
  }

  return {
    hits,
    borderline,
    headingHits,
    bodyHits,
    totalPost,
    violations,
    overCap: violations.length > 0,
  }
}

/** Convenience: analyze a raw draft (title + excerpt + portable-text body). */
export function analyzeDraft(draft: DraftInput): AntithesisReport {
  return analyzeParagraphs(draftToParagraphs(draft))
}
