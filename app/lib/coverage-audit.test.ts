/**
 * Tests for the coverage audit.
 *
 * The parsers matter most. They read hand-maintained markdown tables and a TS
 * source file, so the realistic failure is not a crash but a silent shape
 * change that makes the audit report a healthy fleet as uncovered, or an
 * uncovered one as healthy. Fixtures below are copied from the real files
 * rather than simplified, including the awkward rows: the prose playbook cell,
 * the run-row-less routine, the expected-missing annotation.
 */

import { describe, it, expect } from 'vitest'
import {
  auditCronParity,
  auditObservedLanes,
  auditPlaybooks,
  auditProbeCoverage,
  auditRoutineCoverage,
  auditTeamCaps,
  auditTriggerCoverage,
  extractPath,
  namesMatch,
  parseCadences,
  parseCronRoutes,
  parseManifestRoutines,
  parseManifestTriggers,
  parseVercelCrons,
  renderReport,
  sortFindings,
  summarize,
  type CadenceLike,
} from '~/lib/coverage-audit'

/* ── Fixtures, copied from the real files ──────────────────────────────────── */

const TRIGGER_TABLE = `
| # | Name | Trigger ID |
|---|---|---|
| 1 | xdipx — Weekly Strategy | \`trig_018pSqtCKWC3fxbstN7wQBvs\` |
| 15 | xdipx — Weekly Video Producer | none — \`video_team_enabled\` is off, so this is expected-missing |
| 22 | xdipx — PR Queue Watchdog (R-WATCH) | \`trig_01VfvyDpQkkcsy3DyfwzmBPQ\` (live 2026-08-07) |
| 23 | xdipx — Daily Blocker Scout (R-BLOCK) | none — the owner creates the trigger at enablement |
`

const ROUTINES_TABLE = `
| # | Name | Cron (UTC) | Team / feature label | Playbook | Extra prompt clauses |
|---|---|---|---|---|---|
| 1 | xdipx — Weekly Strategy | \`0 12 * * 1\` | strategy / \`strategy-weekly\` | \`docs/store-team/routine-weekly-strategy.md\` | Advisory only. |
| 4 | xdipx — Ads Proposals | \`0 13 * * 2\` | ads / \`ads-planning\` | \`docs/store-team/routine-ads-weekly.md\` | PROPOSE-ONLY. |
| 15 | xdipx — Weekly Video Producer | \`0 9 * * 1\` | video / \`video-weekly\` | \`docs/store-team/routine-video-weekly.md\` | Valve off. |
| 22 | xdipx — PR Queue Watchdog (R-WATCH) | \`0 */3 * * *\` (every 3 h) | none — **starts no run row and consumes no team's run cap**, deliberately | this table plus \`docs/store-team/operating-system.md\` §"The dropped trigger" | Watches every open PR. |
`

const CADENCE_SOURCE = `
export const ROUTINE_CADENCES: readonly RoutineCadence[] = [
  { routine: 'R-DEV daily dev', team: 'strategy', runType: 'dev', kind: 'twice-daily', schedule: '14:00 and 20:00 daily', maxGapHours: RDEV_GAP },
  { routine: 'Weekly strategy', team: 'strategy', runType: 'strategy', kind: 'weekly', schedule: 'Mon 12:00', maxGapHours: WEEKLY_GAP },
  { routine: 'Daily pricing sweep', team: null, runType: 'pricing', kind: 'daily', schedule: '14:37 daily (no team gate)', maxGapHours: DAILY_GAP },
]
`

/* ── Parsers ───────────────────────────────────────────────────────────────── */

describe('parseCronRoutes', () => {
  it('reads registered routes and prefixes them with /cron', () => {
    const src = `
      cronRoute('/owner-digest', async (req, res) => {})
      cronRoute("/blocker-list", async (req, res) => {})
      cronRoute('/owner-digest', dup)
    `
    expect(parseCronRoutes(src)).toEqual(['/cron/blocker-list', '/cron/owner-digest'])
  })
})

describe('parseVercelCrons', () => {
  it('reads the crons array', () => {
    const json = JSON.stringify({ crons: [{ path: '/cron/owner-digest', schedule: '0 13 * * *' }] })
    expect(parseVercelCrons(json)).toEqual([{ path: '/cron/owner-digest', schedule: '0 13 * * *' }])
  })

  it('returns nothing rather than throwing on malformed input', () => {
    expect(parseVercelCrons('not json')).toEqual([])
    expect(parseVercelCrons('{}')).toEqual([])
    expect(parseVercelCrons(JSON.stringify({ crons: 'nope' }))).toEqual([])
  })
})

describe('parseManifestRoutines', () => {
  const rows = parseManifestRoutines(ROUTINES_TABLE)

  it('reads every numbered routine row', () => {
    expect(rows.map(r => r.num)).toEqual(['1', '4', '15', '22'])
    expect(rows[0]!.cron).toBe('0 12 * * 1')
    expect(rows[0]!.playbook).toBe('docs/store-team/routine-weekly-strategy.md')
  })

  it('does not pick up rows from the 3-column trigger table', () => {
    expect(parseManifestRoutines(TRIGGER_TABLE)).toEqual([])
  })

  it('flags the routine that deliberately writes no run rows', () => {
    expect(rows.find(r => r.num === '22')!.writesNoRunRows).toBe(true)
    expect(rows.find(r => r.num === '1')!.writesNoRunRows).toBe(false)
  })
})

describe('parseManifestTriggers', () => {
  const rows = parseManifestTriggers(TRIGGER_TABLE)

  it('distinguishes live triggers from none', () => {
    expect(rows.find(r => r.num === '1')!.hasTrigger).toBe(true)
    expect(rows.find(r => r.num === '23')!.hasTrigger).toBe(false)
  })

  it('honours the expected-missing annotation', () => {
    expect(rows.find(r => r.num === '15')!.expectedMissing).toBe(true)
    expect(rows.find(r => r.num === '23')!.expectedMissing).toBe(false)
  })

  it('does not pick up rows from the 6-column routines table', () => {
    expect(parseManifestTriggers(ROUTINES_TABLE)).toEqual([])
  })
})

describe('parseCadences', () => {
  const rows = parseCadences(CADENCE_SOURCE)

  it('reads routine, team and runType, including a null team', () => {
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({ routine: 'R-DEV daily dev', team: 'strategy', runType: 'dev' })
    expect(rows[2]).toEqual({ routine: 'Daily pricing sweep', team: null, runType: 'pricing' })
  })

  it('returns empty on an unrecognised shape, which callers must treat as a parse failure', () => {
    expect(parseCadences('export const ROUTINE_CADENCES = []')).toEqual([])
  })
})

describe('extractPath', () => {
  it('finds the path inside a prose cell', () => {
    expect(extractPath('this table plus docs/store-team/operating-system.md §"The dropped trigger"'))
      .toBe('docs/store-team/operating-system.md')
  })

  it('handles a bare path and an agent def', () => {
    expect(extractPath('docs/store-team/routine-ads-weekly.md')).toBe('docs/store-team/routine-ads-weekly.md')
    expect(extractPath('.claude/agents/process-optimizer.md')).toBe('.claude/agents/process-optimizer.md')
  })

  it('returns null when the cell cites no file', () => {
    expect(extractPath('this table, and nothing else')).toBeNull()
  })
})

/* ── Name matching ─────────────────────────────────────────────────────────── */

describe('namesMatch', () => {
  it('matches the same routine written in either order', () => {
    // The case that defeats substring matching in both directions.
    expect(namesMatch('xdipx — Daily Dev (R-DEV)', 'R-DEV daily dev')).toBe(true)
    expect(namesMatch('xdipx — Daily QA Gate (R-QA)', 'R-QA daily QA gate')).toBe(true)
  })

  it('matches when one name carries extra qualifiers', () => {
    expect(namesMatch('xdipx — Cost Review (process-optimizer)', 'Cost review')).toBe(true)
    expect(namesMatch('xdipx — Weekly Off-site Scout', 'Weekly off-site scout')).toBe(true)
  })

  it('does not match different routines that share a cadence word', () => {
    expect(namesMatch('xdipx — Weekly Video Producer', 'Weekly strategy')).toBe(false)
    expect(namesMatch('xdipx — Ads Proposals', 'Email briefs')).toBe(false)
  })

  it('refuses to match on a single shared token', () => {
    // "Weekly" alone would otherwise match every weekly routine to every other.
    expect(namesMatch('Weekly', 'Weekly strategy')).toBe(false)
  })
})

/* ── Auditors ──────────────────────────────────────────────────────────────── */

const cadences: CadenceLike[] = [
  { routine: 'Weekly strategy', team: 'strategy', runType: 'strategy' },
]

describe('auditRoutineCoverage', () => {
  const routines = parseManifestRoutines(ROUTINES_TABLE)
  const triggers = parseManifestTriggers(TRIGGER_TABLE)

  it('flags a live routine with no liveness entry', () => {
    const found = auditRoutineCoverage(routines, triggers, cadences)
    expect(found.map(f => f.key)).toContain('coverage:liveness:ads-proposals')
  })

  it('stays quiet about a routine that already has one', () => {
    const found = auditRoutineCoverage(routines, triggers, cadences)
    expect(found.map(f => f.key)).not.toContain('coverage:liveness:weekly-strategy')
  })

  it('does not flag a routine that has no trigger, since that is the other finding', () => {
    const found = auditRoutineCoverage(routines, triggers, cadences)
    expect(found.map(f => f.key)).not.toContain('coverage:liveness:weekly-video-producer')
  })

  it('reclassifies a run-row-less routine instead of asking for an impossible cadence entry', () => {
    const found = auditRoutineCoverage(routines, triggers, cadences)
    const watch = found.find(f => f.key.includes('pr-queue-watchdog'))
    expect(watch?.check).toBe('unwatchable-routine')
    expect(watch?.remedy).toMatch(/heartbeat/)
    // The wrong remedy would be "add a cadence entry" for a lane with no rows.
    expect(watch?.remedy).not.toMatch(/RoutineCadence row/)
  })
})

describe('auditTriggerCoverage', () => {
  const found = auditTriggerCoverage(parseManifestTriggers(TRIGGER_TABLE))

  it('flags a routine the manifest expects to run with no trigger', () => {
    expect(found.map(f => f.key)).toContain('coverage:trigger:daily-blocker-scout-r-block')
  })

  it('routes it to the owner, since only the owner touches the scheduler', () => {
    expect(found.every(f => f.route === 'blocker')).toBe(true)
  })

  it('exempts a deliberate gap annotated expected-missing', () => {
    expect(found.map(f => f.key)).not.toContain('coverage:trigger:weekly-video-producer')
  })
})

describe('auditCronParity', () => {
  it('flags a route with no schedule and no caller', () => {
    const found = auditCronParity(['/cron/orphan'], [])
    expect(found).toHaveLength(1)
    expect(found[0]!.title).toMatch(/no schedule and no caller/)
  })

  it('stays quiet about an on-demand route something calls directly', () => {
    // /cron/warm-homepage is fired by homepage-payload.server.ts, not scheduled.
    const found = auditCronParity(['/cron/warm-homepage'], [], new Set(['/cron/warm-homepage']))
    expect(found).toEqual([])
  })

  it('flags a schedule that resolves to no route, which 404s on every tick', () => {
    const found = auditCronParity([], [{ path: '/cron/ghost', schedule: '0 1 * * *' }])
    expect(found).toHaveLength(1)
    expect(found[0]!.severity).toBe('high')
    expect(found[0]!.key).toBe('coverage:cron-orphan:cron-ghost')
  })

  it('ignores scheduled paths outside /cron', () => {
    expect(auditCronParity([], [{ path: '/api/something', schedule: '0 1 * * *' }])).toEqual([])
  })

  it('is quiet when everything lines up', () => {
    expect(auditCronParity(['/cron/a'], [{ path: '/cron/a', schedule: '0 1 * * *' }])).toEqual([])
  })
})

describe('auditPlaybooks', () => {
  const routines = parseManifestRoutines(ROUTINES_TABLE)

  it('flags a manifest row citing a file that is not on disk', () => {
    const found = auditPlaybooks(routines, new Set(['docs/store-team/routine-weekly-strategy.md']))
    expect(found.length).toBeGreaterThan(0)
    expect(found.every(f => f.check === 'playbook-paths')).toBe(true)
  })

  it('is quiet when every cited path exists', () => {
    const all = new Set([
      'docs/store-team/routine-weekly-strategy.md',
      'docs/store-team/routine-ads-weekly.md',
      'docs/store-team/routine-video-weekly.md',
      'docs/store-team/operating-system.md',
    ])
    expect(auditPlaybooks(routines, all)).toEqual([])
  })
})

describe('auditObservedLanes', () => {
  it('flags an active lane no cadence entry watches', () => {
    const found = auditObservedLanes([{ team: 'content', runType: 'mystery', runs: 12 }], cadences)
    expect(found).toHaveLength(1)
    expect(found[0]!.key).toBe('coverage:lane:content-mystery')
    expect(found[0]!.detail).toMatch(/12 run rows/)
  })

  it('is quiet about a watched lane', () => {
    expect(auditObservedLanes([{ team: 'strategy', runType: 'strategy', runs: 4 }], cadences)).toEqual([])
  })

  it('treats a null-team cadence entry as matching any team', () => {
    const anyTeam: CadenceLike[] = [{ routine: 'Daily pricing sweep', team: null, runType: 'pricing' }]
    expect(auditObservedLanes([{ team: 'strategy', runType: 'pricing', runs: 9 }], anyTeam)).toEqual([])
  })

  it('skips the shared manual bucket, which cannot be attributed to one lane', () => {
    expect(auditObservedLanes([{ team: 'content', runType: 'manual', runs: 5 }], cadences)).toEqual([])
  })
})

describe('auditTeamCaps', () => {
  it('flags an enabled team missing a cap row', () => {
    const found = auditTeamCaps(['social'], new Set(['social_team_daily_cents']))
    expect(found).toHaveLength(1)
    expect(found[0]!.title).toMatch(/social_team_max_runs/)
    // A production settings write is the owner's, not an agent's.
    expect(found[0]!.route).toBe('blocker')
  })

  it('is quiet when both rows are present', () => {
    expect(auditTeamCaps(['social'], new Set(['social_team_max_runs', 'social_team_daily_cents']))).toEqual([])
  })

  it('says nothing about teams that are switched off', () => {
    expect(auditTeamCaps([], new Set())).toEqual([])
  })
})

describe('auditProbeCoverage', () => {
  it('flags a list that mostly cannot close itself', () => {
    const found = auditProbeCoverage([
      { verifyProbe: null }, { verifyProbe: null }, { verifyProbe: 'setting_true' },
    ])
    expect(found).toHaveLength(1)
    expect(found[0]!.title).toMatch(/Only 1 of 3/)
    expect(found[0]!.severity).toBe('low')
  })

  it('is quiet when most rows have a probe', () => {
    expect(auditProbeCoverage([{ verifyProbe: 'setting_true' }, { verifyProbe: null }])).toEqual([])
  })

  it('says nothing about an empty list', () => {
    expect(auditProbeCoverage([])).toEqual([])
  })
})

/* ── Reporting ─────────────────────────────────────────────────────────────── */

describe('summarize and renderReport', () => {
  const findings = [
    ...auditTriggerCoverage(parseManifestTriggers(TRIGGER_TABLE)),
    ...auditCronParity([], [{ path: '/cron/ghost', schedule: '0 1 * * *' }]),
    ...auditProbeCoverage([{ verifyProbe: null }, { verifyProbe: null }]),
  ]

  it('counts by severity, route and check', () => {
    const s = summarize(findings)
    expect(s.total).toBe(3)
    expect(s.high).toBe(2)
    expect(s.low).toBe(1)
    expect(s.blockers).toBe(1)
    expect(s.tickets).toBe(2)
    expect(s.byCheck['trigger-coverage']).toBe(1)
  })

  it('sorts high severity first', () => {
    expect(sortFindings(findings).map(f => f.severity)).toEqual(['high', 'high', 'low'])
  })

  it('says plainly when there is nothing to report', () => {
    expect(renderReport([])).toMatch(/no gaps found/)
  })

  it('leads with the counts and the split between bus and owner', () => {
    const out = renderReport(findings)
    expect(out).toMatch(/3 gaps/)
    expect(out).toMatch(/2 to the bus, 1 to the owner/)
  })
})
