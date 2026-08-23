/**
 * Guard tests for the image-spend logger (#5051).
 *
 * Two independent regressions are covered:
 *  (a) a product HANDLE longer than the api_token_log.sku column (varchar(32))
 *      must be clamped, not thrown away — the whole write used to fail with
 *      `value too long for type character varying(32)` and the best-effort
 *      wrapper swallowed it, losing the ledger row AND the gate counter.
 *  (b) the budget-gate counter must be bumped even when the ledger insert
 *      throws (a transient Neon failure surviving the one retry), so the gate
 *      the store relies on to cap runaway spend cannot silently read low.
 *
 * db.server / model-pricing / team-keys / kv.server are mocked at import time.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  inserted: [] as Array<Record<string, unknown>>,
  incr: [] as Array<{ key: string; by: number }>,
  // When true, every db.insert(...).values() rejects (both the initial write
  // and insertTokenRow's single retry), so insertTokenRow throws.
  insertThrows: false,
}

vi.mock('~/lib/db.server', () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        if (state.insertThrows) return Promise.reject(new Error('value too long for type character varying(32)'))
        state.inserted.push(v)
        return Promise.resolve()
      },
    }),
  },
}))

vi.mock('~/lib/model-pricing.server', () => ({
  estimateImageCostUsd: () => 0.04,
}))

vi.mock('~/lib/team-keys', () => ({
  teamFromFeature: () => 'content',
  imageTeamFromFeature: () => 'content',
  teamSpendKvKey: (team: string) => `SPEND:${team}`,
  teamImagesKvKey: (team: string) => `IMAGES:${team}`,
}))

vi.mock('~/lib/kv.server', () => ({
  // Non-null so bumpTeamSpendCounters treats the counter as already seeded.
  kvGet: () => Promise.resolve(100),
  kvIncrBy: (key: string, by: number) => {
    state.incr.push({ key, by })
    return Promise.resolve(1)
  },
}))

import { logImageCost } from '~/lib/token-log.server'

const LONG_HANDLE = 'sliquid-naturals-satin-personal-moisturizer' // 43 chars, > 32

beforeEach(() => {
  state.inserted = []
  state.incr = []
  state.insertThrows = false
})

describe('logImageCost — long product handle (#5051)', () => {
  it('clamps a sku longer than 32 chars and still writes the ledger row', async () => {
    await logImageCost({ feature: 'content-images', model: 'imagen', count: 1, sku: LONG_HANDLE })

    expect(state.inserted).toHaveLength(1)
    const row = state.inserted[0]!
    expect(String(row['sku']).length).toBe(32)
    expect(row['sku']).toBe(LONG_HANDLE.slice(0, 32))
    // The spend counter that backs the budget gate was incremented.
    const spendBump = state.incr.find(i => i.key.startsWith('SPEND:'))
    expect(spendBump).toBeTruthy()
    expect(spendBump!.by).toBe(4) // round(0.04 * 100) cents
  })

  it('still bumps the gate counter when the ledger insert throws', async () => {
    state.insertThrows = true
    await logImageCost({ feature: 'content-images', model: 'imagen', count: 1, sku: LONG_HANDLE })

    // No ledger row landed (insert threw after its retry)...
    expect(state.inserted).toHaveLength(0)
    // ...but the gate counter was bumped anyway, because the bump now runs
    // independently of and before the insert.
    const spendBump = state.incr.find(i => i.key.startsWith('SPEND:'))
    expect(spendBump).toBeTruthy()
    expect(spendBump!.by).toBe(4)
  })

  it('does nothing for a non-positive image count', async () => {
    await logImageCost({ feature: 'content-images', model: 'imagen', count: 0, sku: LONG_HANDLE })
    expect(state.inserted).toHaveLength(0)
    expect(state.incr).toHaveLength(0)
  })
})
