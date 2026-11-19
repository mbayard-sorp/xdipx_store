/**
 * Guard: fail CI when a scripts/*.ts file both (a) is imported by a sibling
 * scripts/*.test.ts for its exported pure functions, and (b) calls main() at
 * module top level without the import.meta.url / process.argv[1] guard that
 * the rest of this directory uses.
 *
 * Why this exists (ticket #22423, incident in PR #1987/ticket #22350):
 * scripts/backfill-inventory-resync.ts guards its main() call correctly —
 *
 *   if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
 *     main().catch(...)
 *   }
 *
 * — so importing it from a test file only pulls in its exported predicate
 * (isMaterialShortfall) and main() never runs. A script that calls main()
 * unconditionally at the top level runs it for real the moment a sibling test
 * file imports the module: main() hits a live API with no CI credentials,
 * rejects, and the rejection handler calls process.exit(2) — surfacing
 * minutes later as an unhandled-rejection failure on the whole `check` job,
 * well after the specific test file itself reported green. At the time this
 * check was written every scripts/*.ts file with a sibling test already
 * guarded its main() correctly (confirmed by running this script against the
 * live corpus), so this exists to keep it that way, not to fix a live bug.
 *
 * Scope is deliberately narrow to avoid false positives: it only looks at
 * files with a sibling test that actually imports them (a script nothing
 * imports can do whatever it wants at module scope, since nothing triggers
 * it except running it directly), and it only recognises the two guard
 * shapes already in use in this repo (`import.meta.url === new URL(...)` and
 * `process.argv[1]?.endsWith(...)` / `process.argv[1] &&`).
 *
 * Run via `npm test` (wired in ahead of vitest, like check-tts-normalize-sync.ts)
 * or directly: npx tsx scripts/check-script-main-guard.ts
 */
import { readdirSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const scriptsDir = resolve(root, 'scripts')

const GUARD_HINTS = ['import.meta.url', 'process.argv[1]']

/**
 * True when `content` calls `main(` as an unindented, unconditional module-
 * top-level statement. Matches this repo's convention of writing the guard
 * line immediately above the call: if the line right before a top-level
 * `main(` call does not mention one of the known guard hints, the call is
 * unguarded. A file with no top-level `main(` call at all (nothing to guard,
 * e.g. a pure-export module) returns false.
 */
export function hasUnguardedTopLevelMainCall(content: string): boolean {
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!/^(void\s+)?main\s*\(/.test(lines[i] ?? '')) continue
    let j = i - 1
    while (j >= 0 && (lines[j] ?? '').trim() === '') j--
    const prevLine = j >= 0 ? (lines[j] ?? '') : ''
    const guarded = GUARD_HINTS.some(hint => prevLine.includes(hint))
    if (!guarded) return true
  }
  return false
}

/** True when `testContent` imports from the sibling script named `scriptBase`. */
export function testImportsSiblingScript(testContent: string, scriptBase: string): boolean {
  const escaped = scriptBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`from\\s+['"]\\./${escaped}(\\.(ts|js))?['"]`).test(testContent)
}

export interface MainGuardViolation {
  file: string
  testFile: string
}

/**
 * Scan every scripts/*.ts file (flat; subdirectories are out of scope — none
 * of today's 207 top-level scripts/*.ts files live in one) for the unsafe
 * combination: a sibling test imports it, and it calls main() unguarded.
 */
export function findMainGuardViolations(
  dir: string,
  readFile: (path: string) => string = p => readFileSync(p, 'utf8'),
  listDir: (path: string) => string[] = p => readdirSync(p),
): MainGuardViolation[] {
  const entries = listDir(dir)
  const scriptFiles = entries.filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  const testFileSet = new Set(entries.filter(f => f.endsWith('.test.ts')))

  const violations: MainGuardViolation[] = []
  for (const file of scriptFiles) {
    const base = basename(file, '.ts')
    const testFile = `${base}.test.ts`
    if (!testFileSet.has(testFile)) continue

    const testContent = readFile(resolve(dir, testFile))
    if (!testImportsSiblingScript(testContent, base)) continue

    const content = readFile(resolve(dir, file))
    if (hasUnguardedTopLevelMainCall(content)) violations.push({ file, testFile })
  }
  return violations
}

async function main() {
  const violations = findMainGuardViolations(scriptsDir)
  if (violations.length > 0) {
    console.error('[check-script-main-guard] FAILED — unguarded top-level main() with a sibling test that imports the module:')
    for (const v of violations) {
      console.error(`  ${v.file} (imported by ${v.testFile})`)
    }
    console.error('Guard the main() call: if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) { main()... }')
    process.exit(1)
  }
  console.log('[check-script-main-guard] OK — no unguarded main() call behind a test-imported script')
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
