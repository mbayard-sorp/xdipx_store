/**
 * print-emma-voice-marketing.ts
 *
 * Prints the CORE + marketing-addendum slice of the voice charter — the exact
 * composition `app/lib/emma-voice.server.ts` already hands every
 * marketing-copy prompt in the app — instead of the full `docs/emma-voice.md`
 * file.
 *
 * Why this exists: the daily merchandiser's mandatory "read the charter
 * before writing any copy" step pointed at the raw charter file, which also
 * carries the enrichment, conversational, and support addenda that homepage
 * merchandising copy never needs. Combined with the mission brief and design
 * doctrine, the routine's mandatory pre-read totals well over a thousand
 * lines on every cold-start run — the turn-budget cost ticket #2165 named as
 * the root cause of runs 210/222/235 landing PARTIAL/HELD before a single
 * publish, and the same starvation the 2026-08-14/15 sameness tickets
 * (#3198/#3225/#3227/#3228) show downstream. This prints only the slice that
 * actually governs this routine's copy, sourced from the same constant every
 * other marketing-copy prompt uses, so the routine and the app can never
 * drift apart on what the charter says.
 *
 * Usage: npx tsx scripts/print-emma-voice-marketing.ts
 * Exit codes: 0 on success. A load failure in emma-voice.server.ts (missing
 * file or missing marker pair) throws before main() runs; tsx reports it and
 * exits non-zero, same as any other module-init failure in this repo's
 * scripts.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EMMA_VOICE_CORE, EMMA_VOICE_MARKETING, EMMA_VOICE_FULL } from '~/lib/emma-voice.server'

/** Line count of the excerpt this script prints. Exported for the test. */
export function excerptLineCount(): number {
  return EMMA_VOICE_MARKETING.split('\n').length
}

/** Line count of the full charter file, read directly (not via the slice). */
export function fullCharterLineCount(): number {
  const path = fileURLToPath(new URL('../docs/emma-voice.md', import.meta.url))
  return readFileSync(path, 'utf-8').split('\n').length
}

/**
 * True when the excerpt's two source blocks (CORE and the marketing
 * addendum) both come verbatim from the full charter text. `EMMA_VOICE_MARKETING`
 * itself is CORE and the addendum joined with a `\n\n` this script inserts, so
 * it is not a contiguous substring of the source file; the two source blocks
 * are what must actually be sourced from the charter, not typed by hand.
 */
export function excerptIsSubsetOfFull(): boolean {
  const addendum = EMMA_VOICE_MARKETING.slice(EMMA_VOICE_CORE.length + 2)
  return EMMA_VOICE_FULL.includes(EMMA_VOICE_CORE) && EMMA_VOICE_FULL.includes(addendum)
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.stdout.write(`${EMMA_VOICE_MARKETING}\n`)
}
