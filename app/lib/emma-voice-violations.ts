/**
 * Deterministic Emma-voice violation detector, shared by the catalog-wide
 * audit script (scripts/check-emma-voice-violations.ts) and the field-regen
 * write gate (field-regen-runner.server.ts's applyFieldResult). Four classes,
 * scoped to what docs/emma-voice.md and CLAUDE.md ban outright:
 *
 *  - lived-experience: Emma is an AI guide with no lived experience; she can
 *    never claim to have tried, tested, owned, kept, or felt a product.
 *    Merged from scripts/sweep-lived-experience.ts's catalog-sweep pattern
 *    set and batch-enrichment.server.ts's narrower generation-time guard,
 *    extended with the "I love/like how it feels" shape that shipped live on
 *    the Tantus P-spot full_story metafield (#8102).
 *  - self-narration-trust: Emma asserting her own trustworthiness or
 *    omniscience ("trust me", "I know this catalog cold") rather than
 *    describing the product (#4115 / #4123).
 *  - em-dash: the charter's "no em-dashes" rule (CLAUDE.md), checked
 *    deterministically rather than left to the model to obey.
 *  - emma-byline: the "— Emma · <aside>" tagline signature (#11147),
 *    which reads as Emma personally signing a product rather than curating
 *    catalog knowledge.
 *
 * Every pattern is case-insensitive and kept intentionally specific so
 * hypotheticals ("I'd pair this with") and catalog knowledge ("known for")
 * never match.
 */

export type EmmaVoiceViolationCategory =
  | 'lived-experience'
  | 'self-narration-trust'
  | 'em-dash'
  | 'emma-byline'

interface ViolationPattern {
  category: EmmaVoiceViolationCategory
  name: string
  re: RegExp
}

const LIVED_EXPERIENCE_PATTERNS: ViolationPattern[] = [
  { category: 'lived-experience', name: 'ive-been-verbing',       re: /\bI['’]ve been (?:testing|using|wearing|living|keeping|carrying|reaching)\b/i },
  { category: 'lived-experience', name: 'i-keep-mine',            re: /\bI keep (?:mine|one|it|this)\b/i },
  { category: 'lived-experience', name: 'i-own',                  re: /\bI own\b/i },
  { category: 'lived-experience', name: 'i-tried-tested',         re: /\bI(?:['’]ve)? (?:tried|tested)\b/i },
  { category: 'lived-experience', name: 'my-testing',             re: /\bmy testing\b/i },
  { category: 'lived-experience', name: 'i-use-it',                re: /\bI use[d]? (?:it|this|mine|one)\b/i },
  { category: 'lived-experience', name: 'my-place-things',        re: /\bmy (?:nightstand|night stand|drawer|desk|shelf|bag|purse|bedside|routine|rotation|collection|partner)\b/i },
  { category: 'lived-experience', name: 'when-i-use',             re: /\bwhen I (?:use|used|wear|wore|tried|tested)\b/i },
  { category: 'lived-experience', name: 'i-reach-grab-for',       re: /\bI (?:reach|grab|go) for\b/i },
  { category: 'lived-experience', name: 'mine-has',                re: /\bmine (?:has|is|does|lives|stays)\b/i },
  { category: 'lived-experience', name: 'ive-had-mine',           re: /\bI['’]ve (?:had|owned|worn|used|kept)\b/i },
  { category: 'lived-experience', name: 'living-on-my',           re: /\b(?:living|lives|sits|stays) (?:on|in|by) my\b/i },
  { category: 'lived-experience', name: 'i-was-verbing-it',       re: /\bI (?:was|am) (?:using|wearing|testing)\b/i },
  // "I love how substantial it feels in your hands" (#8102) — Emma asserting
  // her own tactile reaction, not what the reader will feel.
  { category: 'lived-experience', name: 'i-love-like-how-it-feels', re: /\bI['’]?(?:ve)? (?:love|loved|like|liked)\b[^.!?]{0,60}\bfeel/i },
]

const SELF_NARRATION_TRUST_PATTERNS: ViolationPattern[] = [
  { category: 'self-narration-trust', name: 'trust-me',           re: /\btrust me\b/i },
  { category: 'self-narration-trust', name: 'i-know-the-catalog', re: /\bI know (?:the|this) catalog\b/i },
  { category: 'self-narration-trust', name: 'i-am-unbiased',      re: /\bI(?:['’]m| am) unbiased\b/i },
]

const EM_DASH_PATTERNS: ViolationPattern[] = [
  { category: 'em-dash', name: 'em-dash', re: /—/ },
]

const EMMA_BYLINE_PATTERNS: ViolationPattern[] = [
  // The "— Emma · <aside>" tagline signature (#11147), e.g.
  // "— Emma · keeping this close".
  { category: 'emma-byline', name: 'emma-byline', re: /—\s*Emma\s*·/i },
]

const ALL_PATTERNS: ViolationPattern[] = [
  ...LIVED_EXPERIENCE_PATTERNS,
  ...SELF_NARRATION_TRUST_PATTERNS,
  ...EM_DASH_PATTERNS,
  ...EMMA_BYLINE_PATTERNS,
]

export interface EmmaVoiceViolationHit {
  category: EmmaVoiceViolationCategory
  name:     string
  /** Up to ~120 chars of surrounding context, HTML tags stripped. */
  excerpt:  string
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Scan one string for all four violation classes. One hit per matched pattern. */
export function scanEmmaVoiceText(text: string): EmmaVoiceViolationHit[] {
  const plain = stripHtml(text)
  const hits: EmmaVoiceViolationHit[] = []
  for (const { category, name, re } of ALL_PATTERNS) {
    const m = plain.match(re)
    if (m && m.index != null) {
      const start = Math.max(0, m.index - 60)
      const excerpt = plain.slice(start, m.index + m[0].length + 60).trim()
      hits.push({ category, name, excerpt })
    }
  }
  return hits
}

/** Convenience: just the violation names, for a short reject-reason string. */
export function findEmmaVoiceViolationNames(text: string): string[] {
  return scanEmmaVoiceText(text).map(h => h.name)
}

/**
 * Scan a record of named fields (e.g. { tagline, full_story, ... }),
 * returning each hit with its field name attached. Used by the catalog-wide
 * audit script, where attribution to a specific metafield is the point.
 */
export function scanEmmaVoiceFields(
  fields: Record<string, string | null | undefined>,
): Array<EmmaVoiceViolationHit & { field: string }> {
  const out: Array<EmmaVoiceViolationHit & { field: string }> = []
  for (const [field, value] of Object.entries(fields)) {
    if (!value) continue
    for (const hit of scanEmmaVoiceText(value)) out.push({ field, ...hit })
  }
  return out
}
