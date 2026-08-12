/**
 * Deterministic pre-count of the aphorism-as-closer construction in a Notebook
 * draft, run BEFORE the emma-empathy-reviewer voice gate so the writer trims to
 * the caps (3 per post, 1 per section, never 2 in a paragraph) without counting
 * by hand. Counting by hand produced four contradictory counts across three
 * review cycles on one post; this makes the structural part mechanical.
 *
 * The detector implements the charter's binding three-part test
 * (docs/emma-voice.md, "Rhythm rules"): anaphoric demonstrative subject + copula
 * + relative/defining clause. It flags CANDIDATES; condition 3 ("re-describes
 * the previous sentence") stays the voice gate's judgment. It deliberately does
 * NOT flag concrete-noun subjects ("Silicone is...", "The fix is..."), which are
 * PASS under the #925 amendment. See app/lib/aphorism-closer.ts.
 *
 * Usage:
 *   npx tsx scripts/check-aphorism-closers.ts <draft.json>
 *   cat draft.json | npx tsx scripts/check-aphorism-closers.ts
 *
 * The draft JSON is the blogPost draft: { title?, excerpt?, body? } where body
 * is the Portable Text array. Exit 0 when within caps, 1 when any cap is
 * exceeded (so the routine can gate on the exit code).
 */
import { readFileSync } from 'node:fs'
import { analyzeDraft, type DraftInput } from '../app/lib/aphorism-closer'

const TAG = '[aphorism-closers]'

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

// Per-section tally.
const sections = Object.keys(report.perSection)
if (sections.length > 0) {
  console.log(`${TAG} strong hits by section:`)
  for (const section of sections) {
    console.log(`  - ${section}: ${report.perSection[section]}`)
  }
}

// Each counted hit.
if (report.hits.length > 0) {
  console.log(`${TAG} ${report.hits.length} counted hit(s) (cap 3/post, 1/section, 1/paragraph):`)
  for (const hit of report.hits) {
    console.log(`  [${hit.section}] ${hit.sentence}`)
  }
}

// Borderline candidates — not counted, but surfaced for a human eye.
if (report.borderline.length > 0) {
  console.log(`${TAG} ${report.borderline.length} borderline candidate(s) (predicate nominal; voice gate confirms condition 3):`)
  for (const hit of report.borderline) {
    console.log(`  [${hit.section}] ${hit.sentence}`)
  }
}

if (report.overCap) {
  console.error(`${TAG} OVER CAP — trim before the voice gate:`)
  for (const v of report.violations) console.error(`  - ${v}`)
  process.exit(1)
}

console.log(`${TAG} OK — ${report.totalPost} hit(s), within caps.`)
