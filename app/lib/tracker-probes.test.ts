/**
 * Measured beats asserted, and only the disagreement is worth reporting.
 *
 * The tracker's RAG letter is hand-typed and the evidence-probe column beside
 * it was executed by nothing, so a milestone could read done/GREEN indefinitely
 * after its own stated condition stopped holding. Measured against production
 * on the day this shipped, two of the three machine-checkable milestones were
 * doing exactly that: b1-bus wanted "below 10" and measured 33, e3-targetteam
 * wanted 0 and measured 95.
 */
import { describe, expect, it } from 'vitest'

import { MILESTONE_PROBES, findContradictions } from '~/lib/tracker-probes.server'
import type { MilestoneMeasurement } from '~/lib/tracker-probes.server'

const m = (key: string, verdict: MilestoneMeasurement['verdict'], measured: number | null = 1): MilestoneMeasurement =>
  ({ key, describe: 'bound', measured, verdict })

const row = (id: string, rag: string) => ({ slug: 'self-healing-automation', id, rag })

describe('the registry', () => {
  it('keys every probe as <slug>:<milestone id>', () => {
    for (const p of MILESTONE_PROBES) {
      expect(p.key, p.key).toMatch(/^[a-z0-9-]+:[a-z0-9-]+$/)
    }
  })

  it('restates its bound rather than importing it from the markdown', () => {
    // If the doc and the code disagree about what GREEN means, that should be
    // visible, not silently resolved in favour of whichever was read last.
    for (const p of MILESTONE_PROBES) {
      expect(p.describe.length, p.key).toBeGreaterThan(10)
    }
  })

  it('has no duplicate keys, since lookups are by key', () => {
    const keys = MILESTONE_PROBES.map(p => p.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('encodes bounds that actually discriminate', () => {
    // A predicate that accepts everything is a probe that cannot fail, which is
    // the same defect as a floor of zero.
    for (const p of MILESTONE_PROBES) {
      const accepts = [0, 1, 10, 100, 10_000].filter(n => p.ok(n))
      expect(accepts.length, `${p.key} accepts every value`).toBeLessThan(5)
    }
  })
})

describe('contradictions', () => {
  it('flags GREEN asserted over a failing probe', () => {
    const out = findContradictions([row('b1-bus', 'GREEN')], [m('self-healing-automation:b1-bus', 'fail', 33)])
    expect(out).toHaveLength(1)
    expect(out[0]!.measured).toBe(33)
  })

  it('leaves an honest AMBER alone', () => {
    // An AMBER row failing its probe is telling the truth. Flagging it would
    // bury the rows that are not.
    const out = findContradictions([row('a4-probes', 'AMBER')], [m('self-healing-automation:a4-probes', 'fail', 8)])
    expect(out).toEqual([])
  })

  it('leaves RED alone for the same reason', () => {
    const out = findContradictions([row('x', 'RED')], [m('self-healing-automation:x', 'fail', 5)])
    expect(out).toEqual([])
  })

  it('does not flag a GREEN whose probe passes', () => {
    const out = findContradictions([row('x', 'GREEN')], [m('self-healing-automation:x', 'pass', 0)])
    expect(out).toEqual([])
  })

  it('treats an unreadable probe as no opinion, never as a contradiction', () => {
    // Accusing a milestone on a failed query would make the database having a
    // bad day look like a programme going off the rails.
    const out = findContradictions([row('x', 'GREEN')], [m('self-healing-automation:x', 'unreadable', null)])
    expect(out).toEqual([])
  })

  it('ignores a milestone with no registered probe', () => {
    // Partial coverage is the design: an unmeasured milestone renders as
    // asserted, which is honest, rather than being assumed good or bad.
    expect(findContradictions([row('unmeasured', 'GREEN')], [])).toEqual([])
  })

  it('matches on the tracker slug, not the bare id', () => {
    // Two trackers may both carry a milestone called b1-something.
    const out = findContradictions(
      [{ slug: 'other-tracker', id: 'b1-bus', rag: 'GREEN' }],
      [m('self-healing-automation:b1-bus', 'fail', 33)],
    )
    expect(out).toEqual([])
  })
})
