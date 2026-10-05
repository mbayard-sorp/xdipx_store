/**
 * Deterministic pre-flight for the self-consistency defect class in a
 * Notebook draft, run BEFORE the emma-empathy-reviewer / sex-wellness-reviewer
 * gates so the writer catches a post contradicting its own stated rules
 * before spending the routine's one allowed rewrite cycle (ticket #11099).
 * Sibling of scripts/check-antithesis-cap.ts and
 * scripts/check-unsourced-frequency.ts. See app/lib/self-consistency.ts for
 * the full definition of what this flags (and the tractable subset it
 * deliberately does not catch).
 *
 * Usage:
 *   npx tsx scripts/check-self-consistency.ts <draft.json>
 *   cat draft.json | npx tsx scripts/check-self-consistency.ts
 *
 * The draft JSON is the blogPost draft: { title?, excerpt?, seoTitle?, seoDescription?, body? } where body
 * is the Portable Text array. Exit 0 when clean, 1 when any finding is
 * flagged (the limit is zero), so the routine can gate on the exit code.
 */
import { readFileSync } from 'node:fs'
import { analyzeDraft, type DraftInput } from '../app/lib/self-consistency'

const TAG = '[self-consistency]'

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

if (report.findings.length > 0) {
  console.error(`${TAG} ${report.findings.length} finding(s) to resolve before the voice gate:`)
  for (const finding of report.findings) {
    console.error(`  [${finding.kind}] ${finding.message}`)
    for (const site of finding.sites) {
      console.error(`      [${site.section}] "${site.sentence}"`)
    }
  }
  process.exit(1)
}

console.log(`${TAG} OK. 0 findings.`)
