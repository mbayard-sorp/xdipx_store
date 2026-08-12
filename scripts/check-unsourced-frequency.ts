/**
 * Deterministic pre-flight for unsourced-frequency claims in a Notebook draft,
 * run BEFORE the emma-empathy-reviewer voice gate so the writer sources,
 * attributes, or rewrites the class before it spends the routine's one allowed
 * rewrite cycle. Sibling of scripts/check-aphorism-closers.ts.
 *
 * It flags a frequency or population quantifier ("usually", "most", "almost
 * every", "people keep", "tends to") bound to a subject the writer has no data
 * on: customers, readers, or other publishers. It does NOT flag the same
 * quantifier on a product category or an attributed research finding, nor
 * second-person address. See app/lib/unsourced-frequency.ts for the subject test.
 *
 * Usage:
 *   npx tsx scripts/check-unsourced-frequency.ts <draft.json>
 *   cat draft.json | npx tsx scripts/check-unsourced-frequency.ts
 *
 * The draft JSON is the blogPost draft: { title?, excerpt?, body? } where body
 * is the Portable Text array. Exit 0 when clean, 1 when any candidate is flagged
 * (the limit is zero), so the routine can gate on the exit code.
 */
import { readFileSync } from 'node:fs'
import { analyzeDraft, type DraftInput } from '../app/lib/unsourced-frequency'

const TAG = '[unsourced-frequency]'

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
  console.error(`${TAG} ${report.hits.length} candidate(s) to source, attribute, or rewrite before the voice gate:`)
  for (const hit of report.hits) {
    console.error(`  [${hit.section}] (${hit.rule}: "${hit.match}") ${hit.sentence}`)
  }
  process.exit(1)
}

console.log(`${TAG} OK. 0 candidates.`)
