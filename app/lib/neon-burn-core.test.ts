import { describe, expect, it } from 'vitest'
import {
  HISTORY_LIMIT,
  appendSnapshot,
  assessBurn,
  diffSnapshots,
  renderBurnTicket,
  type BurnSnapshot,
} from '~/lib/neon-burn-core'

const DAY = 24 * 3600 * 1000
const T0 = Date.parse('2026-11-01T12:45:00Z')

/** A daily history where table `a` grows by `perDay` reads each day, compute never restarting. */
function steadyHistory(days: number, perDay = 2400, pm = '2026-10-31T00:00:00.000Z'): BurnSnapshot[] {
  return Array.from({ length: days }, (_, i) => ({
    at: new Date(T0 + i * DAY).toISOString(),
    postmasterStart: pm,
    tables: { a: { reads: perDay * i, writes: 0 } },
  }))
}

describe('diffSnapshots', () => {
  it('diffs counters per hour when the compute did not restart', () => {
    const [p, c] = steadyHistory(2)
    const d = diffSnapshots(p!, c!)
    expect(d.hours).toBe(24)
    expect(d.partial).toBe(false)
    expect(d.activityPerHour).toBe(100)
  })

  it('uses raw counters and marks partial after a restart', () => {
    const [p, c] = steadyHistory(2)
    const d = diffSnapshots(p!, { ...c!, postmasterStart: '2026-11-02T06:00:00.000Z' })
    expect(d.partial).toBe(true)
    expect(d.tables['a']!.reads).toBe(2400)
  })

  it('handles a Neon consumption-period reset', () => {
    const [p, c] = steadyHistory(2)
    const d = diffSnapshots(
      { ...p!, neon: { activeSeconds: 900_000, periodStart: '2026-10-01' } },
      { ...c!, neon: { activeSeconds: 7200, periodStart: '2026-11-01' } },
    )
    expect(d.activeHoursPerDay).toBe(2)
  })
})

describe('assessBurn', () => {
  it('flags never-idle when the compute has been up a full day', () => {
    const h = steadyHistory(3)
    const a = assessBurn(h, new Date(T0 + 2 * DAY))
    expect(a.findings.map(f => f.kind)).toContain('never-idle')
  })

  it('does not flag a compute that suspends and stays at baseline', () => {
    const h = steadyHistory(9).map((s, i) => ({ ...s, postmasterStart: s.at, tables: { a: { reads: 2400, writes: 0 } }, i }))
    const a = assessBurn(h, new Date(T0 + 8 * DAY + 3600_000))
    expect(a.findings).toEqual([])
  })

  it('flags an activity jump and names the new table', () => {
    const h = steadyHistory(9)
    const last = h[h.length - 1]!
    h[h.length - 1] = { ...last, tables: { ...last.tables, gsc: { reads: 0, writes: 9600 } } }
    const a = assessBurn(h, new Date(Date.parse(last.at)))
    const kinds = a.findings.map(f => f.kind)
    expect(kinds).toContain('activity-jump')
    expect(a.topMovers[0]).toMatchObject({ table: 'gsc', writesPerHour: 400, baselinePerHour: 0 })
    expect(renderBurnTicket(a.findings.find(f => f.kind === 'activity-jump')!, a)).toContain('gsc')
  })

  it('needs a baseline before calling a jump', () => {
    const h = steadyHistory(3)
    h[2] = { ...h[2]!, tables: { a: { reads: 99_999, writes: 0 } } }
    const a = assessBurn(h, new Date(Date.parse(h[2]!.postmasterStart) + 3600_000))
    expect(a.findings).toEqual([])
  })

  it('flags a billed jump from the Neon API counter', () => {
    const h = steadyHistory(9).map((s, i) => ({
      ...s,
      postmasterStart: s.at,
      neon: { activeSeconds: i < 8 ? i * 4 * 3600 : 7 * 4 * 3600 + 12 * 3600, periodStart: '2026-11-01' },
    }))
    const a = assessBurn(h, new Date(T0 + 8 * DAY + 60_000))
    expect(a.findings.map(f => f.kind)).toEqual(['billed-jump'])
    expect(a.baselineActiveHoursPerDay).toBe(4)
  })
})

describe('appendSnapshot', () => {
  it('keeps the newest HISTORY_LIMIT snapshots', () => {
    let h: BurnSnapshot[] = []
    for (const s of steadyHistory(HISTORY_LIMIT + 3)) h = appendSnapshot(h, s)
    expect(h).toHaveLength(HISTORY_LIMIT)
    expect(h[h.length - 1]!.at).toBe(new Date(T0 + (HISTORY_LIMIT + 2) * DAY).toISOString())
  })
})
