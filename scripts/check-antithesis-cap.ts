/**
 * Deterministic pre-count of the "X, not Y" antithesis construction in a
 * Notebook draft, run BEFORE the emma-empathy-reviewer voice gate so the
 * writer trims to the content-plan section 7 caps (2-3 per post, at most 1 on
 * a heading) without counting by hand. Sibling of
 * scripts/check-aphorism-closers.ts. See app/lib/antithesis-cap.ts for the
 * full definition of what counts and what deliberately does not ("rather
 * than" / "instead of" are a different rhetorical family and are never
 * flagged).
 *
 * Usage:
 *   npx tsx scripts/check-antithesis-cap.ts <draft.json>
 *   cat draft.json | npx tsx scripts/check-antithesis-cap.ts
 *
 * The draft JSON is the blogPost draft: { title?, excerpt?, body? } where body
 * is the Portable Text array. Exit 0 when within caps, 1 when any cap is
 * exceeded (so the routine can gate on the exit code).
 */
import { readFileSync } from 'node:fs'
import { analyzeDraft, type DraftInput } from '../app/lib/antithesis-cap'

const TAG = '[antithesis-cap]'

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
  console.log(
    `${TAG} ${report.hits.length} counted hit(s) (${report.headingHits} on a heading, ${report.bodyHits} in body; cap 3/post, 1/heading):`,
  )
  for (const hit of report.hits) {
    console.log(`  [${hit.section}${hit.isHeading ? ', heading' : ''}] ${hit.match}`)
  }
}

if (report.borderline.length > 0) {
  console.log(`${TAG} ${report.borderline.length} borderline cross-sentence candidate(s) (reviewer confirms the contrast):`)
  for (const hit of report.borderline) {
    console.log(`  [${hit.section}${hit.isHeading ? ', heading' : ''}] ${hit.sentence}`)
  }
}

if (report.overCap) {
  console.error(`${TAG} OVER CAP — trim before the voice gate:`)
  for (const v of report.violations) console.error(`  - ${v}`)
  process.exit(1)
}

console.log(`${TAG} OK — ${report.totalPost} hit(s), within caps.`)
