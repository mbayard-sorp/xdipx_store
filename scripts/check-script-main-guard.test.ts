import { describe, expect, it } from 'vitest'

import { findMainGuardViolations, hasUnguardedTopLevelMainCall, testImportsSiblingScript } from './check-script-main-guard'

describe('hasUnguardedTopLevelMainCall', () => {
  it('passes a script with no top-level main() call at all', () => {
    expect(hasUnguardedTopLevelMainCall('export function helper() { return 1 }\n')).toBe(false)
  })

  it('passes the standard import.meta.url guard', () => {
    const content = [
      'async function main() {}',
      '',
      'if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {',
      '  main().catch(err => { console.error(err); process.exit(1) })',
      '}',
      '',
    ].join('\n')
    expect(hasUnguardedTopLevelMainCall(content)).toBe(false)
  })

  it('passes the process.argv[1]?.endsWith(...) guard variant', () => {
    const content = [
      'async function main() { return 0 }',
      '',
      "if (process.argv[1]?.endsWith('design-crop.ts')) {",
      '  main().then(code => process.exit(code))',
      '}',
      '',
    ].join('\n')
    expect(hasUnguardedTopLevelMainCall(content)).toBe(false)
  })

  it('fails an unconditional top-level main() call — the incident shape', () => {
    // scripts/backfill-shop-channel-publish.ts (PR #1987) shape: no guard line
    // at all before the call, so importing the module for its exports runs it.
    const content = [
      'async function main() {',
      '  await doSomethingLive()',
      '}',
      '',
      'main().catch(err => {',
      '  console.error(err)',
      '  process.exit(2)',
      '})',
      '',
    ].join('\n')
    expect(hasUnguardedTopLevelMainCall(content)).toBe(true)
  })

  it('fails a bare unconditional main() with no .catch', () => {
    const content = 'async function main() {}\n\nmain()\n'
    expect(hasUnguardedTopLevelMainCall(content)).toBe(true)
  })
})

describe('testImportsSiblingScript', () => {
  it('matches a relative import with no extension', () => {
    expect(testImportsSiblingScript("import { isMaterialShortfall } from './backfill-inventory-resync'\n", 'backfill-inventory-resync')).toBe(true)
  })

  it('matches a relative import with an explicit extension', () => {
    expect(testImportsSiblingScript("import { foo } from './check-brand-handles.ts'\n", 'check-brand-handles')).toBe(true)
  })

  it('does not match an unrelated import', () => {
    expect(testImportsSiblingScript("import { db } from '../app/lib/db.server'\n", 'backfill-inventory-resync')).toBe(false)
  })

  it('does not match a different sibling script', () => {
    expect(testImportsSiblingScript("import { foo } from './other-script'\n", 'backfill-inventory-resync')).toBe(false)
  })
})

describe('findMainGuardViolations', () => {
  it('flags only a script with both a sibling-test import and an unguarded main()', () => {
    const files: Record<string, string> = {
      'safe.ts': 'async function main() {}\n\nif (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {\n  main()\n}\n',
      'safe.test.ts': "import { helper } from './safe'\n",
      'unsafe.ts': 'export function helper() { return 1 }\nasync function main() { await helper() }\n\nmain()\n',
      'unsafe.test.ts': "import { helper } from './unsafe'\n",
      'no-test.ts': 'async function main() {}\n\nmain()\n',
      'unrelated.test.ts': "import { helper } from '../app/lib/something'\n",
    }
    const readFile = (path: string) => {
      const name = path.split('/').pop() as string
      const content = files[name]
      if (content == null) throw new Error(`unexpected read: ${path}`)
      return content
    }
    const listDir = () => Object.keys(files)
    const violations = findMainGuardViolations('/scripts', readFile, listDir)
    expect(violations).toEqual([{ file: 'unsafe.ts', testFile: 'unsafe.test.ts' }])
  })

  it('reports no violations against the live repo today', () => {
    // The live-corpus check this ticket's DONE WHEN implies: run the actual
    // scanner against scripts/ as it stands on main, not only the synthetic
    // fixture above. Per the ticket's own text, every sibling-test-imported
    // script already guards its main() call, so this must stay empty.
    const liveViolations = findMainGuardViolations(new URL('.', import.meta.url).pathname)
    expect(liveViolations).toEqual([])
  })
})
