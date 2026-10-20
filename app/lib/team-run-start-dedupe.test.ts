/**
 * Guard tests for ticket #16387: `startRun()`'s retry-dedupe window.
 *
 * A caller that retries `POST /api/team/run {op:'start'}` after a transport
 * hiccup (a dropped connection, a proxy TLS failure) used to mint a brand-new
 * `homepage_team_runs` row every time, each one still counting against that
 * team's `{team}_team_max_runs` cap for the day even though it did no work
 * (runs 1478/1479 and 1325/1326, both self-reported duplicates on retry).
 * `startRun()` now checks for an existing `status:'running'` row for the same
 * team+runType started within `START_RUN_DEDUPE_WINDOW_MS` and reuses its id
 * instead of inserting a new one.
 *
 * db.server is mocked at import time; the real database is production.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  selectResults: [] as unknown[][],
  wheres: [] as unknown[],
  inserts: [] as Array<Record<string, unknown>>,
}

vi.mock('~/lib/db.server', () => {
  const selectChain = () => {
    const chain: Record<string, unknown> = {}
    chain['where'] = (cond: unknown) => {
      state.wheres.push(cond)
      return chain
    }
    chain['orderBy'] = () => chain
    chain['limit'] = () => Promise.resolve(state.selectResults.shift() ?? [])
    return chain
  }
  return {
    db: {
      select: () => ({ from: () => selectChain() }),
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          returning: () => {
            state.inserts.push(v)
            return Promise.resolve([{ id: 999 }])
          },
        }),
      }),
    },
  }
})

import { startRun } from '~/lib/team.server'

beforeEach(() => {
  state.selectResults = []
  state.wheres = []
  state.inserts = []
})

describe('startRun retry dedupe (#16387)', () => {
  it('reuses the existing running row when one started inside the window', async () => {
    state.selectResults = [[{ id: 1543 }]]
    const id = await startRun('strategy', 'dev')
    expect(id).toBe(1543)
    expect(state.inserts).toHaveLength(0)
  })

  it('inserts a new row when no recent running row exists', async () => {
    state.selectResults = [[]]
    const id = await startRun('strategy', 'dev')
    expect(id).toBe(999)
    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0]).toEqual({ team: 'strategy', runType: 'dev', status: 'running' })
  })

  it('checks team, runType, status, and recency before reusing a row', async () => {
    state.selectResults = [[]]
    await startRun('social', 'social')
    expect(state.wheres).toHaveLength(1)
    expect(state.wheres[0]).toBeDefined()
  })
})
