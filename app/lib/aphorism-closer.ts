/**
 * Deterministic pre-count for the aphorism-as-closer construction, the house
 * tic capped by the blog addendum of the voice charter (docs/emma-voice.md,
 * "Rhythm rules"). The content routine ran this count by hand, which produced
 * four contradictory counts across three review cycles on one post; this module
 * makes the cheap structural part of the count mechanical so the writer trims
 * BEFORE the voice gate, and the reviewer is left only the semantic judgment.
 *
 * ── What this flags ──────────────────────────────────────────────────────────
 * The charter's binding definition (amended 2026-08-06, suggestion #925) is a
 * three-part test, ALL THREE required for a hit:
 *   1. an ANAPHORIC DEMONSTRATIVE as the grammatical subject ("that", "this", or
 *      a pronoun standing in for the preceding sentence), and
 *   2. a COPULA ("is", "are", "was", "were"), and
 *   3. a relative or defining clause that RE-DESCRIBES content the previous
 *      sentence already delivered.
 *
 * Conditions 1 and 2 are decidable from the sentence alone. Condition 3 is a
 * semantic judgment about the PRECEDING sentence, so this module does not rule
 * on it: it flags CANDIDATES (subject + copula + a relative/defining signal) and
 * leaves condition 3 to the voice gate. That is deliberately faithful to the
 * #925 amendment, whose whole point was to stop a wide reading from flagging
 * ordinary expository prose. In particular:
 *   - a concrete or indefinite NOUN subject never counts ("Silicone is the
 *     practical default...", "The fix is usually...") — those are PASS, and this
 *     module does not flag them, however epigrammatic they sound;
 *   - a demonstrative used as a DETERMINER ("This product is quiet") is a noun
 *     subject, not a bare demonstrative, and is not flagged;
 *   - "Here is ..." topic sentences are not flagged.
 *
 * The charter's own looser illustrative example ("bracing is what has been
 * killing the moment") has a noun subject and so falls outside the binding test;
 * the charter says do not derive a wider rule from the example, and this module
 * follows the test, not the example.
 *
 * ── Caps ─────────────────────────────────────────────────────────────────────
 * one per section, never two in one paragraph, three per post.
 */

export const APHORISM_CAPS = {
  perPost: 3,
  perSection: 1,
  /** "Never two in one paragraph" — at most one. */
  perParagraph: 1,
} as const

/** A sentence-initial anaphoric subject (bare demonstrative or standing-in pronoun). */
const SUBJECTS = ['this', 'that', 'these', 'those', 'it', 'they']
const COPULAS = ['is', 'are', 'was', 'were']
/** Relative/defining-clause markers that signal the recap-tag shape (condition 3). */
const RELATIVE_WORDS = ['what', 'which', 'that', 'who', 'why', 'how', 'where']
/** Adverbs tolerated between the subject and the copula ("That is really what..."). */
const INTERVENING_ADVERBS = new Set([
  'really', 'often', 'usually', 'always', 'simply', 'just', 'now', 'still',
  'also', 'exactly', 'precisely', 'basically', 'essentially', 'truly', 'genuinely',
  'ultimately', 'honestly', 'probably', 'certainly', 'definitely', 'mostly',
])
/** Coordinating conjunctions allowed before the subject ("And that is what..."). */
const LEADING_CONJUNCTIONS = new Set(['and', 'but', 'so', 'yet', 'because', 'or'])

export type HitStrength = 'strong' | 'borderline'

export interface AphorismCandidate {
  /** The full sentence text. */
  sentence: string
  /** The matched subject token ("This", "That", "It", ...). */
  subject: string
  /**
   * 'strong' — a relative/defining word follows the copula (This is WHAT...,
   * That's WHY...): the recap-tag shape. Counts toward the caps.
   * 'borderline' — a bare predicate nominal follows (This is THE default): a
   * possible hit the reviewer must confirm against condition 3. Not counted.
   */
  strength: HitStrength
}

/**
 * Scan one sentence for the aphorism-as-closer candidate shape. Returns the
 * candidate, or null when the sentence does not begin with a bare anaphoric
 * demonstrative subject followed by a copula.
 */
export function matchSentence(rawSentence: string): AphorismCandidate | null {
  const sentence = rawSentence.trim()
  if (!sentence) return null

  // Normalize: strip leading markdown/quote punctuation, lowercase a working copy.
  let work = sentence.replace(/^[\s"'“”‘’*_>#-]+/, '')

  // Expand the copula contractions we care about ("That's" → "That is",
  // "It's" → "It is", "They're" → "They are"). Other 's/'re/'ll forms are left
  // alone and simply won't match a copula.
  work = work
    .replace(/^(this|that|it)'s\b/i, '$1 is')
    .replace(/^(they|these|those)'re\b/i, '$1 are')

  // Allow one leading coordinating conjunction before the subject.
  const tokens = work.split(/\s+/)
  if (tokens.length > 0 && LEADING_CONJUNCTIONS.has(tokens[0]!.toLowerCase().replace(/[,]/g, ''))) {
    tokens.shift()
  }
  if (tokens.length < 2) return null

  const subjectRaw = tokens[0]!.replace(/[^a-zA-Z]/g, '')
  const subject = subjectRaw.toLowerCase()
  if (!SUBJECTS.includes(subject)) return null

  // Walk past any tolerated adverbs to find the copula.
  let i = 1
  while (i < tokens.length && INTERVENING_ADVERBS.has(tokens[i]!.toLowerCase().replace(/[^a-z]/g, ''))) {
    i++
  }
  const verb = (tokens[i] ?? '').toLowerCase().replace(/[^a-z]/g, '')
  if (!COPULAS.includes(verb)) {
    // Subject not immediately followed by a copula. For this/that/these/those
    // that means it was a determiner ("This product is..."), i.e. a noun
    // subject — not a hit. For it/they it simply isn't a copula clause.
    return null
  }

  // Everything after the copula is the predicate. Look for a relative/defining
  // marker (strong) or a bare predicate nominal (borderline).
  const predicate = tokens.slice(i + 1)
  const predicateWords = predicate.map(t => t.toLowerCase().replace(/[^a-z]/g, '')).filter(Boolean)
  if (predicateWords.length === 0) return null

  if (predicateWords.some(w => RELATIVE_WORDS.includes(w))) {
    return { sentence, subject: subjectRaw, strength: 'strong' }
  }
  if (['the', 'a', 'an'].includes(predicateWords[0]!)) {
    return { sentence, subject: subjectRaw, strength: 'borderline' }
  }
  // "This is quiet." — predicate adjective, no defining clause: not a candidate.
  return null
}

/** Split a block of prose into sentences. Good enough for a pre-count. */
export function splitSentences(text: string): string[] {
  if (!text || !text.trim()) return []
  // Split on sentence-final punctuation followed by whitespace. Abbreviations
  // will occasionally over-split; for a candidate pre-count that only inflates
  // scrutiny, never hides a hit.
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean)
}

// ─── Portable Text extraction ────────────────────────────────────────────────

interface PtBlock {
  _type?: string
  style?: string
  children?: { text?: string }[]
}

function blockText(block: PtBlock): string {
  return (block.children ?? []).map(c => c.text ?? '').join('')
}

/** A paragraph-sized unit of prose with its enclosing section. */
export interface DraftParagraph {
  /** Section heading text, or a pseudo-section label ("Title", "Excerpt", "Intro"). */
  section: string
  text: string
}

export interface DraftInput {
  title?: string | null
  excerpt?: string | null
  /** Portable Text array (blogPost.body). */
  body?: unknown
}

/**
 * Flatten a draft into paragraph units, tracking the current section. Sections
 * are delimited by `h2` blocks (per the charter's "one per section"); the body
 * before the first h2 is the "Intro" section. Title and excerpt are their own
 * pseudo-sections and single paragraphs.
 */
export function draftToParagraphs(draft: DraftInput): DraftParagraph[] {
  const paragraphs: DraftParagraph[] = []

  if (draft.title && draft.title.trim()) {
    paragraphs.push({ section: 'Title', text: draft.title.trim() })
  }
  if (draft.excerpt && draft.excerpt.trim()) {
    paragraphs.push({ section: 'Excerpt', text: draft.excerpt.trim() })
  }

  const body = Array.isArray(draft.body) ? (draft.body as PtBlock[]) : []
  let section = 'Intro'
  for (const block of body) {
    if (!block || block._type !== 'block') continue // skip embeds, quotes-as-objects, images
    const text = blockText(block).trim()
    if (block.style === 'h2') {
      section = text || section
      // A heading rarely carries the tic, but scan it too, attributed to its
      // own section so a hit is never silently dropped.
      if (text) paragraphs.push({ section, text })
      continue
    }
    if (text) paragraphs.push({ section, text })
  }

  return paragraphs
}

// ─── Report ──────────────────────────────────────────────────────────────────

export interface AphorismHit extends AphorismCandidate {
  section: string
  /** Zero-based index into the analyzed paragraph list. */
  paragraphIndex: number
}

export interface AphorismReport {
  /** Strong hits — the recap-tag shape, counted against the caps. */
  hits: AphorismHit[]
  /** Borderline candidates — reviewer confirms condition 3. Not counted. */
  borderline: AphorismHit[]
  /** Strong-hit counts keyed by section. */
  perSection: Record<string, number>
  /** Total strong hits across the whole post. */
  totalPost: number
  /** Human-readable cap violations. Empty when within caps. */
  violations: string[]
  /** True when any cap is exceeded. */
  overCap: boolean
}

export function analyzeParagraphs(paragraphs: DraftParagraph[]): AphorismReport {
  const hits: AphorismHit[] = []
  const borderline: AphorismHit[] = []
  const perSection: Record<string, number> = {}
  const perParagraph: number[] = []

  paragraphs.forEach((para, paragraphIndex) => {
    let paraStrong = 0
    for (const sentence of splitSentences(para.text)) {
      const candidate = matchSentence(sentence)
      if (!candidate) continue
      const hit: AphorismHit = { ...candidate, section: para.section, paragraphIndex }
      if (candidate.strength === 'strong') {
        hits.push(hit)
        paraStrong++
        perSection[para.section] = (perSection[para.section] ?? 0) + 1
      } else {
        borderline.push(hit)
      }
    }
    perParagraph[paragraphIndex] = paraStrong
  })

  const totalPost = hits.length
  const violations: string[] = []

  if (totalPost > APHORISM_CAPS.perPost) {
    violations.push(`${totalPost} aphorism-as-closer hits across the post (cap ${APHORISM_CAPS.perPost}).`)
  }
  for (const [section, count] of Object.entries(perSection)) {
    if (count > APHORISM_CAPS.perSection) {
      violations.push(`${count} in section "${section}" (cap ${APHORISM_CAPS.perSection} per section).`)
    }
  }
  perParagraph.forEach((count, idx) => {
    if (count > APHORISM_CAPS.perParagraph) {
      const section = paragraphs[idx]?.section ?? '?'
      violations.push(`${count} in one paragraph (section "${section}") — never two in one paragraph.`)
    }
  })

  return { hits, borderline, perSection, totalPost, violations, overCap: violations.length > 0 }
}

/** Convenience: analyze a raw draft (title + excerpt + portable-text body). */
export function analyzeDraft(draft: DraftInput): AphorismReport {
  return analyzeParagraphs(draftToParagraphs(draft))
}
