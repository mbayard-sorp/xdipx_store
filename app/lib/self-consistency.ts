/**
 * Deterministic pre-flight for the self-consistency defect class, run BEFORE
 * the emma-empathy-reviewer / sex-wellness-reviewer gates so the writer catches
 * a post that contradicts its own stated rules before spending the routine's
 * one allowed rewrite cycle (ticket #11099). Sibling of app/lib/aphorism-closer.ts:
 * the same draft-flattening machinery, a different greppable tell.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Every other pre-flight checker models a claim against OUTSIDE evidence
 * (a source, a corpus of prior posts, a population). This class is a post
 * contradicting ITSELF: it states a rule or a count in one place and diverges
 * from it somewhere later in the same document, FAQ block included. Three named
 * incidents (run 327, run 626, run 1037) and a fourth with five occurrences in
 * one post (run 1239) all share this shape and none of the existing checkers —
 * check-fresh-language (word 6-grams), check-aphorism-closers /
 * check-antithesis-cap (shape counters), check-unsourced-frequency
 * (subject-aware quantifiers) — can see it, because none of them model the
 * document against itself.
 *
 * ── What this flags (the tractable subset, not full semantic self-consistency) ──
 * A manual, whole-document re-read catches every shape of self-contradiction;
 * this checker only catches the mechanically decidable slice, extracting every
 * TOKEN the post defines or instructs on — today that is an ingress/IP rating
 * code (`IPX4`, `IPX7`, `IP67`, ...) and a numbered-enumeration promise ("four
 * red flags", "three steps") — and flagging:
 *
 *   1. `undefined-token`      — the post gives the reader an instruction tied to
 *      an ingress code it never defines anywhere (no sentence containing the
 *      code also says what the code means/covers/is rated for).
 *   2. `conflicting-instruction` — two sentences instruct differently on the
 *      SAME ingress code for the SAME water-exposure action (one permits a
 *      shower/jet/running-tap/submersion, another forbids it).
 *   3. `count-mismatch`      — the post promises a number for a named
 *      enumeration ("four checks") and a DIFFERENT site in the document (the
 *      FAQ block included) promises or delivers a different number for the
 *      same enumeration, or the promise's own inline list does not match the
 *      number it just stated.
 *
 * This deliberately does NOT catch a contradiction between two clauses that
 * share no reusable token (run 1239's wash-instruction-vs-crevice-wash shape
 * when neither sentence names the rating, or its HPV-finding-vs-wash-is-enough
 * and porous-toy-sharing shapes) — those are genuine semantic conflicts between
 * unrelated prose, not a token the document itself defines and later
 * contradicts, and need the manual whole-document re-read this checker is a
 * pre-flight for, not a replacement of.
 *
 * ── Limit ────────────────────────────────────────────────────────────────────
 * Zero. Any finding trips the checker (exit 1), the same contract as the other
 * four deterministic pre-flights.
 */

import {
  draftToParagraphs,
  splitSentences,
  type DraftInput,
  type DraftParagraph,
} from './aphorism-closer'

export type { DraftInput, DraftParagraph }

// ─── Ingress/IP rating codes: defined-vs-instructed, and conflicting instructions ──

const INGRESS_RE = /\bIPX?\d{1,2}\b/gi

/** A sentence mentioning a token also counts as DEFINING it when it uses one of these cues. */
const DEFINER_RE = /\b(means|stands for|is rated (?:for|to)|rated (?:for|to)|indicates|guarantees|covers)\b/i

interface ActionBucket {
  name: string
  re: RegExp
}

/**
 * Water-exposure action families. Two instructions about the SAME token in the
 * SAME bucket with opposite polarity are a conflict (defect shape: run 1239
 * #1 and #4). Buckets are deliberately coarse — "shower" and "a direct jet"
 * read as the same real-world exposure, which is exactly the Starlet-3-vs-
 * general-rule conflict in run 1239 #4.
 */
const ACTION_BUCKETS: ActionBucket[] = [
  {
    name: 'submersion',
    re: /\b(submerge[sd]?|submersion|immers(?:e[sd]?|ion)|dunk(?:ed|ing)?|soak(?:ed|ing)?)\b/i,
  },
  {
    name: 'direct spray',
    re: /\b(shower|running (?:tap|water)|direct spray|jet(?:\s*rating)?|hose)\b/i,
  },
]

const NEGATION_RE = /\b(never|cannot|can't|do not|don't|does not|doesn't|should not|shouldn't|avoid|not|no)\b/i

export type InstructionPolarity = 'allow' | 'forbid'

/** Looks at the ~6 words before an action match for a negation cue. */
function polarityBefore(sentence: string, matchIndex: number): InstructionPolarity {
  const before = sentence.slice(0, matchIndex)
  const words = before.trim().split(/\s+/).filter(Boolean)
  const window = words.slice(-6).join(' ')
  return NEGATION_RE.test(window) ? 'forbid' : 'allow'
}

interface TokenSentence {
  token: string
  section: string
  sentence: string
  paragraphIndex: number
  isDefiner: boolean
  instructions: { bucket: string; polarity: InstructionPolarity }[]
}

function scanIngressSentence(
  sentence: string,
  section: string,
  paragraphIndex: number,
): TokenSentence[] {
  const tokens = new Set<string>()
  for (const m of sentence.matchAll(INGRESS_RE)) tokens.add(m[0].toUpperCase())
  if (tokens.size === 0) return []

  const isDefiner = DEFINER_RE.test(sentence)
  const instructions: { bucket: string; polarity: InstructionPolarity }[] = []
  for (const bucket of ACTION_BUCKETS) {
    const m = bucket.re.exec(sentence)
    if (m) instructions.push({ bucket: bucket.name, polarity: polarityBefore(sentence, m.index) })
  }

  return Array.from(tokens).map(token => ({
    token,
    section,
    sentence,
    paragraphIndex,
    isDefiner,
    instructions,
  }))
}

// ─── Numbered-enumeration promises: cross-site count mismatches ────────────────

const NUMBER_WORD_MAP: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
}

const ENUM_NOUNS = [
  'things?', 'steps?', 'reasons?', 'ways?', 'checks?', 'tips?', 'signs?',
  'rules?', 'questions?', 'methods?', 'types?', 'options?', 'considerations?',
  'red flags?', 'symptoms?', 'tiers?', 'categories?', 'criteria', 'factors?',
  'benefits?', 'risks?',
]

const NUMBER_PATTERN = `(?:${Object.keys(NUMBER_WORD_MAP).join('|')}|\\d{1,2})`
const PROMISE_RE = new RegExp(`\\b(${NUMBER_PATTERN})\\s+(${ENUM_NOUNS.join('|')})\\b`, 'i')

function parseNumber(raw: string): number {
  const lower = raw.toLowerCase()
  if (lower in NUMBER_WORD_MAP) return NUMBER_WORD_MAP[lower]!
  return parseInt(raw, 10)
}

/** Loose singular/plural fold so "red flags" and "red flag" group together. */
function normalizeNounPhrase(raw: string): string {
  const lower = raw.toLowerCase().trim()
  if (lower === 'criteria') return 'criterion'
  return lower.replace(/s$/, '')
}

interface PromiseSite {
  nounPhrase: string
  number: number
  section: string
  sentence: string
  paragraphIndex: number
}

function scanPromiseSentence(
  sentence: string,
  section: string,
  paragraphIndex: number,
): PromiseSite | null {
  const m = PROMISE_RE.exec(sentence)
  if (!m) return null
  return {
    nounPhrase: normalizeNounPhrase(m[2]!),
    number: parseNumber(m[1]!),
    section,
    sentence,
    paragraphIndex,
  }
}

/**
 * A promise sentence that immediately lists its items inline ("four checks:
 * A, B, C, and D") is checked against itself: parse the list after the colon
 * and compare its length to the promised number.
 */
function inlineListMismatch(site: PromiseSite): { count: number; items: string[] } | null {
  const colonIndex = site.sentence.indexOf(':')
  if (colonIndex === -1) return null
  const matchIndex = site.sentence.search(PROMISE_RE)
  // Only trust a colon that follows the promise fairly closely — otherwise it
  // is unrelated punctuation elsewhere in a long sentence.
  if (colonIndex < matchIndex || colonIndex - matchIndex > 60) return null

  const tail = site.sentence
    .slice(colonIndex + 1)
    .replace(/[.!?]+\s*$/, '')
    .replace(/\band\s+/gi, ', ')
  const items = tail
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  if (items.length === 0 || items.length === site.number) return null
  return { count: items.length, items }
}

// ─── Report shape ───────────────────────────────────────────────────────────

export type SelfConsistencyFindingKind = 'undefined-token' | 'conflicting-instruction' | 'count-mismatch'

export interface SelfConsistencySite {
  section: string
  sentence: string
  paragraphIndex: number
}

export interface SelfConsistencyFinding {
  kind: SelfConsistencyFindingKind
  /** The ingress code or normalized enumeration noun phrase this finding is about. */
  token: string
  message: string
  sites: SelfConsistencySite[]
}

export interface SelfConsistencyReport {
  findings: SelfConsistencyFinding[]
  /** True when any finding exists — the limit is zero. */
  overLimit: boolean
}

function toSite(t: TokenSentence | PromiseSite): SelfConsistencySite {
  return { section: t.section, sentence: t.sentence, paragraphIndex: t.paragraphIndex }
}

export function analyzeParagraphs(paragraphs: DraftParagraph[]): SelfConsistencyReport {
  const findings: SelfConsistencyFinding[] = []

  // ── Ingress codes ──
  const byToken = new Map<string, TokenSentence[]>()
  paragraphs.forEach((para, paragraphIndex) => {
    for (const sentence of splitSentences(para.text)) {
      for (const ts of scanIngressSentence(sentence, para.section, paragraphIndex)) {
        const list = byToken.get(ts.token) ?? []
        list.push(ts)
        byToken.set(ts.token, list)
      }
    }
  })

  for (const [token, mentions] of byToken) {
    const instructed = mentions.filter(m => m.instructions.length > 0)
    const definedAnywhere = mentions.some(m => m.isDefiner)

    if (instructed.length > 0 && !definedAnywhere) {
      findings.push({
        kind: 'undefined-token',
        token,
        message: `"${token}" is instructed on but never defined anywhere in the document.`,
        sites: instructed.map(toSite),
      })
    }

    // Conflicting instructions: same token, same action bucket, opposite polarity.
    const byBucket = new Map<string, { mention: TokenSentence; polarity: InstructionPolarity }[]>()
    for (const mention of mentions) {
      for (const instr of mention.instructions) {
        const list = byBucket.get(instr.bucket) ?? []
        list.push({ mention, polarity: instr.polarity })
        byBucket.set(instr.bucket, list)
      }
    }
    for (const [bucket, entries] of byBucket) {
      const allow = entries.find(e => e.polarity === 'allow')
      const forbid = entries.find(e => e.polarity === 'forbid')
      if (allow && forbid) {
        findings.push({
          kind: 'conflicting-instruction',
          token,
          message: `"${token}" gets conflicting instructions on ${bucket}: one sentence allows it, another forbids it.`,
          sites: [toSite(forbid.mention), toSite(allow.mention)],
        })
      }
    }
  }

  // ── Numbered-enumeration promises ──
  const promises: PromiseSite[] = []
  paragraphs.forEach((para, paragraphIndex) => {
    for (const sentence of splitSentences(para.text)) {
      const site = scanPromiseSentence(sentence, para.section, paragraphIndex)
      if (site) promises.push(site)
    }
  })

  // Inline self-mismatch: the promise's own list does not match its number.
  for (const site of promises) {
    const mismatch = inlineListMismatch(site)
    if (mismatch) {
      findings.push({
        kind: 'count-mismatch',
        token: site.nounPhrase,
        message: `promises ${site.number} "${site.nounPhrase}" but lists ${mismatch.count}: ${mismatch.items.join(' | ')}.`,
        sites: [toSite(site)],
      })
    }
  }

  // Cross-site mismatch: the same noun phrase promised with different numbers
  // elsewhere in the document, the FAQ block included.
  const byNoun = new Map<string, PromiseSite[]>()
  for (const site of promises) {
    const list = byNoun.get(site.nounPhrase) ?? []
    list.push(site)
    byNoun.set(site.nounPhrase, list)
  }
  for (const [noun, sites] of byNoun) {
    const numbers = new Set(sites.map(s => s.number))
    if (numbers.size > 1) {
      findings.push({
        kind: 'count-mismatch',
        token: noun,
        message: `"${noun}" is promised as different numbers in different places: ${[...numbers].join(' vs ')}.`,
        sites: sites.map(toSite),
      })
    }
  }

  return { findings, overLimit: findings.length > 0 }
}

/** Convenience: analyze a raw draft (title + excerpt + seoTitle + seoDescription + portable-text body). */
export function analyzeDraft(draft: DraftInput): SelfConsistencyReport {
  return analyzeParagraphs(draftToParagraphs(draft))
}
