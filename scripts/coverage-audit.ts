/**
 * coverage-audit.ts
 *
 * Audits the routine-liveness coverage table (`ROUTINE_CADENCES` in
 * `app/lib/ticket-janitor.server.ts`) against the cloud-routine manifest
 * (`docs/store-team/routine-schedule.md`). It answers one question: does every
 * routine the manifest says should be running have a liveness cadence entry, so
 * the ticket-loop janitor would notice if it went silent?
 *
 * This is the verifier named by the strategy coverage-audit routine's DONE-WHEN
 * ("npx tsx scripts/coverage-audit.ts"). That routine files one `kind:'code'`
 * ticket per missing `ROUTINE_CADENCES` entry (e.g. #3023 ads, #3024 email,
 * #3025 design); the DONE-WHEN pointed at this script, which did not exist until
 * ticket #3133 committed it, so R-DEV could not run the verifier the ticket
 * named. Committing a real one closes that gap (see ticket #3033, which left
 * this second conjunct out of scope, and #3133, which resolved it).
 *
 * Reconciliation policy lives in the two maps below. A manifest routine is:
 *   - TRACKED           → it maps to a `team|runType` lane that must exist in
 *                         ROUTINE_CADENCES;
 *   - EXPECTED_UNTRACKED → intentionally has no cadence entry (valve off, team
 *                         not enabled yet, or it writes no run row by design);
 *   - otherwise         → a GAP: a live routine with no liveness coverage.
 *
 * Cadence keys are read from the source file as text on purpose: importing
 * `ticket-janitor.server.ts` pulls in `db.server` and the whole Drizzle graph,
 * which a standalone diagnostic must not do. The regex tracks the array's
 * one-entry-per-line shape; if that shape ever changes, `readCadenceKeys`
 * returns nothing and the audit exits non-zero (code 2) rather than passing
 * silently.
 *
 * Usage:
 *   npx tsx scripts/coverage-audit.ts
 *
 * Exit codes:
 *   0 — every live manifest routine has a cadence entry (or is expected-untracked)
 *   1 — coverage gaps and/or drift between the manifest and ROUTINE_CADENCES
 *   2 — could not read/parse one of the two source files
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ─── Reconciliation policy ─────────────────────────────────────────────────────

/**
 * Manifest routine number → the `${team}|${runType}` lane it must occupy in
 * ROUTINE_CADENCES. `team` is stringified exactly as the janitor's own key math
 * does it, so a null-team lane (the pricing sweep) is `null|pricing`. Keep this
 * in step with the manifest's `## The routines` table: adding a routine to
 * ROUTINE_CADENCES means adding its number here too, or the audit reports the
 * new lane as unmapped.
 */
export const TRACKED: Readonly<Record<number, string>> = {
  1: 'strategy|strategy', // Weekly Strategy
  2: 'strategy|apply', // Apply Pass (agent-editor)
  3: 'strategy|cost-review', // Cost Review
  4: 'ads|ads', // Ads Proposals
  6: 'social|social', // Social Drafts
  7: 'homepage|merchandise', // Daily Merchandiser (Routine A)
  9: 'content|content', // Daily Content Writer
  10: 'content|seo-curation', // Weekly SEO Curation
  11: 'strategy|offsite', // Weekly Off-site Scout
  12: 'content|manual', // Weekly Podcast Review (opens its run as runType 'manual')
  13: 'null|pricing', // Daily Pricing Sweep (no team gate)
  14: 'product|product', // Daily Product Manager
  16: 'content|trend-scout', // Weekly Trend Scout
  17: 'social|research', // Weekly Business Research
  18: 'strategy|dev', // Daily Dev (R-DEV)
  19: 'strategy|qa', // Daily QA Gate (R-QA)
  20: 'social|social-trend-scout', // Weekly Social Trend Scout
}

/**
 * Manifest routine number → why it is intentionally absent from the liveness
 * table. These write no run row (or none yet), so tracking them would flag a
 * false miss every digest.
 */
export const EXPECTED_UNTRACKED: Readonly<Record<number, string>> = {
  15: 'video_team_enabled is off; no run rows until the owner enables the team',
  21: 'support team not enabled yet (blocked on PR #457); no-ops at the gate',
  22: 'R-WATCH starts no run row and consumes no run cap by design',
}

// ─── Pure parsers ──────────────────────────────────────────────────────────────

export interface ManifestRoutine {
  num: number
  name: string
}

/**
 * Extract the routine rows from the `## The routines` section only. The doc has
 * a second `| N | xdipx — … |` table (the trigger inventory) whose numbers would
 * collide, so the section is sliced out before rows are parsed.
 */
export function parseManifestRoutines(md: string): ManifestRoutine[] {
  const start = md.indexOf('## The routines')
  if (start === -1) return []
  const rest = md.slice(start + '## The routines'.length)
  const nextHeader = rest.search(/\n## /)
  const section = nextHeader === -1 ? rest : rest.slice(0, nextHeader)

  const routines: ManifestRoutine[] = []
  const seen = new Set<number>()
  for (const line of section.split('\n')) {
    const m = /^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|/.exec(line)
    if (!m) continue
    const num = Number(m[1])
    if (seen.has(num)) continue
    seen.add(num)
    routines.push({ num, name: m[2]! })
  }
  return routines
}

/**
 * Parse the `team|runType` lane keys out of the ROUTINE_CADENCES array literal
 * in the janitor source. Each entry is one line of the form
 * `{ routine: '…', team: 'x'|null, runType: 'y', … }`.
 */
export function readCadenceKeys(source: string): string[] {
  const open = source.indexOf('ROUTINE_CADENCES')
  if (open === -1) return []
  const arrStart = source.indexOf('[', open)
  const arrEnd = source.indexOf('\n]', arrStart)
  if (arrStart === -1 || arrEnd === -1) return []
  const block = source.slice(arrStart, arrEnd)

  const keys: string[] = []
  const re = /team:\s*(null|'([^']+)')\s*,\s*runType:\s*'([^']+)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(block)) !== null) {
    const team = m[1] === 'null' ? 'null' : m[2]!
    keys.push(`${team}|${m[3]!}`)
  }
  return keys
}

// ─── Audit ─────────────────────────────────────────────────────────────────────

export interface CoverageReport {
  covered: { num: number; name: string; key: string }[]
  /** Live routine with no TRACKED mapping and not expected-untracked. */
  gaps: { num: number; name: string }[]
  /** TRACKED says this routine's lane must exist, but ROUTINE_CADENCES lacks it. */
  missingLanes: { num: number; name: string; key: string }[]
  /** Cadence lane present in ROUTINE_CADENCES that no manifest routine claims. */
  unmappedLanes: string[]
  expectedUntracked: { num: number; reason: string }[]
}

export function auditCoverage(
  cadenceKeys: readonly string[],
  manifest: readonly ManifestRoutine[],
  tracked: Readonly<Record<number, string>> = TRACKED,
  expectedUntracked: Readonly<Record<number, string>> = EXPECTED_UNTRACKED,
): CoverageReport {
  const cadenceSet = new Set(cadenceKeys)
  const claimed = new Set<string>()
  const report: CoverageReport = {
    covered: [],
    gaps: [],
    missingLanes: [],
    unmappedLanes: [],
    expectedUntracked: [],
  }

  for (const r of manifest) {
    const key = tracked[r.num]
    if (key !== undefined) {
      claimed.add(key)
      if (cadenceSet.has(key)) report.covered.push({ num: r.num, name: r.name, key })
      else report.missingLanes.push({ num: r.num, name: r.name, key })
    } else if (r.num in expectedUntracked) {
      report.expectedUntracked.push({ num: r.num, reason: expectedUntracked[r.num]! })
    } else {
      report.gaps.push({ num: r.num, name: r.name })
    }
  }

  for (const key of cadenceSet) {
    if (!claimed.has(key)) report.unmappedLanes.push(key)
  }
  report.unmappedLanes.sort()
  return report
}

/** A report is clean only when nothing needs a human's attention. */
export function isClean(report: CoverageReport): boolean {
  return (
    report.gaps.length === 0 &&
    report.missingLanes.length === 0 &&
    report.unmappedLanes.length === 0
  )
}

// ─── CLI ───────────────────────────────────────────────────────────────────────

function main(): number {
  const janitorPath = fileURLToPath(new URL('../app/lib/ticket-janitor.server.ts', import.meta.url))
  const manifestPath = fileURLToPath(new URL('../docs/store-team/routine-schedule.md', import.meta.url))

  let cadenceKeys: string[]
  let manifest: ManifestRoutine[]
  try {
    cadenceKeys = readCadenceKeys(readFileSync(janitorPath, 'utf8'))
    manifest = parseManifestRoutines(readFileSync(manifestPath, 'utf8'))
  } catch (err) {
    process.stderr.write(`ERROR: could not read a source file: ${(err as Error).message}\n`)
    return 2
  }

  if (cadenceKeys.length === 0) {
    process.stderr.write(
      'ERROR: parsed zero lanes from ROUTINE_CADENCES. The array shape likely changed; ' +
        'update readCadenceKeys in scripts/coverage-audit.ts.\n',
    )
    return 2
  }
  if (manifest.length === 0) {
    process.stderr.write(
      'ERROR: parsed zero routines from the manifest. The "## The routines" table likely ' +
        'moved; update parseManifestRoutines in scripts/coverage-audit.ts.\n',
    )
    return 2
  }

  const report = auditCoverage(cadenceKeys, manifest)

  const out = process.stdout
  out.write(`Routine liveness coverage audit\n`)
  out.write(`  manifest routines : ${manifest.length}\n`)
  out.write(`  cadence lanes     : ${cadenceKeys.length}\n`)
  out.write(`  covered           : ${report.covered.length}\n`)
  out.write(`  expected-untracked: ${report.expectedUntracked.length}\n`)
  out.write(`  gaps              : ${report.gaps.length}\n\n`)

  if (report.gaps.length > 0) {
    out.write('GAPS — live routines with no liveness coverage (add a ROUTINE_CADENCES entry):\n')
    for (const g of report.gaps) out.write(`  #${g.num}  ${g.name}\n`)
    out.write('\n')
  }
  if (report.missingLanes.length > 0) {
    out.write('MISSING LANES — TRACKED expects these but ROUTINE_CADENCES dropped them:\n')
    for (const m of report.missingLanes) out.write(`  #${m.num}  ${m.name}  (${m.key})\n`)
    out.write('\n')
  }
  if (report.unmappedLanes.length > 0) {
    out.write('UNMAPPED LANES — in ROUTINE_CADENCES but no manifest routine maps to them ')
    out.write('(add the routine number to TRACKED in scripts/coverage-audit.ts):\n')
    for (const k of report.unmappedLanes) out.write(`  ${k}\n`)
    out.write('\n')
  }

  if (isClean(report)) {
    out.write('OK — coverage is complete.\n')
    return 0
  }
  out.write('FAIL — coverage is incomplete; see the sections above.\n')
  return 1
}

// Run only when invoked directly, so tests can import the pure helpers.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main())
}
