/**
 * Run-liveness tests for ticket #3191: per-team staleness thresholds and the
 * named blocking run behind a run_in_progress gate refusal.
 *
 * The incident: social run 251 hung silently and was not reaped for 5h42m
 * under the flat 240-minute threshold, and the weekly trend-scout run that
 * landed inside that window skipped itself with no retry, losing the entire
 * week's cycle. Social routines finish in 10-15 minutes, so its threshold is
 * now 60; teams with measured long quiet stretches keep the 240 default.
 *
 * db.server and kv.server are mocked at import time; assertions run against
 * the emitted SQL and the values handed to the query builder.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const state = vi.hoisted(() => ({
  updates: [] as Array<{ vals: Record<string, unknown>; where: unknown }>,
  selectResults: [] as unknown[][],
}))

vi.mock('~/lib/db.server', () => ({
  db: {
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          state.updates.push({ vals, where: cond })
          return Promise.resolve()
        },
      }),
    }),
    select: () => ({
      from: () => {
        const chain: Record<string, unknown> = {}
        chain['where'] = () => chain
        chain['orderBy'] = () => chain
        chain['limit'] = () => Promise.resolve(state.selectResults.shift() ?? [])
        return chain
      },
    }),
    execute: vi.fn(async () => ({ rows: [] })),
  },
}))

vi.mock('~/lib/kv.server', () => ({
  cached: vi.fn(async (_key: string, _ttl: number, fn: () => unknown) => fn()),
  invalidateCache: vi.fn(async () => {}),
  kvDel: vi.fn(async () => {}),
  kvGet: vi.fn(async () => null),
  kvSet: vi.fn(async () => {}),
  kvSetNX: vi.fn(async () => true),
}))

import { expireStaleRuns, getBlockingRun, runIdleTimeoutMin } from '~/lib/team.server'

beforeEach(() => {
  state.updates = []
  state.selectResults = []
})

/** Minutes between now and the newest Date parameter in a rendered where. */
function cutoffAgeMinutes(where: unknown): number {
  const { params } = new PgDialect().sqlToQuery(where as SQL)
  const dates = params.filter((p): p is Date => p instanceof Date)
  expect(dates.length).toBeGreaterThan(0)
  return Math.round((Date.now() - dates[0]!.getTime()) / 60_000)
}

describe('runIdleTimeoutMin', () => {
  it('gives social a 60-minute threshold, 4-6x its normal 10-15 min runtime', () => {
    expect(runIdleTimeoutMin('social')).toBe(60)
  })

  it('keeps the measured-slow teams on the generous 240 default', () => {
    // Content p95 quiet stretch is 45.6 min with a 155.6 max; anything short
    // re-creates the run-106 false-reap bug. Do not lower these without data.
    expect(runIdleTimeoutMin('content')).toBe(240)
    expect(runIdleTimeoutMin('homepage')).toBe(240)
  })

  it('gives strategy a 120-minute threshold, ~1.2x its 102.5 min measured max', () => {
    // Ticket #5252: three strategy runs auto-expired at 240 in one 7d window
    // (390/414/420), each holding the lock ~148 min past death and skipping a
    // real QA/apply sibling at only ~92 min idle. 120 is above the 102.5 min
    // healthy max, so a slow run is safe while a dead one unblocks ~2h sooner.
    // This is the threshold for the SHORT strategy runTypes (dev/qa/apply);
    // see the runType override below for the long weekly retro.
    expect(runIdleTimeoutMin('strategy')).toBe(120)
    expect(runIdleTimeoutMin('strategy', 'dev')).toBe(120)
    expect(runIdleTimeoutMin('strategy', 'qa')).toBe(120)
  })

  it('gives strategy runType "strategy" (the weekly cross-team retro) a 360-minute threshold', () => {
    // Ticket #6760: run 603 (2026-08-31) legitimately posted its first event
    // 5h14m after starting -- five sub-agents run in series before the
    // retro-writing phase produces anything event-worthy -- then finished
    // successfully. #5252's 102.5 min healthy max was measured across the
    // short strategy runTypes (dev/qa/apply) and never applied to this one.
    // 360 sits safely above the observed 5h14m gap; the team-level 120 stays
    // correct for dev/qa/apply, which is why this is a runType override
    // rather than a change to the team-level number.
    expect(runIdleTimeoutMin('strategy', 'strategy')).toBe(360)
  })

  it('an unknown runType on a team with a runType override falls back to the team-level number', () => {
    expect(runIdleTimeoutMin('strategy', 'some-future-run-type')).toBe(120)
  })
})

describe('expireStaleRuns', () => {
  it('sweeps override teams on their own cutoff, the strategy runType override on its own, and everything else on the default', async () => {
    await expireStaleRuns()

    // Ticket #6760 adds a 4th (tier-3, per-runType) sweep alongside the
    // pre-existing default + 2 team-level sweeps.
    expect(state.updates.length).toBe(4)
    const [dflt, social, strategy, strategyRetro] = state.updates

    // Default sweep: 240-minute cutoff, excludes every override team so a
    // fast-team zombie is never given the long leash.
    expect(dflt!.vals['status']).toBe('failed')
    expect(String(dflt!.vals['error'])).toContain('240 minutes')
    const dfltSql = new PgDialect().sqlToQuery(dflt!.where as SQL)
    expect(dfltSql.sql.toLowerCase()).toContain('not in')
    expect(dfltSql.params).toContain('social')
    expect(dfltSql.params).toContain('strategy')
    expect(cutoffAgeMinutes(dflt!.where)).toBeGreaterThanOrEqual(239)
    expect(cutoffAgeMinutes(dflt!.where)).toBeLessThanOrEqual(241)

    // Social sweep: 60-minute cutoff scoped to the social team only. Run 251
    // would have been reaped by 15:22 instead of 20:04 under this.
    expect(String(social!.vals['error'])).toContain('60 minutes')
    expect(new PgDialect().sqlToQuery(social!.where as SQL).params).toContain('social')
    expect(cutoffAgeMinutes(social!.where)).toBeGreaterThanOrEqual(59)
    expect(cutoffAgeMinutes(social!.where)).toBeLessThanOrEqual(61)

    // Strategy team sweep: 120-minute cutoff scoped to the strategy team,
    // EXCLUDING the 'strategy' runType (ticket #5252 + #6760) so the weekly
    // retro's own longer tier-3 cutoff below is never double-reaped by this
    // tighter one first.
    expect(String(strategy!.vals['error'])).toContain('120 minutes')
    const strategySql = new PgDialect().sqlToQuery(strategy!.where as SQL)
    expect(strategySql.sql.toLowerCase()).toContain('not in')
    expect(strategySql.params).toContain('strategy')
    expect(cutoffAgeMinutes(strategy!.where)).toBeGreaterThanOrEqual(119)
    expect(cutoffAgeMinutes(strategy!.where)).toBeLessThanOrEqual(121)

    // Strategy runType 'strategy' sweep (ticket #6760): 360-minute cutoff,
    // scoped to team=strategy AND runType=strategy only.
    expect(String(strategyRetro!.vals['error'])).toContain('360 minutes')
    const retroSql = new PgDialect().sqlToQuery(strategyRetro!.where as SQL)
    expect(retroSql.params).toContain('strategy')
    expect(cutoffAgeMinutes(strategyRetro!.where)).toBeGreaterThanOrEqual(359)
    expect(cutoffAgeMinutes(strategyRetro!.where)).toBeLessThanOrEqual(361)
  })
})

describe('getBlockingRun', () => {
  it('returns null when no live sibling holds the lock', async () => {
    state.selectResults = [[]]
    expect(await getBlockingRun('social')).toBeNull()
  })

  it('names the blocking run with its idle age, so a gate refusal is actionable', async () => {
    state.selectResults = [[{ id: 251, runType: 'social', idleSec: 20_520 }]]
    const blocking = await getBlockingRun('social', 254)
    expect(blocking).toEqual({ id: 251, runType: 'social', idleMinutes: 342 })
  })
})
