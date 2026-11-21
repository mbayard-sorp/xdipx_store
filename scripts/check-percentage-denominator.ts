/**
 * Deterministic pre-flight for percentage/denominator incoherence in a
 * Notebook draft, run BEFORE the emma-empathy-reviewer voice gate so the
 * writer finds the real denominator, attributes the figure, or drops the
 * pairing before it spends the routine's one allowed rewrite cycle. Sibling
 * of scripts/check-unsourced-frequency.ts.
 *
 * It flags a percentage ("92.9 percent") that co-occurs, in the same or an
 * adjacent block, with an integer population count near a population noun
 * ("66 women") when the percentage is not arithmetically reachable from that
 * count. It does NOT flag a percentage with no nearby population count, nor
 * a percentage-of-a-percentage ("92.9 percent of the 61 percent who..."). See
 * app/lib/percentage-denominator.ts for the coherence test.
 *
 * Usage:
 *   npx tsx scripts/check-percentage-denominator.ts <draft.json>
 *   cat draft.json | npx tsx scripts/check-percentage-denominator.ts
 *
 * The draft JSON is the blogPost draft: { title?, excerpt?, seoTitle?, seoDescription?, body? } where
 * body is the Portable Text array. Exit 0 when clean, 1 when any candidate is flagged (the limit is
 * zero), so the routine can gate on the exit code.
 */
import { readFileSync } from 'node:fs'
import { analyzeDraft, type DraftInput } from '../app/lib/percentage-denominator'

const TAG = '[percentage-denominator]'

function readInput(): string {
  const path = process.argv[2]
  if (path) return readFileSync(path, 'utf8')
  // No path: read the draft JSON from stdin.
  return readFileSync(0, 'utf8')
}

let draft: DraftInput
try {
  const raw = readInput()
  if (!raw.trim()) {
    console.error(`${TAG} no draft JSON provided (pass a file path or pipe JSON on stdin).`)
    process.exit(1)
  }
  draft = JSON.parse(raw) as DraftInput
} catch (err) {
  console.error(`${TAG} could not read/parse draft JSON:`, err instanceof Error ? err.message : err)
  process.exit(1)
}

const report = analyzeDraft(draft)

if (report.hits.length > 0) {
  console.error(`${TAG} ${report.hits.length} denominator-incoherent figure(s) to fix before the voice gate:`)
  for (const hit of report.hits) {
    console.error(
      `  [${hit.percentage.section}] "${hit.percentage.raw}" paired with "${hit.denominator.raw}" implies ` +
        `${hit.impliedCount} of ${hit.denominator.n} (${hit.impliedPercentage.toFixed(1)}%), not ${hit.percentage.value}%`,
    )
    console.error(`    percentage sentence: ${hit.percentage.sentence}`)
    console.error(`    denominator sentence: ${hit.denominator.sentence}`)
  }
  process.exit(1)
}

console.log(`${TAG} OK. 0 candidates.`)
