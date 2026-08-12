/**
 * Deterministic pre-flight for the unsourced-frequency-claim construction, run
 * BEFORE the emma-empathy-reviewer voice gate so the writer catches the class
 * before it spends the routine's one allowed rewrite cycle. It is the sibling of
 * app/lib/aphorism-closer.ts: the same draft-flattening machinery, a different
 * greppable tell.
 *
 * ── What this flags ──────────────────────────────────────────────────────────
 * A frequency or population quantifier ("usually", "most", "almost every",
 * "people keep", "tends to", "commonly") attached to a subject the writer has no
 * data on: customers, readers, or other publishers. Two named runs lost gate
 * cycles to this class with no mechanical guard in place. Run 196 (2026-08-06)
 * took a voice-gate BLOCK on one fabricated-report clause ("when someone writes
 * in to say a toy irritated them", suggestion #1674). Run 269 (2026-08-11) took a
 * cycle-1 REVISE on five instances in one draft ("What follows is usually one of
 * three things", "almost every article on this subject opens at the decibel
 * level", "most advice on this topic only ever reaches the sound", "most people
 * assume a trade they do not actually have to make", "that fear is why people
 * keep buying the loud one").
 *
 * ── What this deliberately does NOT flag ─────────────────────────────────────
 * The tell is greppable but it needs a SUBJECT test, not a flat word blocklist,
 * because the same quantifiers are legitimate in two neighbouring shapes:
 *   1. a claim about a CATEGORY OF PRODUCT ("as a category, small bullets run
 *      quietest", "a smaller motor usually costs you the sensation") is a
 *      physics or product statement, not a claim about people, so it is a PASS;
 *   2. an ATTRIBUTED research finding ("sex educators describe", "reviewers draw
 *      the buzzy-versus-rumbly distinction") is sourced, so it is a PASS.
 * Second-person address ("that fear will keep YOU buying the loud one", "usually
 * costs YOU the sensation") is the Emma register talking to the reader, never a
 * population claim, and is never flagged. The detector fires only when a
 * frequency signal binds to a THIRD-PERSON population or publisher subject, or to
 * the "usually one of ..." enumeration shape.
 *
 * Like the aphorism checker, this flags CANDIDATES and leaves the final judgment
 * to the voice gate: a flagged clause is one to source, attribute, or rewrite
 * before Step 5, not an automatic defect.
 *
 * ── Limit ────────────────────────────────────────────────────────────────────
 * Zero. Any candidate trips the checker (exit 1), so the routine gates on the
 * exit code exactly as it does for the aphorism cap.
 */

import {
  draftToParagraphs,
  splitSentences,
  type DraftInput,
  type DraftParagraph,
} from './aphorism-closer'

export type { DraftInput, DraftParagraph }

/**
 * Third-person population and publisher subjects the writer typically has no
 * data on. Deliberately excludes expert/attribution nouns (researchers,
 * reviewers, educators, therapists, scientists, studies): a frequency claim
 * attached to those is an attributed finding, which is a PASS.
 */
const POPULATION =
  'people|persons?|everyone|everybody|someone|somebody|anyone|folks|readers?|customers?|users?|shoppers?|buyers?|couples?|women|men|guys'
const PUBLISHERS = 'articles?|advice|guides?|posts?|blogs?|writers?'

/**
 * Each rule is a labelled tell. A sentence matching any rule is a candidate.
 * The rules are subject-aware by construction: a bare quantifier never matches,
 * only a quantifier bound to a population or publisher subject, or the
 * "usually one of ..." enumeration.
 */
interface FrequencyRule {
  label: string
  re: RegExp
}

const RULES: FrequencyRule[] = [
  {
    // "most people", "almost every article", "the majority of readers".
    label: 'population quantifier',
    re: new RegExp(
      `\\b(most|almost every|almost all|nearly every|nearly all|the (?:vast )?majority of|many|a lot of|plenty of|countless|every other)\\s+(?:${POPULATION}|${PUBLISHERS})\\b`,
      'i',
    ),
  },
  {
    // "people keep buying", "someone writes in", "most people assume".
    label: 'population behaviour',
    re: new RegExp(
      `\\b(?:${POPULATION})\\s+(keeps?|usually|often|typically|commonly|always|tends? to|write in|writes in|writing in|tell us|tells us|assumes?|expects?|reach(?:es)? for|end up|ends up)\\b`,
      'i',
    ),
  },
  {
    // "is usually one of three things": the frequency-generalisation enumeration.
    label: 'frequency enumeration',
    re: /\b(usually|commonly|typically|normally|more often than not|often)\s+one of\b/i,
  },
]

export interface FrequencyCandidate {
  /** The full sentence text. */
  sentence: string
  /** Which rule fired. */
  rule: string
  /** The exact substring that matched, for the writer to locate the clause. */
  match: string
}

/**
 * Scan one sentence for the first unsourced-frequency candidate shape. Returns
 * the candidate, or null when no rule fires.
 */
export function matchSentence(rawSentence: string): FrequencyCandidate | null {
  const sentence = rawSentence.trim()
  if (!sentence) return null
  for (const rule of RULES) {
    const m = rule.re.exec(sentence)
    if (m) return { sentence, rule: rule.label, match: m[0] }
  }
  return null
}

export interface FrequencyHit extends FrequencyCandidate {
  section: string
  /** Zero-based index into the analyzed paragraph list. */
  paragraphIndex: number
}

export interface FrequencyReport {
  /** Every flagged candidate. */
  hits: FrequencyHit[]
  /** Total candidates across the post. */
  total: number
  /** True when any candidate was flagged (the limit is zero). */
  overLimit: boolean
}

export function analyzeParagraphs(paragraphs: DraftParagraph[]): FrequencyReport {
  const hits: FrequencyHit[] = []
  paragraphs.forEach((para, paragraphIndex) => {
    for (const sentence of splitSentences(para.text)) {
      const candidate = matchSentence(sentence)
      if (candidate) hits.push({ ...candidate, section: para.section, paragraphIndex })
    }
  })
  return { hits, total: hits.length, overLimit: hits.length > 0 }
}

/** Convenience: analyze a raw draft (title + excerpt + portable-text body). */
export function analyzeDraft(draft: DraftInput): FrequencyReport {
  return analyzeParagraphs(draftToParagraphs(draft))
}
