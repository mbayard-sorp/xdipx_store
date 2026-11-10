/**
 * Regression test for ticket #20865: `getSocialImageCostPerPost`'s `ANY(...)`
 * predicate threw `cannot cast type record to text[]` on every call for four
 * weeks, because drizzle's neon-http driver serializes an interpolated JS
 * array as a single bound parameter (which the HTTP client turns into a
 * Postgres ROW/record literal), not a `text[]` array literal.
 *
 * The existing suite in token-log.server.test.ts mocks `~/lib/db.server`'s
 * `db.execute` directly, which returns canned rows regardless of what SQL or
 * params were actually produced — exactly the shape of mock that let this bug
 * ship and sit undetected. This file mocks one level lower, at
 * `@neondatabase/serverless`'s `neon()` client, so drizzle's real SQL
 * compilation and parameter-flattening runs for real; only the network call
 * itself is replaced. That lets the test assert on the actual `(sqlText,
 * params)` pair that would be sent to Neon's HTTP endpoint — the real "driver
 * shape" — without opening a network connection.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const captured: Array<{ sql: string; params: unknown[] }> = []

vi.mock('@neondatabase/serverless', () => ({
  neon: () => (sql: string, params: unknown[]) => {
    captured.push({ sql, params })
    return Promise.resolve({
      rows: [{ published_posts: '0', total_cost_usd: null, total_vision_calls: null }],
    })
  },
}))

import { getSocialImageCostPerPost, SOCIAL_IMAGE_PIPELINE_FEATURES } from '~/lib/token-log.server'

beforeEach(() => {
  captured.length = 0
})

describe('getSocialImageCostPerPost — real driver param shape (#20865)', () => {
  it('never passes a JS array as a single bound parameter', async () => {
    await getSocialImageCostPerPost({ days: 7 })
    expect(captured).toHaveLength(1)
    const { params } = captured[0]!
    // This is the exact defect signature: `${jsArray}::text[]` binds the
    // whole array as one param, which neon-http's HTTP client mis-serializes.
    // A correct query only ever binds scalar (string/number) params.
    for (const p of params) {
      expect(Array.isArray(p)).toBe(false)
    }
  })

  it('builds an ARRAY[...] literal carrying each feature as its own bound param', async () => {
    await getSocialImageCostPerPost({ days: 7 })
    const { sql, params } = captured[0]!
    expect(sql).toMatch(/ANY\(ARRAY\[/)
    for (const feature of SOCIAL_IMAGE_PIPELINE_FEATURES) {
      expect(params).toContain(feature)
    }
  })
})
