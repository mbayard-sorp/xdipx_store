/**
 * Classifies a `blocked` suggestion row's free-text block reason into one of
 * `TICKET_BLOCK_CLASSES` (`app/lib/team.server.ts`), for rows that predate the
 * `blockClass` column (migration 089) and so never passed through
 * `inferBlockClassFromNote` at block time (ticket #20829, the e1-blocked
 * backfill).
 *
 * Pure, dependency-free: `scripts/backfill-block-class.ts` is the only
 * caller, and it owns all the DB I/O.
 *
 * Rule order, most to least reliable signal:
 *   1. `inferBlockClassFromNote` — the exact mechanism the live transition
 *      path already uses (`[bracket-tag]` in the first 200 chars).
 *   2. Phrase rules below, checked against the row's own block NOTES first
 *      (the actual stated-at-block-time reason), falling back to
 *      `lastError` / the original `suggestion` text only if no note yields
 *      a match. Scanning the original filing text first was tried and
 *      rejected: it describes the PROBLEM being investigated, which often
 *      incidentally uses a class word (a ticket ABOUT the allowlist regex
 *      mentions "PROTECTED PATH" while explaining the bug, even though the
 *      row's actual resolution was `no-code-work`/re-file-as-docs) — real
 *      incident, ticket #10492 in the validation set below.
 *
 * Every rule here was validated against the real text of all 38 rows this
 * ticket's backfill targets (fetched via `POST /api/team/suggestion
 * {op:'get'}`, never raw SQL, per `routine-dev-daily.md` §3d's "test against
 * a real row" rule) — 36 of 38 classify; the remaining 2 are rows whose own
 * block note genuinely doesn't commit to one reason (both recommend
 * escalating to another team/owner for more evidence rather than stating a
 * cause), and are correctly reported as unclassified rather than guessed.
 */
import { TICKET_BLOCK_CLASSES, inferBlockClassFromNote } from './team.server'

export interface BlockClassInput {
  /** This row's block notes, newest first. */
  notes: readonly string[]
  lastError?: string | null
  suggestion: string
}

export interface BlockClassResult {
  blockClass: (typeof TICKET_BLOCK_CLASSES)[number]
  /** Which text source and rule produced the match, for the dry-run report. */
  reason: string
}

const PROTECTED_PATH_RE = /PROTECTED PATH|protected glob/
const DUPLICATE_RE = /duplicate of #\d+/i
const OWNER_ENV_RE = /owner-only environment|environment variable|env secret|vercel environment variable/i
const DEPENDENCY_RE = /dependency unmet|depends on (ticket )?#\d+|cannot be built until #\d+|upstream ci break|in-flight file overlap/i
const NEEDS_SPLIT_RE = /conjunctive|cross-agent epic|split per|decomposed into|shippable (half|slice)|not a single (rr7-engineer|single-agent) (code )?pr/i
const NO_CODE_WORK_RE =
  /no r-dev code change|no code change|not a code change|not an? (r-dev[\s-]*)?(app-?code|reproducible|in-repo|code pr)|docs-?only append|re-?file as kind:?instructions|diagnosis complete|no shippable|not resolvable by a code|not r-dev-executable|no code fix|not an? app-code defect|outside r-dev code scope|owner call,? not a dev fix|not actionable without|not a safe,? verifiable|no code fix (to make|warranted)|investigated.{0,80}no (code|shippable)|not in-repo actionable/i

/** Checked in this order: the first rule any text matches wins. */
const PHRASE_RULES: ReadonlyArray<readonly [(typeof TICKET_BLOCK_CLASSES)[number], RegExp]> = [
  ['protected-path', PROTECTED_PATH_RE],
  ['duplicate', DUPLICATE_RE],
  ['owner-env', OWNER_ENV_RE],
  ['dependency', DEPENDENCY_RE],
  ['needs-split', NEEDS_SPLIT_RE],
  ['no-code-work', NO_CODE_WORK_RE],
]

function tryTexts(texts: readonly string[]): BlockClassResult | null {
  for (const text of texts) {
    const bracketClass = inferBlockClassFromNote(text)
    if (bracketClass) {
      return { blockClass: bracketClass as (typeof TICKET_BLOCK_CLASSES)[number], reason: `bracket tag in "${text.slice(0, 40)}..."` }
    }
  }
  for (const [blockClass, pattern] of PHRASE_RULES) {
    for (const text of texts) {
      const match = pattern.exec(text)
      if (match) return { blockClass, reason: `matched "${match[0]}"` }
    }
  }
  return null
}

/**
 * Classify one blocked row. Returns `null` when neither the notes nor the
 * fallback texts contain a recognizable signal — the caller must leave that
 * row's `block_class` untouched and report it for manual review rather than
 * guess.
 */
export function classifyBlockClass(input: BlockClassInput): BlockClassResult | null {
  const fromNotes = tryTexts(input.notes)
  if (fromNotes) return { ...fromNotes, reason: `${fromNotes.reason} (in a note)` }

  const fallback = [input.lastError, input.suggestion].filter((t): t is string => !!t)
  const fromFallback = tryTexts(fallback)
  if (fromFallback) return { ...fromFallback, reason: `${fromFallback.reason} (in suggestion/lastError, no note matched)` }

  return null
}
