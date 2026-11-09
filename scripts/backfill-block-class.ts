/**
 * One-off: backfill `block_class` for `blocked` `homepage_team_suggestions`
 * rows that have none (ticket #20829, tracker self-healing e1-blocked). All
 * 38 NULL rows predate migration 089 (the `block_class` column) and so
 * never passed through `inferBlockClassFromNote` at block time; draining
 * the blocked pile by class (per `operating-system.md`'s self-healing
 * program) cannot start on a row with no class.
 *
 * Classification logic lives in `app/lib/block-class-backfill.ts`
 * (`classifyBlockClass`), pure and unit-tested on its own — this script is
 * only the DB read/report/write around it.
 *
 * Dry-run by default: reports each row's proposed class (or "UNCLASSIFIED"
 * when no rule matches, left for manual review rather than guessed) and a
 * per-class tally. `--apply` writes `block_class` only for rows that got a
 * proposed class, and only `WHERE block_class IS NULL` (never overwrites a
 * value set concurrently by something else). Idempotent: a second run finds
 * 0 remaining NULL+classifiable rows and writes nothing. No schema change;
 * does not touch `status`.
 *
 *   npx tsx --env-file=.env scripts/backfill-block-class.ts            # dry run
 *   npx tsx --env-file=.env scripts/backfill-block-class.ts --apply    # write
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { homepageTeamSuggestions, suggestionLinks } from '../db/schema'
import { classifyBlockClass } from '../app/lib/block-class-backfill'

async function main() {
  const apply = process.argv.includes('--apply')

  const rows = await db
    .select({
      id: homepageTeamSuggestions.id,
      suggestion: homepageTeamSuggestions.suggestion,
      lastError: homepageTeamSuggestions.lastError,
    })
    .from(homepageTeamSuggestions)
    .where(and(eq(homepageTeamSuggestions.status, 'blocked'), isNull(homepageTeamSuggestions.blockClass)))

  console.log(`${rows.length} blocked row(s) with no block_class.`)

  const tally: Record<string, number> = {}
  const toApply: Array<{ id: number; blockClass: string }> = []

  for (const row of rows) {
    const noteRows = await db
      .select({ ref: suggestionLinks.ref })
      .from(suggestionLinks)
      .where(and(eq(suggestionLinks.suggestionId, row.id), eq(suggestionLinks.kind, 'note')))
    // Newest first: the most recent note is the most likely to state the
    // CURRENT reason, not an earlier (possibly superseded) one.
    const notes = noteRows.map(n => n.ref).reverse()

    const result = classifyBlockClass({ notes, lastError: row.lastError, suggestion: row.suggestion })
    const label = result?.blockClass ?? 'UNCLASSIFIED'
    tally[label] = (tally[label] ?? 0) + 1
    console.log(`#${row.id} -> ${label}${result ? ` (${result.reason})` : ' (needs manual review)'}`)

    if (result) toApply.push({ id: row.id, blockClass: result.blockClass })
  }

  console.log('\nPer-class tally:', tally)

  if (!apply) {
    console.log(`\nDRY RUN: would write block_class for ${toApply.length} of ${rows.length} row(s). Pass --apply to write.`)
    return
  }

  let written = 0
  for (const { id, blockClass } of toApply) {
    const updated = await db
      .update(homepageTeamSuggestions)
      .set({ blockClass })
      .where(and(eq(homepageTeamSuggestions.id, id), isNull(homepageTeamSuggestions.blockClass)))
      .returning({ id: homepageTeamSuggestions.id })
    written += updated.length
  }
  console.log(`\nWrote block_class for ${written} row(s).`)
}

main().catch((err) => {
  console.error('backfill-block-class failed:', err)
  process.exit(1)
})
