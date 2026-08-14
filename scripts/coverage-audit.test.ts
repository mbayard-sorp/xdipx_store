import { describe, it, expect } from 'vitest'
import {
  parseManifestRoutines,
  readCadenceKeys,
  auditCoverage,
  isClean,
  type ManifestRoutine,
} from './coverage-audit'

describe('parseManifestRoutines', () => {
  it('reads only the "## The routines" section, ignoring a colliding earlier table', () => {
    const md = [
      '# Manifest',
      '',
      '## Trigger inventory',
      '| # | Name | Trigger |',
      '|---|---|---|',
      '| 1 | xdipx — Weekly Strategy | `trig_aaa` |',
      '| 7 | xdipx — Daily Merchandiser | `trig_bbb` |',
      '',
      '## The routines',
      '| # | Name | Cron | Team / feature | Playbook | Clauses |',
      '|---|---|---|---|---|---|',
      '| 1 | xdipx — Weekly Strategy | `0 12 * * 1` | strategy / `strategy-weekly` | p | c |',
      '| 18 | xdipx — Daily Dev (R-DEV) | `0 14 * * *` | strategy / `strategy-dev` | p | c |',
      '',
      '| 22 | xdipx — PR Queue Watchdog (R-WATCH) | `0 */3 * * *` | none | p | c |',
      '',
      '## Access checklist',
      '| 1 | should not be parsed | x |',
    ].join('\n')

    const routines = parseManifestRoutines(md)
    expect(routines.map((r) => r.num)).toEqual([1, 18, 22])
    expect(routines.find((r) => r.num === 18)?.name).toBe('xdipx — Daily Dev (R-DEV)')
    // The row after the blank line (22) is still inside the section.
    expect(routines.some((r) => r.num === 22)).toBe(true)
    // Nothing from the "## Access checklist" section leaks in (only #1 there,
    // and #1 already came from the routines table, so total stays 3).
    expect(routines).toHaveLength(3)
  })

  it('returns nothing when the section header is absent', () => {
    expect(parseManifestRoutines('# no routines here\n| 1 | x |')).toEqual([])
  })
})

describe('readCadenceKeys', () => {
  it('parses team|runType lanes including a null-team lane', () => {
    const source = [
      'const FOO = 1',
      "export const ROUTINE_CADENCES: readonly RoutineCadence[] = [",
      "  { routine: 'R-DEV daily dev', team: 'strategy', runType: 'dev', kind: 'twice-daily', schedule: 'x', maxGapHours: A },",
      "  { routine: 'Daily pricing sweep', team: null, runType: 'pricing', kind: 'daily', schedule: 'y', maxGapHours: B },",
      "  { routine: 'Weekly podcast review', team: 'content', runType: 'manual', kind: 'weekly', schedule: 'z', maxGapHours: C },",
      ']',
      'const AFTER = 2',
    ].join('\n')

    expect(readCadenceKeys(source)).toEqual([
      'strategy|dev',
      'null|pricing',
      'content|manual',
    ])
  })

  it('returns nothing when the array cannot be located', () => {
    expect(readCadenceKeys('no cadences here')).toEqual([])
  })
})

describe('auditCoverage', () => {
  const manifest: ManifestRoutine[] = [
    { num: 1, name: 'Weekly Strategy' },
    { num: 5, name: 'Email Briefs' }, // gap: live, not mapped, not excluded
    { num: 15, name: 'Video Producer' }, // expected-untracked
    { num: 18, name: 'Daily Dev' },
  ]
  const tracked = { 1: 'strategy|strategy', 18: 'strategy|dev' }
  const untracked = { 15: 'valve off' }

  it('classifies covered, gap, and expected-untracked routines', () => {
    const report = auditCoverage(
      ['strategy|strategy', 'strategy|dev'],
      manifest,
      tracked,
      untracked,
    )
    expect(report.covered.map((c) => c.num)).toEqual([1, 18])
    expect(report.gaps.map((g) => g.num)).toEqual([5])
    expect(report.expectedUntracked.map((e) => e.num)).toEqual([15])
    expect(report.missingLanes).toEqual([])
    expect(report.unmappedLanes).toEqual([])
    expect(isClean(report)).toBe(false) // the #5 gap keeps it dirty
  })

  it('flags a TRACKED lane that ROUTINE_CADENCES no longer contains', () => {
    const report = auditCoverage(['strategy|strategy'], manifest, tracked, untracked)
    expect(report.missingLanes.map((m) => m.key)).toEqual(['strategy|dev'])
    expect(isClean(report)).toBe(false)
  })

  it('flags a cadence lane no manifest routine maps to', () => {
    const report = auditCoverage(
      ['strategy|strategy', 'strategy|dev', 'ghost|lane'],
      manifest,
      tracked,
      untracked,
    )
    expect(report.unmappedLanes).toEqual(['ghost|lane'])
    expect(isClean(report)).toBe(false)
  })

  it('is clean when every mapped lane is present and there are no gaps', () => {
    const report = auditCoverage(
      ['strategy|strategy', 'strategy|dev'],
      [
        { num: 1, name: 'Weekly Strategy' },
        { num: 15, name: 'Video Producer' },
        { num: 18, name: 'Daily Dev' },
      ],
      tracked,
      untracked,
    )
    expect(isClean(report)).toBe(true)
    expect(report.gaps).toEqual([])
  })
})
