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
 *   4. `criterion-divergence` — a sentence states a RULE about a named
 *      buying-guide subject ("controls", "lube", "material", "position")
 *      using a modal/prescriptive cue ("you want", "look for", "depends on",
 *      "should"), and a DIFFERENT site states a rule about the SAME subject
 *      whose wording shares almost no content words with the first — the
 *      run 1475 shape (the controls criterion existed at six sites; one said
 *      a worn device "retires all three at once", another said "the page
 *      cannot settle where the controls live"). Unlike the ingress-code and
 *      enumeration checks above, there is no shared reusable token to key on
 *      here, so this clusters by subject noun and flags low word-overlap
 *      between cluster members instead of an exact contradiction. False
 *      positives are cheap — the writer reads every flagged cluster anyway —
 *      and the cost of a miss is a whole spent repair attempt.
 *
 * This deliberately does NOT catch a contradiction between two clauses that
 * share no reusable token (run 1239's wash-instruction-vs-crevice-wash shape
 * when neither sentence names the rating, or its HPV-finding-vs-wash-is-enough
 * and porous-toy-sharing shapes) — those are genuine semantic conflicts between
 * unrelated prose, not a token the document itself defines and later
 * contradicts, and need the manual whole-document re-read this checker is a
 * pre-flight for, not a replacement of.
 *
 * ── Cross-post pass (ticket #18045) ─────────────────────────────────────────
 * Everything above models the document against ITSELF. `findCrossPostIngressConflicts`
 * is the same `conflicting-instruction` shape (same code, same water-exposure
 * bucket, opposite polarity) but with one site in the draft and the other in
 * an already-PUBLISHED post, because the corpus can hold two opposite water
 * instructions for one printed code with every in-document checker staying
 * green. See its own doc comment below for the incident that motivated it
 * (run 1666).
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

// ─── Criterion-phrase divergence: same subject, different predicate ───────────

/**
 * Named buying-guide subjects this pass clusters criterion statements by.
 * Deliberately a closed, domain vocabulary — the same tractable-subset
 * posture as ENUM_NOUNS above — rather than a general noun extractor: a
 * post's "rule system" recurs on a small set of buying-guide subjects, and
 * widening this to arbitrary nouns would just re-flag unrelated sentences
 * that happen to share a word. Seeded from run 1475's incident subject and
 * its three ticket-named siblings; add a subject here only once a second
 * real incident names it, the same bar the rest of this module's
 * token/bucket vocabularies use.
 */
const CRITERION_SUBJECTS = ['controls', 'lube', 'material', 'position']

/**
 * Modal/prescriptive cues that mark a sentence as STATING A RULE about its
 * subject, rather than merely mentioning it ("the controls are on the base"
 * is not a rule; "the controls depend on the model" is).
 */
const PRESCRIPTIVE_RE =
  /\b(you want|look for|the answer is|depends on|retires?|should|must|need(?:s)? to|has to|have to)\b/i

const CRITERION_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'if', 'in',
  'into', 'is', 'it', 'its', "it's", 'no', 'nor', 'not', 'of', 'on', 'or',
  'such', 'that', 'the', 'their', 'then', 'there', 'these', 'they', 'this',
  'to', 'was', 'will', 'with', 'you', 'your', "you're", 'all', 'once', 'can',
  'do', 'does', 'did', 'so', 'than', 'too', 'very', 'just', 'only', 'also',
  'what', 'which', 'who', 'whom', 'when', 'where', 'how', 'each', 'other',
  'some', 'any', 'both', 'own', 'same',
])

/**
 * How similar two criterion statements about the same subject must be to
 * count as restating one rule rather than diverging from it. Set low
 * deliberately: a false positive here costs the writer one glance at a
 * cluster they were already going to read; a missed divergence costs a
 * whole spent repair attempt (run 1475).
 */
const CRITERION_SIMILARITY_FLOOR = 0.2

interface CriterionSite {
  subject: string
  section: string
  sentence: string
  paragraphIndex: number
  words: Set<string>
}

function contentWords(sentence: string): Set<string> {
  const words = sentence
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !CRITERION_STOPWORDS.has(w))
  return new Set(words)
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const w of a) if (b.has(w)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

function scanCriterionSentence(
  sentence: string,
  section: string,
  paragraphIndex: number,
): CriterionSite[] {
  if (!PRESCRIPTIVE_RE.test(sentence)) return []
  const lower = sentence.toLowerCase()
  const sites: CriterionSite[] = []
  for (const subject of CRITERION_SUBJECTS) {
    if (new RegExp(`\\b${subject}s?\\b`, 'i').test(lower)) {
      sites.push({ subject, section, sentence, paragraphIndex, words: contentWords(sentence) })
    }
  }
  return sites
}

// ─── Report shape ───────────────────────────────────────────────────────────

export type SelfConsistencyFindingKind =
  | 'undefined-token'
  | 'conflicting-instruction'
  | 'count-mismatch'
  | 'criterion-divergence'

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

function toSite(t: TokenSentence | PromiseSite | CriterionSite): SelfConsistencySite {
  return { section: t.section, sentence: t.sentence, paragraphIndex: t.paragraphIndex }
}

/** Every ingress/IP-rating-code mention across a flattened document, sentence by sentence. */
function extractIngressMentions(paragraphs: DraftParagraph[]): TokenSentence[] {
  const mentions: TokenSentence[] = []
  paragraphs.forEach((para, paragraphIndex) => {
    for (const sentence of splitSentences(para.text)) {
      mentions.push(...scanIngressSentence(sentence, para.section, paragraphIndex))
    }
  })
  return mentions
}

export function analyzeParagraphs(paragraphs: DraftParagraph[]): SelfConsistencyReport {
  const findings: SelfConsistencyFinding[] = []

  // ── Ingress codes ──
  const byToken = new Map<string, TokenSentence[]>()
  for (const ts of extractIngressMentions(paragraphs)) {
    const list = byToken.get(ts.token) ?? []
    list.push(ts)
    byToken.set(ts.token, list)
  }

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

  // ── Criterion-phrase divergence ──
  const criterionSites: CriterionSite[] = []
  paragraphs.forEach((para, paragraphIndex) => {
    for (const sentence of splitSentences(para.text)) {
      criterionSites.push(...scanCriterionSentence(sentence, para.section, paragraphIndex))
    }
  })

  const bySubject = new Map<string, CriterionSite[]>()
  for (const site of criterionSites) {
    const list = bySubject.get(site.subject) ?? []
    list.push(site)
    bySubject.set(site.subject, list)
  }

  for (const [subject, sites] of bySubject) {
    if (sites.length < 2) continue
    let diverges = false
    for (let i = 0; i < sites.length && !diverges; i++) {
      for (let j = i + 1; j < sites.length; j++) {
        if (sites[i]!.sentence === sites[j]!.sentence) continue
        if (jaccard(sites[i]!.words, sites[j]!.words) < CRITERION_SIMILARITY_FLOOR) {
          diverges = true
          break
        }
      }
    }
    if (diverges) {
      findings.push({
        kind: 'criterion-divergence',
        token: subject,
        message: `"${subject}" is stated as a rule at ${sites.length} site(s) that do not agree with each other; re-read every site in this cluster before publishing.`,
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

// ─── Cross-post ingress conflicts: draft vs ALREADY-PUBLISHED posts (ticket #18045) ──

/**
 * `conflicting-instruction` above can only see a contradiction inside ONE
 * document. check-self-consistency.ts CANNOT see a safety contradiction
 * between two published posts, only inside one: a draft can state an
 * instruction for an ingress code that the live corpus already contradicts,
 * and every deterministic checker stays green because none of them compares
 * the draft against what xdipx's own published posts already tell readers
 * about the same code (run 1666: a draft shower permission for IPX7 directly
 * contradicted the published `/notebook/what-is-a-gyroscope-sex-toy`, caught
 * only by a human re-read).
 *
 * This is the pure comparison half; the script wrapper
 * (`scripts/check-self-consistency.ts`) supplies `priors` from a live GROQ
 * read of published `blogPost` docs, the same split as `app/lib/fresh-language.ts`
 * / `scripts/check-fresh-language.ts`.
 */
export interface CrossPostIngressConflict {
  /** The ingress code both sites instruct on. */
  token: string
  bucket: string
  draftSite: SelfConsistencySite
  draftPolarity: InstructionPolarity
  priorSlug: string
  priorSite: SelfConsistencySite
  priorPolarity: InstructionPolarity
}

export function findCrossPostIngressConflicts(
  draftParagraphs: DraftParagraph[],
  priors: { slug: string; paragraphs: DraftParagraph[] }[],
): CrossPostIngressConflict[] {
  const draftMentions = extractIngressMentions(draftParagraphs)
  const conflicts: CrossPostIngressConflict[] = []

  for (const prior of priors) {
    const priorMentions = extractIngressMentions(prior.paragraphs)
    for (const dm of draftMentions) {
      for (const dInstr of dm.instructions) {
        for (const pm of priorMentions) {
          if (pm.token !== dm.token) continue
          for (const pInstr of pm.instructions) {
            if (pInstr.bucket !== dInstr.bucket) continue
            if (pInstr.polarity === dInstr.polarity) continue
            conflicts.push({
              token: dm.token,
              bucket: dInstr.bucket,
              draftSite: toSite(dm),
              draftPolarity: dInstr.polarity,
              priorSlug: prior.slug,
              priorSite: toSite(pm),
              priorPolarity: pInstr.polarity,
            })
          }
        }
      }
    }
  }

  return conflicts
}
