/**
 * Ticket #5429: the social image cap was miswired four ways, all of which
 * conspired to make the daily social routine refuse itself for reasons
 * unrelated to actual spend (run 475, 2026-08-24: an 'over_image_cap' skip
 * dropped the entire evening run — drafting, rework, the Step 6.5 gate sweep,
 * Step 7b triage — over 13 images against a 12 cap that real metered spend
 * never came close to, $0.161/day against a $20/day cap).
 *
 * No DB harness in this suite (same discipline as owner-digest.server.test.ts
 * and team-social-review-gate-block.test.ts: the database is PRODUCTION), so
 * `getTodayImageCount`'s SQL is rendered via PgDialect and asserted on shape,
 * and `imageCapRefusesRun` — the pure predicate `gate()` composes — is tested
 * directly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

const executeMock = vi.hoisted(() => vi.fn())
const kvGetMock = vi.hoisted(() => vi.fn(async () => null))
const kvSetMock = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('~/lib/db.server', () => ({ db: { execute: executeMock } }))
vi.mock('~/lib/kv.server', () => ({
  kvGet: kvGetMock,
  kvSet: kvSetMock,
  kvSetNX: vi.fn(async () => true),
  kvDel: vi.fn(async () => undefined),
  cached: vi.fn(async (_key: string, _ttl: number, fn: () => unknown) => fn()),
  invalidateCache: vi.fn(),
}))

import { getTodayImageCount, imageCapRefusesRun } from '~/lib/team.server'
import { TEAM_IMAGE_FEATURES, OWNER_IMAGE_CALLERS } from '~/lib/team-keys'

function emittedQuery() {
  const passed = executeMock.mock.calls[0]?.[0]
  const q = new PgDialect().sqlToQuery(passed)
  return { sql: q.sql, params: q.params }
}

beforeEach(() => {
  executeMock.mockReset()
  kvGetMock.mockReset()
  kvGetMock.mockResolvedValue(null) // no cache hit -> always reseeds from db.execute
  kvSetMock.mockReset()
  kvSetMock.mockResolvedValue(undefined)
  executeMock.mockResolvedValue({ rows: [{ n: 0 }] })
})

describe('TEAM_IMAGE_FEATURES / OWNER_IMAGE_CALLERS (fix 1 & 2, canonical vocab)', () => {
  it('social counts social-drafts alongside social-images (fix 1)', () => {
    expect(TEAM_IMAGE_FEATURES.social).toContain('social-images')
    expect(TEAM_IMAGE_FEATURES.social).toContain('social-drafts')
  })
  it('lists both owner-initiated callers (fix 2)', () => {
    expect(OWNER_IMAGE_CALLERS).toContain('owner-slate-preview')
    expect(OWNER_IMAGE_CALLERS).toContain('owner-studio')
  })
})

describe('getTodayImageCount (fixes 1, 2, 3)', () => {
  it('fix 1: sums only rows carrying zero tokens, under the team image features', async () => {
    await getTodayImageCount('social')
    const { sql } = emittedQuery()
    expect(sql).toMatch(/feature\s+in/i)
    expect(sql).toMatch(/input_tokens\s*=\s*0/i)
    expect(sql).toMatch(/output_tokens\s*=\s*0/i)
  })

  it('fix 1: the feature list includes social-drafts, not only social-images', async () => {
    await getTodayImageCount('social')
    const { params } = emittedQuery()
    expect(params).toContain('social-images')
    expect(params).toContain('social-drafts')
  })

  it('fix 2: excludes owner-initiated preview/regenerate callers', async () => {
    await getTodayImageCount('social')
    const { sql, params } = emittedQuery()
    expect(sql).toMatch(/caller\s+is\s+null\s+or\s+caller\s+not\s+in/i)
    expect(params).toContain('owner-slate-preview')
    expect(params).toContain('owner-studio')
  })

  it('fix 3: the day boundary is an explicit UTC timestamp, never the bare current_date', async () => {
    await getTodayImageCount('social')
    const { sql, params } = emittedQuery()
    expect(sql).not.toMatch(/current_date/i)
    expect(sql).toMatch(/ts\s*>=/i)
    // One bound param is an explicit UTC-midnight ISO string (YYYY-MM-DDT00:00:00Z).
    expect(params.some(p => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(p))).toBe(true)
  })

  it('returns 0 without querying at all for a team with no configured image features', async () => {
    const n = await getTodayImageCount('ads')
    expect(n).toBe(0)
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('reads the summed count back from the query result', async () => {
    executeMock.mockResolvedValue({ rows: [{ n: 34 }] })
    const n = await getTodayImageCount('social')
    expect(n).toBe(34)
  })
})

describe('imageCapRefusesRun (fix 4, pure)', () => {
  it('never refuses the run for social, whatever the cap says', () => {
    expect(imageCapRefusesRun('social', true)).toBe(false)
    expect(imageCapRefusesRun('social', false)).toBe(false)
  })

  it('still refuses the run for homepage when over cap (byte-for-byte historical behavior)', () => {
    expect(imageCapRefusesRun('homepage', true)).toBe(true)
    expect(imageCapRefusesRun('homepage', false)).toBe(false)
  })

  it('still refuses the run for content when over cap (deliberately not re-litigated here)', () => {
    expect(imageCapRefusesRun('content', true)).toBe(true)
    expect(imageCapRefusesRun('content', false)).toBe(false)
  })

  it('never refuses when the cap was not exceeded, for any team', () => {
    for (const team of ['homepage', 'social', 'content', 'ads', 'email'] as const) {
      expect(imageCapRefusesRun(team, false)).toBe(false)
    }
  })
})
