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
 *   5. `neighbour-water-instruction` — a block carries an ingress-code
 *      instruction (the same allow/forbid read `conflicting-instruction`
 *      already extracts), and one of the blocks within a small window before
 *      or after it gives an UNCONDITIONAL water-contact instruction (wash,
 *      rinse, run under, soak, submerge, shower, bath, tap) that names no
 *      rating of its own and does not defer to the manufacturer, with the
 *      opposite polarity. This is the same shape as #2 above, except the
 *      second site shares no token with the first — it is found by
 *      PROXIMITY, not by the code appearing twice — which is exactly the gap
 *      ticket #21540 found live: content run 2004 repairing
 *      how-do-you-use-a-prostate-massager's IPX7 block (b39, "comes with no
 *      promise about a tap") was blocked by the accuracy gate on the
 *      UNCHANGED neighbouring block (b40, "wash it... warm water"), a
 *      contradiction no existing predicate could see because b40 names no
 *      code at all. See ticket #21738.
 *
 * This deliberately does NOT catch a contradiction between two clauses that
 * share no reusable token and sit outside each other's scan window (run
 * 1239's HPV-finding-vs-wash-is-enough and porous-toy-sharing shapes) — those
 * are genuine semantic conflicts between unrelated prose that still need the
 * manual whole-document re-read this checker is a pre-flight for, not a
 * replacement of.
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
import { FROZEN_SAFETY_STRINGS } from './fresh-language-frozen-strings'

export type { DraftInput, DraftParagraph }

// ─── Ingress/IP rating codes: defined-vs-instructed, and conflicting instructions ──

const INGRESS_RE = /\bIPX?\d{1,2}\b/gi
/** Non-global twin of INGRESS_RE for plain boolean `.test()` calls — a global
 *  regex's `.test()` advances `lastIndex` across calls and alternates results. */
const INGRESS_TEST_RE = /\bIPX?\d{1,2}\b/i

/** A sentence mentioning a token also counts as DEFINING it when it uses one of these cues. */
const DEFINER_RE =
  /\b(means|stands for|is rated (?:for|to)|rated (?:for|to)|indicates|guarantees|covers|certifies|defines)\b/i

/**
 * True when `sentence` is itself an exact substring of one of the mandated,
 * reviewed FROZEN_SAFETY_STRINGS house wordings (app/lib/fresh-language-
 * frozen-strings.ts). Ticket #24303, SECOND occurrence of a frozen-string
 * gap after #22587's apposed-gloss fix: IPX56_JET_CODE_HOUSE_WORDING opens
 * "IPX5 and IPX6 are the jet codes", which matches no DEFINER_RE cue and no
 * apposed gloss, so the frozen wording itself reds as undefined-token on
 * every post that correctly installs it verbatim. Scoping this to an exact
 * frozen-string substring (rather than a looser shape like "are the ___
 * codes") keeps the carve-out tight: a paraphrase of the frozen wording is
 * not exempted by this check, only the mandated sentence itself.
 */
function isFrozenSafetySentence(sentence: string): boolean {
  const trimmed = sentence.trim()
  if (!trimmed) return false
  return FROZEN_SAFETY_STRINGS.some(s => s.includes(trimmed))
}

/**
 * A plain-English gloss of what a rating covers, introduced as a noun phrase
 * ("a jet rating", "a splash rating") rather than DEFINER_RE's verb cues.
 */
const RATING_GLOSS_RE = /\b(?:a|an)\s+[a-z]+(?:\s+[a-z]+){0,2}\s+ratings?\b/i

/** How many characters back from a code occurrence to look for an apposed gloss. */
const APPOSITION_WINDOW = 40

/**
 * Only commas, "or"/"and", whitespace, and other ingress codes may sit
 * between the gloss and the code it introduces — a true apposition
 * ("a jet rating, IPX5 or IPX6"), not merely a rating mention somewhere
 * upstream of an unrelated later clause ("a great rating, and the IPX5
 * model..." must NOT count: "and the ... model" is a new clause, not a
 * joiner).
 */
const APPOSITION_JOINER_RE = /^[\s,]*(?:(?:or|and)[\s,]*)*$/i

/**
 * True when every ingress-code occurrence in the sentence sits within a
 * short apposition of a "a/an ___ rating(s)" gloss — "...whose maker prints
 * a jet rating, IPX5 or IPX6" (ticket #22587, live false positive on
 * air-pulse-vs-clitoral-suction). DEFINER_RE's verb cues (means/is rated
 * for/...) miss this shape because the code is introduced as an APPOSITION
 * to the gloss, not as its subject or object. Tight by design, the same bar
 * this module's other closed vocabularies use: the gloss must be a short,
 * generic "rating" noun phrase sitting immediately before the code, joined
 * only by punctuation/"or"/"and"/other codes — not any mention of the word
 * "rating" within the window with other words in between.
 */
function hasApposedRatingGloss(sentence: string): boolean {
  for (const m of sentence.matchAll(INGRESS_RE)) {
    const windowStart = Math.max(0, m.index! - APPOSITION_WINDOW)
    const before = sentence.slice(windowStart, m.index!)
    const gloss = RATING_GLOSS_RE.exec(before)
    if (!gloss) return false
    const between = before
      .slice(gloss.index + gloss[0].length)
      .replace(/\bIPX?\d{1,2}\b/gi, '')
    if (!APPOSITION_JOINER_RE.test(between)) return false
  }
  return true
}

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

// `without` and `out of` cover the house phrasing "withstands splashing water
// from any direction, wipe it down, keep it out of the shower, and never
// submerge it": the negation on "shower" sits in "keep it out of the", which
// no prior cue matched, so the checker read a forbidding sentence as an
// ALLOW and flagged a false cross-post conflict (ticket #20643).
// `neither` covers the live-corpus regression shape "IPX5 and IPX6 mean
// water jets... and neither of them covers immersion" (#21947 bounce,
// what-makes-a-vibrator-body-safe): a correlative negation with no bare
// "not"/"never" for the window to catch.
const NEGATION_RE =
  /\b(never|cannot|can't|do not|don't|does not|doesn't|should not|shouldn't|avoid|without|out of|neither|not|no)\b/i

export type InstructionPolarity = 'allow' | 'forbid'

/** Looks at the ~6 words before an action match for a negation cue. */
function polarityBefore(sentence: string, matchIndex: number): InstructionPolarity {
  const before = sentence.slice(0, matchIndex)
  const words = before.trim().split(/\s+/).filter(Boolean)
  const window = words.slice(-6).join(' ')
  return NEGATION_RE.test(window) ? 'forbid' : 'allow'
}

/**
 * Negated copula or auxiliary sitting directly after a match ("the shower
 * IS NOT", "the shower ISN'T", "the shower CANNOT") — anchored at the start
 * of the post-match text (through at most a comma/"and"/"but" joiner), not a
 * generic word-count window. A look-behind window alone misses negation that
 * TRAILS the matched word instead of preceding it (#21947 bounce: what-
 * makes-a-great-g-spot-rabbit-vibrator's "...so the bath is settled for it
 * and the shower is not." negates "shower" with "is not" sitting right
 * after it). The anchor matters: a wide, unanchored word-count window over-
 * fires on a LATER, unrelated negated clause in the same sentence — "...for
 * a running tap, and the two do not imply each other..." (what-makes-a-
 * vibrator-body-safe, live-corpus regression) must NOT read as forbidding
 * "running tap" just because "do not" shows up a few words later about a
 * completely different subject ("the two"). The trailing bare `off` (an
 * IPX4 cleaning line, live-corpus regression: "dampen a cloth... keeping
 * running water off it") mirrors the already-established `out of`/`without`
 * preposition-negation shape (ticket #20643) reversed — "running water off
 * it" negates "running water" the same way "keep it out of the shower"
 * negates "shower" — so it is anchored the same tight way as the rest of
 * this regex, not added to the general look-behind NEGATION_RE window.
 *
 * Deliberately limited to a negated COPULA ("is/was/are/were not",
 * "isn't"/"wasn't"/etc) rather than also matching a negated action verb
 * ("does not", "cannot") right after an "and"/"but" joiner: a copula
 * restates the subject just mentioned ("the shower... and the shower IS
 * NOT [covered]"), but a negated action verb after a conjunction routinely
 * introduces a NEW clause with its own object — "IPX5 covers the shower
 * AND DOES NOT COVER immersion" negates "immersion" (the object of the
 * second clause), not "shower" (the object of the first). Allowing the
 * conjunction-joined "does not"/"cannot" forms here matched that second
 * clause's negation onto the FIRST clause's "shower" instead (live-corpus
 * regression, how-do-you-choose-the-right-wand-massager) — a real sentence
 * that correctly allows the shower now misread as forbidding it.
 */
const TRAILING_NEGATED_COPULA_RE =
  /^[\s,]*(?:and|but|or)?[\s,]*(?:is|was|are|were)\s+not\b|^[\s,]*(?:isn'?t|wasn'?t|aren'?t|weren'?t)\b|^[\s,]*off\b/i

/** Looks immediately after an action match for a negated copula/auxiliary attached to it. */
function polarityAfter(sentence: string, matchEndIndex: number): InstructionPolarity {
  const after = sentence.slice(matchEndIndex)
  return TRAILING_NEGATED_COPULA_RE.test(after) ? 'forbid' : 'allow'
}

/**
 * Restriction phrasing that scopes or denies DIRECT-SPRAY-type coverage
 * (shower/jet/running-tap) WITHOUT using a classic negation word anywhere
 * nearby — "the jet needs its own rating" and "written instruction from the
 * maker" read as a restriction to a person, but neither contains
 * not/never/cannot/etc for polarityBefore or polarityAfter's windows to
 * catch (#21947 bounce: the live-corpus regression on how-do-couples-use-a-
 * prostate-massager-together and how-do-you-use-a-clitoral-suction-toy,
 * both carrying this exact "needs a rating" / "does not cover jets"
 * phrasing misread as `allow`). Ported from the house restriction
 * vocabulary already validated against the live corpus in
 * ipx7-water-grant.ts's RESTRICTS_IPX7_RE (content run 2021).
 *
 * Deliberately NOT applied to a submersion/immersion match: every phrase
 * here ("immersion only" chief among them) SCOPES coverage to immersion
 * while restricting everything else — it is a grant of submersion, not a
 * denial of it, so forcing `forbid` onto a submersion match too flips a
 * correct `allow` ("IPX7 covers immersion only: one metre, thirty minutes.",
 * egg-vibrator-vs-bullet-vibrator) into a false conflict against every other
 * post that also correctly allows immersion. "rather than from the code" is
 * a second live-corpus restriction phrasing (what-makes-a-vibrator-body-
 * safe: "the shower comes from Womanizer rather than from the code") — a
 * single-token sentence, so no multi-token misattribution risk the way
 * MULTI_CODE_INDEPENDENT_RE below guards against.
 */
const RESTRICTION_PHRASE_RE =
  /immersion only|does not cover jets|carr(?:y|ies) (?:their|its) own ratings?|do(?:es)? not stack|needs? its own rating|written instruction from the maker|rather than from the (?:code|rating)|(?:toy|maker|manufacturer|brand)'?s own (?:instructions?|manual|care guide|directions)/i

/**
 * A REQUIREMENT-shaped restriction NAMES the condition that satisfies it —
 * "needs a/the rating that covers jets", "a written instruction from the
 * maker that this toy CAN go under a shower" — rather than flatly denying
 * coverage. The house sentence this guards lists several codes with
 * DIFFERENT conditions in one breath ("IPX5 or IPX6 or a DUAL IPX6 and IPX7
 * mark"): IPX5 and IPX6 are each plainly sufficient alone, but IPX7 only
 * counts paired with IPX6. This module's per-sentence (not per-token or
 * per-clause) model has no way to grant IPX5/IPX6 while leaving IPX7
 * unresolved, so — same remedy as MULTI_CODE_INDEPENDENT_RE and
 * PER_CODE_CERTIFIES_ONLY_RE below — it is safer to attribute NO instruction
 * at all for this bucket than to guess, which a flat `forbid` (the original
 * bug) or a flat `allow` (a tried-and-reverted first fix, see git history)
 * both do. RESTRICTION_PHRASE_RE's vaguer, bare phrasing ("needs its own
 * rating" with nothing said about what satisfies it, a lone "written
 * instruction from the maker" with no stated outcome) is a true restriction
 * and is unaffected by this regex, which only matches the narrower shape
 * that actually spells out the satisfying condition (#22827 live-corpus
 * false positive: the sentence above was misread as flatly forbidding
 * IPX5/IPX6/IPX7, producing 30 of 34 false `conflicting-instruction`
 * findings in one live-corpus audit against every other post's correct
 * "IPX5/IPX6 mean water jets" definition of the same codes; forcing a flat
 * `allow` instead just traded those for 5 new false positives against posts
 * correctly stating that IPX7 ALONE does not cover the shower).
 */
const REQUIREMENT_GRANT_RE =
  /\bneeds?\s+(?:a|the)\s+ratings?\s+that\s+covers?\b|\bwritten instructions?\s+from the maker\s+that\b[^.!?]{0,60}\bcan\b/i

/**
 * A sentence naming TWO OR MORE distinct ingress codes that explicitly says
 * they are independent of each other ("the two do not imply each other")
 * cannot be safely read as a single allow/forbid for any one of those
 * codes with this module's per-sentence (not per-clause) token<->instruction
 * model: which code a given water-contact word actually binds to differs
 * per code, so forcing one polarity for the whole sentence misattributes it
 * to the WRONG code about half the time. Live-corpus regression (#21947
 * bounce, what-makes-a-vibrator-body-safe): "IPX7 for a basin and IPX5 or
 * IPX6 for a running tap, and the two do not imply each other" was read as
 * an unscoped ALLOW of "running tap" for IPX7 too, when the sentence's
 * entire point is that IPX7 does NOT get running tap. Safer to drop the
 * sentence's instructions entirely (both tokens, below) than to guess which
 * code each clause was actually about.
 */
const MULTI_CODE_INDEPENDENT_RE = /\bdo(?:es)? not imply each other\b/i

/**
 * A sentence giving each of 2+ distinct ingress codes its OWN "<CODE>
 * certifies <X> only" clause describes DIFFERENT codes' DIFFERENT scopes in
 * one sentence — the same per-sentence-not-per-clause misattribution risk
 * MULTI_CODE_INDEPENDENT_RE above already guards, a second shape of it
 * (#22827 live-corpus false positive: "IPX4 certifies protection against
 * splashing only, so a toy carrying that code stays out of the shower and
 * never goes under water, and IPX7 certifies immersion only, ... which
 * comes with no promise about a shower or a tap" — IPX4's own negated
 * clause, "never goes under water", uses no word this module's submersion
 * vocabulary recognizes, so the sentence's only submersion-bucket match is
 * IPX7's "immersion", correctly read `allow` under SUBMERSION_LIKE_WORD_RE's
 * "immersion only grants, doesn't deny" rule — and that single sentence-wide
 * read then gets misattributed onto IPX4 too, reporting IPX4 as ALLOWING
 * submersion when the sentence says the opposite). Safer to drop the
 * sentence's instructions entirely, exactly like MULTI_CODE_INDEPENDENT_RE,
 * than to teach this module to split clauses it doesn't model.
 */
const PER_CODE_CERTIFIES_ONLY_RE = /\b(IPX?\d{1,2})\b\s+certifies\s+[a-z]+(?:\s+[a-z]+){0,4}\s+only\b/gi

/** Distinct ingress codes that each get their own "<CODE> certifies ... only" clause in the sentence. */
function distinctCertifiesOnlyCodes(sentence: string): Set<string> {
  const codes = new Set<string>()
  for (const m of sentence.matchAll(PER_CODE_CERTIFIES_ONLY_RE)) codes.add(m[1]!.toUpperCase())
  return codes
}

/**
 * Matches a word a bucket/water-contact scan found when that word itself
 * names a submersion/immersion-type action, so callers can skip
 * RESTRICTION_PHRASE_RE for it (see that regex's own doc comment for why).
 * Deliberately wider than ACTION_BUCKETS' `submersion` bucket — includes
 * "bath", which `findNeighbourWaterInstructionFindings` matches via
 * WATER_CONTACT_RE but no ACTION_BUCKETS entry does — because the same
 * "grants immersion, restricts everything else" reasoning applies to a bath
 * instruction too.
 */
const SUBMERSION_LIKE_WORD_RE = /submerge[sd]?|submersion|immers(?:e[sd]?|ion)|dunk(?:ed|ing)?|soak(?:ed|ing)?|bath/i

/**
 * Full local-polarity read for one occurrence of an action/water-contact
 * word: `forbid` if the sentence carries a no-negation-word restriction
 * phrase (RESTRICTION_PHRASE_RE — skipped when the matched word itself is
 * submersion/immersion-like, see that regex's own doc comment), or if a
 * classic negation cue sits in the ~6-word look-behind window, or a negated
 * copula sits directly after the match. Looking only behind the match (the
 * original `polarityBefore`-only read) missed every trailing-negation
 * sentence; see the helpers' own doc comments for the named incidents,
 * including the live-corpus regressions a looser first attempt at this fix
 * introduced.
 */
function localPolarity(
  sentence: string,
  matchIndex: number,
  matchText: string,
): InstructionPolarity {
  if (!SUBMERSION_LIKE_WORD_RE.test(matchText) && RESTRICTION_PHRASE_RE.test(sentence)) return 'forbid'
  if (polarityBefore(sentence, matchIndex) === 'forbid') return 'forbid'
  if (polarityAfter(sentence, matchIndex + matchText.length) === 'forbid') return 'forbid'
  return 'allow'
}

/**
 * Scans EVERY occurrence of a pattern in the sentence, not just the first,
 * and reads it as `forbid` if any occurrence's local polarity is negated
 * (#21947, reproduced on what-makes-a-great-g-spot-rabbit-vibrator and the
 * frozen "no promise about a shower or a tap" wording). A single-match
 * `exec` picks whichever occurrence comes FIRST in the string, which is not
 * necessarily the one that actually governs the sentence's real claim:
 * "Running water and jets carry their own ratings... and an IPX7 toy
 * therefore comes with no promise about a shower or a tap" matches "Running
 * water" at index 0 (empty window before it, so it reads `allow`) even
 * though the sentence's real claim — "no promise about a shower" — forbids
 * it. The identical sentence, read elsewhere in the same or a sibling post,
 * then collides with itself as a false `conflicting-instruction`.
 * Preferring `forbid` whenever any occurrence is negated is the same
 * safety-conservative posture both callers below need: ACTION_BUCKETS for
 * the in-document/cross-post check, and WATER_CONTACT_RE for the
 * neighbour-water-instruction check, which used to take WATER_CONTACT_RE's
 * single first match only — "Wipe or rinse the head, keep the body out of
 * standing water, and submerge nothing" matched just "rinse" (correctly
 * `allow`) and never saw "submerge nothing" (`forbid`) later in the same
 * sentence (live-corpus regression, how-do-you-choose-a-cordless-wand-
 * vibrator).
 */
function scanAllPolarity(re: RegExp, sentence: string): { match: RegExpExecArray; polarity: InstructionPolarity } | null {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`
  const globalRe = new RegExp(re.source, flags)
  let first: RegExpExecArray | null = null
  let match: RegExpExecArray | null
  while ((match = globalRe.exec(sentence))) {
    first ??= match
    if (localPolarity(sentence, match.index, match[0]) === 'forbid') return { match, polarity: 'forbid' }
    if (match[0].length === 0) globalRe.lastIndex++
  }
  return first ? { match: first, polarity: 'allow' } : null
}

function bucketPolarity(bucket: ActionBucket, sentence: string): InstructionPolarity | null {
  return scanAllPolarity(bucket.re, sentence)?.polarity ?? null
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

  const isDefiner =
    DEFINER_RE.test(sentence) || hasApposedRatingGloss(sentence) || isFrozenSafetySentence(sentence)
  // A sentence naming 2+ codes that explicitly declares them independent, or
  // that gives each of 2+ codes its own "<CODE> certifies ... only" clause,
  // can't be safely attributed to either one — see MULTI_CODE_INDEPENDENT_RE
  // and PER_CODE_CERTIFIES_ONLY_RE. A requirement-shaped sentence
  // (REQUIREMENT_GRANT_RE) has the same problem whenever it lists codes with
  // different conditions ("IPX5 or IPX6 or a dual IPX6 and IPX7 mark") — see
  // that regex's own doc comment.
  const unscopeable =
    REQUIREMENT_GRANT_RE.test(sentence) ||
    (tokens.size > 1 &&
      (MULTI_CODE_INDEPENDENT_RE.test(sentence) || distinctCertifiesOnlyCodes(sentence).size > 1))
  const instructions: { bucket: string; polarity: InstructionPolarity }[] = []
  if (!unscopeable) {
    for (const bucket of ACTION_BUCKETS) {
      const polarity = bucketPolarity(bucket, sentence)
      if (polarity) instructions.push({ bucket: bucket.name, polarity })
    }
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

// ─── Neighbour water-contact instructions: ingress-scoped vs unscoped (ticket #21738) ──

/**
 * Words that describe actually putting a toy in contact with water, phrased
 * as a cleaning or use INSTRUCTION. Deliberately broader than ACTION_BUCKETS
 * above: "wash" and "tap" never set an ACTION_BUCKETS cue because that
 * vocabulary is keyed for an ingress code appearing on BOTH sides of a
 * conflict, not a free-standing cleaning line that names no code at all —
 * exactly why the how-do-you-use-a-prostate-massager b39/b40 pair (run 2004)
 * was invisible to every existing predicate.
 */
const WATER_CONTACT_RE =
  /\b(wash(?:es|ed|ing)?|rinse[sd]?|rinsing|runs? (?:it |them |your toy )?under|running under|soak(?:s|ed|ing)?|submerge[sd]?|submersion|shower|bath(?:e[sd]?|ing)?|tap)\b/i

/**
 * An explicit hand-off to the manufacturer's own instructions scopes a
 * sentence just as much as naming a rating does: it defers to a
 * product-specific source instead of asserting a blanket rule, so it is not
 * the "unconditional" instruction this predicate is built to catch.
 */
const MANUFACTURER_DIRECTION_RE =
  /\b(manufacturer|the brand'?s? (?:instructions|guide|care guide|directions)|per the (?:brand|manufacturer)|check (?:with|the) (?:brand|manufacturer))\b/i

/**
 * A sentence that names a marketing term (shower-ready, splashproof,
 * waterproof, water-friendly...) ONLY to say the term itself carries no
 * fixed meaning is a disclaimer about vocabulary, not an instruction about
 * water exposure — it explicitly says it ISN'T one. House wording reused
 * near-verbatim across several posts (live-corpus regression, #21947
 * bounce): "Splashproof and shower-ready are marketing words with no fixed
 * meaning" (egg-vibrator-vs-bullet-vibrator), "Splashproof, shower-ready,
 * and water-friendly are marketing language" (how-do-you-use-a-sex-toy-
 * safely), "Shower-ready, splashproof and waterproof are label language
 * with no fixed definition behind them" (do-you-need-a-sex-toy-cleaner) —
 * each was being read as an unconditional ALLOW of "shower" purely because
 * the word "shower-ready" appears, which collided with every correctly-
 * forbidding ingress block nearby once the forbid side stopped being
 * misread (see RESTRICTION_PHRASE_RE and TRAILING_NEGATED_COPULA_RE above).
 */
const MARKETING_DISCLAIMER_RE =
  /\b(?:marketing (?:language|words?)|label language|no fixed (?:meaning|definition))\b/i

/**
 * A sentence about a hygiene habit (washing hands, changing a condom between
 * partners/uses), a barrier method, or closing a cover/cap/lid is not an
 * instruction about the TOY'S water exposure, even when it happens to contain
 * a WATER_CONTACT_RE trigger word ("wash", "tap") or sits next to an ingress
 * block (ticket #24510/bus row #24502's DEFECT 1, second shape). Worked
 * example: "close any cover before the toy goes near a tap" is a port-cover
 * habit, not a water permission, and a condom-and-wash hygiene line is about
 * the condom and the user's hands, not the device. Closed vocabulary, same
 * tractable-subset posture as the rest of this module.
 */
const HYGIENE_OR_COVER_RE =
  /\b(condom|barrier method|close (?:any |the )?(?:cover|cap|lid)|covers?\s+(?:on|closed|shut))\b/i

/**
 * A block's OPENING sentence can explicitly scope the whole block to a
 * different product class than the one the nearby ingress rating describes
 * — a mains-powered wand instead of the battery toy carrying the code — in
 * which case an unconditional water-contact instruction later in that same
 * block is not actually about the rated product at all (#21947, reproduced
 * on wand-vs-bullet-vibrator b40: "A wand that plugs into the wall sits
 * outside all of that. It never goes in water..."). Tight by design, same
 * bar as the rest of this module's closed vocabularies — add a shape here
 * only once a second real incident names it.
 */
const SCOPE_CARVEOUT_RE =
  /\bsits outside (?:all of )?(?:that|this|those)\b|\bplugs? into the wall\b|\ba corded (?:wand|device|toy)\b|\bmains[- ]power(?:ed)?\b/i

/**
 * How many blocks before and after an ingress-instructed block to scan for
 * an unscoped, opposite-polarity water-contact instruction. The motivating
 * incident (run 2004) is adjacent (distance 1); a window of 2 gives a little
 * slack for the sibling cleaning-guide posts #21540 names as likely repeats,
 * where the wash line is not always the very next block.
 */
const DEFAULT_NEIGHBOUR_WATER_WINDOW = 2

/**
 * For every block carrying an ingress-code instruction, scans the blocks
 * within `windowSize` before and after it for an UNCONDITIONAL water-contact
 * instruction — one that names no rating of its own and does not defer to
 * the manufacturer — whose polarity (the same `localPolarity` read used for
 * the in-document check above) is the opposite of the ingress block's.
 * Same shape as the in-document `conflicting-instruction` check, except the
 * second site is found by PROXIMITY rather than by the code appearing twice.
 */
function findNeighbourWaterInstructionFindings(
  paragraphs: DraftParagraph[],
  windowSize: number = DEFAULT_NEIGHBOUR_WATER_WINDOW,
): SelfConsistencyFinding[] {
  const ingressMentions = extractIngressMentions(paragraphs).filter(m => m.instructions.length > 0)
  if (ingressMentions.length === 0) return []

  const seen = new Set<string>()
  const findings: SelfConsistencyFinding[] = []

  for (const mention of ingressMentions) {
    const lo = Math.max(0, mention.paragraphIndex - windowSize)
    const hi = Math.min(paragraphs.length - 1, mention.paragraphIndex + windowSize)
    for (let idx = lo; idx <= hi; idx++) {
      if (idx === mention.paragraphIndex) continue
      const para = paragraphs[idx]!
      const neighbourSentences = splitSentences(para.text)
      if (neighbourSentences[0] && SCOPE_CARVEOUT_RE.test(neighbourSentences[0])) continue // whole block scoped to a different product class
      // A block that names an ingress code ANYWHERE in it is that code's own
      // bounded instruction, even on the one sentence that doesn't itself
      // repeat the code (ticket #24510/bus row #24502's DEFECT 1: a sequence
      // of per-rating blocks — IPX4's, then IPX5/IPX6's, then IPX7's — where
      // each block's own water-contact sentence trails a separate sentence
      // naming that block's code, not the ingress mention's). Checking only
      // the CURRENT sentence for a rating (INGRESS_TEST_RE below) missed this
      // because the rating and the instruction are sentence-adjacent, not
      // sentence-identical.
      if (neighbourSentences.some(s => INGRESS_TEST_RE.test(s))) continue
      for (const sentence of neighbourSentences) {
        if (INGRESS_TEST_RE.test(sentence)) continue // scoped by its own rating
        if (MANUFACTURER_DIRECTION_RE.test(sentence)) continue // defers to the manufacturer
        if (MARKETING_DISCLAIMER_RE.test(sentence)) continue // disclaims the term, not an instruction
        if (HYGIENE_OR_COVER_RE.test(sentence)) continue // hygiene/barrier/cover habit, not a water-exposure instruction
        // A sentence that is itself a mandated FROZEN_SAFETY_STRINGS wording is
        // reviewed and correct by construction, even when it reads as water-
        // contact but names no code of its own (ticket #24303: the IPX56 jet-
        // code wording's second sentence, "...a toy carrying either is built
        // to take a rinse", has no rating token for INGRESS_TEST_RE to catch
        // above). Whether this frozen sentence lands in the ingress mention's
        // own block or a sibling block is an editorial formatting choice
        // (where the block boundary falls), not a real scoping difference, so
        // the frozen wording is exempt from the proximity heuristic the same
        // way an explicit manufacturer hand-off or marketing disclaimer is.
        if (isFrozenSafetySentence(sentence)) continue
        // A question ("Can you use one in the shower or the bath?") is not an
        // instruction at all — it carries no polarity of its own, it is the
        // heading the surrounding paragraph then answers. Treating it as an
        // "unconditional ALLOW" was always wrong; it was simply masked while
        // the forbid side of the real instruction nearby was itself misread
        // as `allow` (#21947 bounce, live-corpus regression on
        // how-do-you-use-a-clitoral-suction-toy: once the real instruction
        // correctly reads `forbid`, it now collides with this FAQ heading on
        // every surrounding sentence instead of the one real neighbour).
        if (sentence.trim().endsWith('?')) continue
        const waterMatch = scanAllPolarity(WATER_CONTACT_RE, sentence)
        if (!waterMatch) continue
        const { polarity: waterPolarity } = waterMatch

        for (const instr of mention.instructions) {
          if (instr.polarity === waterPolarity) continue // agree, not a conflict
          const key = [mention.token, instr.bucket, mention.sentence, sentence].sort().join('\u0000')
          if (seen.has(key)) continue
          seen.add(key)
          findings.push({
            kind: 'neighbour-water-instruction',
            token: mention.token,
            message:
              `"${mention.token}" ${instr.polarity}s ${instr.bucket} here, but a nearby block gives an ` +
              `unconditional water-contact instruction naming no rating of its own, and ${waterPolarity}s it.`,
            sites: [toSite(mention), { section: para.section, sentence, paragraphIndex: idx }],
          })
        }
      }
    }
  }

  return findings
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

/**
 * Nouns too generic to treat as the SAME tracked enumeration across
 * different sites in a document purely by matching this noun. "thing" is
 * reused for unrelated enumerations throughout a post ("three things decide
 * whether one reaches the G-spot at all" vs "two things keep a rabbit safe
 * to own"), which the cross-site count check otherwise conflates into a
 * false conflict (ticket #22587, bus row #21540's other reported false
 * positive, live on what-makes-a-great-g-spot-rabbit-vibrator). Every other
 * ENUM_NOUNS entry names a specific enough category ("red flags", "steps")
 * that two independent sites naming it really are talking about the same
 * promise; "thing" alone is not. Still tracked for the SAME-SENTENCE inline
 * list-mismatch check below, where the promise and its own list are
 * necessarily about the one enumeration they're both inside, so there is no
 * cross-topic conflation risk there.
 */
const CROSS_SITE_EXCLUDED_NOUNS = new Set(['thing'])

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
 * A continuation marker: a comma-separated piece that starts with one of
 * these is a relative clause ("...lubricant, which polyurethane tolerates")
 * or a contrast ("buy for X, not for Y") glued onto the PRECEDING list item,
 * not a new item of its own (ticket #24510/bus row #24502's DEFECT 2).
 */
const LIST_ITEM_CONTINUATION_RE = /^(which|that|who|not)\b/i

/**
 * Splits the tail of a promise sentence (the text after its colon) into its
 * top-level list items, without over-counting a single item's own internal
 * commas or conjunctions as separate items (ticket #24510/bus row #24502's
 * DEFECT 2). Four worked false positives, all correct as published:
 *   - "...what the toy is made of, whether it is wearing a barrier, and what
 *     happens to it between one person and the next" (3 items) — blindly
 *     turning every "and" into a comma split the THIRD item's own internal
 *     "and the next" into a fourth.
 *   - "...four types: primary ...; secondary, meaning you once did and now do
 *     not; general ...; and situational ..." (4 items, semicolon-delimited) —
 *     splitting on comma instead of the semicolons the sentence actually uses
 *     counted the second item's internal clarifying comma as a boundary.
 *   - "...oil based lubricant, which polyurethane tolerates" (1 item) — the
 *     comma before a "which" relative clause is not a list boundary.
 *   - "...buy for X, not for Y" (1 item) — the comma before a "not" contrast
 *     is not a list boundary either.
 * Strategy: prefer the semicolon as the top-level separator when the tail
 * uses one; otherwise split on comma and re-merge any piece that opens with
 * a continuation marker into the item before it. Either way, strip a leading
 * "and " off every item after the first, so the Oxford-or-not final
 * conjunction never becomes part of that item's own text.
 */
function splitPromiseListItems(tail: string): string[] {
  const stripLeadingAnd = (s: string, index: number) => (index > 0 ? s.replace(/^and\s+/i, '') : s)

  if (tail.includes(';')) {
    return tail
      .split(';')
      .map(s => s.trim())
      .filter(Boolean)
      .map((s, i) => stripLeadingAnd(s, i))
  }

  if (tail.includes(',')) {
    const rawParts = tail.split(',').map(s => s.trim()).filter(Boolean)
    const merged: string[] = []
    for (const part of rawParts) {
      if (merged.length > 0 && LIST_ITEM_CONTINUATION_RE.test(part)) {
        merged[merged.length - 1] = `${merged[merged.length - 1]}, ${part}`
      } else {
        merged.push(part)
      }
    }
    return merged.map((s, i) => stripLeadingAnd(s, i))
  }

  // No comma, no semicolon: a bare two-item "X and Y" list is the only shape
  // this tractable subset can safely split without a list-separating comma
  // to anchor on. Two or more "and"s with nothing else to go on is ambiguous
  // (which one is the list boundary and which is internal to an item?), so
  // leave it unsplit rather than guessing.
  const andOccurrences = tail.match(/\band\b/gi)
  if (andOccurrences?.length === 1) {
    const idx = tail.search(/\band\b/i)
    return [tail.slice(0, idx).trim(), tail.slice(idx + 3).trim()].filter(Boolean)
  }
  return [tail.trim()].filter(Boolean)
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

  const tail = site.sentence.slice(colonIndex + 1).replace(/[.!?]+\s*$/, '')
  const items = splitPromiseListItems(tail)

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
  | 'neighbour-water-instruction'

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
    if (CROSS_SITE_EXCLUDED_NOUNS.has(noun)) continue
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

  // ── Neighbour water-contact instructions: ingress-scoped vs unscoped ──
  findings.push(...findNeighbourWaterInstructionFindings(paragraphs))

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
