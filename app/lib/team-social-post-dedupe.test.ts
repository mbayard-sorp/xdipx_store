/**
 * Ticket #4069: idempotency guard on `createDraftSocialPost`.
 *
 * Root cause (see PR body for the row evidence): the drafting path had no
 * guard at all against submitting the same post twice. Evidence from prod
 * social_posts: id 46 (Instagram, "starting a little series: the vibrator
 * field guide...") sat `pending_review`, unresolved, when id 47 was written
 * eight minutes later with byte-identical `tweetText` for the same
 * `scheduledFor` day and went on to publish — a genuine sibling row for a
 * post that was still in flight, not a legitimate rework (rows 43-45 ARE
 * legitimate reworks: each was created only after its predecessor had
 * already resolved to a terminal `rejected` review status, which is the
 * `reworkedFrom` chain working as designed).
 *
 * `createDraftSocialPost` now checks for an existing row with the same
 * platform + exact caption + campaign day that is still in an open review
 * state (`pending_review`/`needs_changes`) before inserting, and returns
 * that row's id with `deduped:true` instead of creating a sibling —
 * mirroring the `{id, deduped}` shape `createSuggestionDetailed` already
 * uses for the suggestion bus's `dedupeKey`.
 *
 * Same discipline as team-tickets.test.ts: the database here is PRODUCTION,
 * so the db client (and kv.server) are mocked out entirely at import time.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    /** FIFO of row-arrays handed to successive db.select() chains. */
    selects: [] as unknown[][],
    /** FIFO of row-arrays handed to successive db.insert()...returning() chains. */
    insertResults: [] as unknown[][],
    /** Every predicate passed to a select's .where(), in order. */
    selectWheres: [] as unknown[],
    /** Every value object passed to .values(), in order. */
    inserts: [] as unknown[],
  }

  /** A thenable proxy: any method returns itself, awaiting it yields result(). */
  function chain(result: () => unknown, onCall?: (m: string, args: unknown[]) => void) {
    const proxy: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
            Promise.resolve(result()).then(ok, err)
        }
        return (...args: unknown[]) => {
          onCall?.(String(prop), args)
          return proxy
        }
      },
    }) as Record<string, unknown>
    return proxy
  }

  const db = {
    select: () => chain(
      () => state.selects.shift() ?? [],
      (m, args) => { if (m === 'where') state.selectWheres.push(args[0]) },
    ),
    insert: () => chain(
      () => state.insertResults.shift() ?? [],
      (m, args) => { if (m === 'values') state.inserts.push(args[0]) },
    ),
  }
  return { state, db }
})

vi.mock('~/lib/db.server', () => ({ db: h.db }))
vi.mock('~/lib/kv.server', () => ({
  cached: async (_k: string, _t: number, fn: () => unknown) => fn(),
  invalidateCache: () => {},
  kvDel: async () => {},
  kvGet: async () => null,
  kvSet: async () => {},
  kvSetNX: async () => false,
}))

import { createDraftSocialPost } from '~/lib/team.server'

const DRAFT = {
  platform:  'instagram',
  postType:  'manual',
  tweetText: 'starting a little series: the vibrator field guide.',
  scheduledFor: '2026-08-16',
}

beforeEach(() => {
  h.state.selects.length = 0
  h.state.insertResults.length = 0
  h.state.selectWheres.length = 0
  h.state.inserts.length = 0
})

describe('createDraftSocialPost idempotency guard (#4069)', () => {
  it('inserts a fresh row and returns deduped:false when no open duplicate exists', async () => {
    h.state.selects.push([]) // findOpenDuplicateDraft: no match
    h.state.insertResults.push([{ id: 47 }])
    const result = await createDraftSocialPost(DRAFT)
    expect(result).toEqual({ id: 47, deduped: false })
    expect(h.state.inserts).toHaveLength(1)
  })

  // The retry path (id 46 -> 47 in the row evidence above): a second draft
  // call for the same platform/caption/day while the first is still
  // pending_review must land on the existing row, not create a sibling.
  it('returns the existing row and skips the insert when an open duplicate exists', async () => {
    h.state.selects.push([{ id: 46 }])
    const result = await createDraftSocialPost(DRAFT)
    expect(result).toEqual({ id: 46, deduped: true })
    expect(h.state.inserts).toHaveLength(0)
  })

  it('scopes the duplicate lookup by platform, caption, campaign day, and open review status', async () => {
    h.state.selects.push([])
    h.state.insertResults.push([{ id: 50 }])
    await createDraftSocialPost(DRAFT)
    expect(h.state.selectWheres).toHaveLength(1)
  })

  it('does not dedupe a genuine rework once the prior row resolved (rejected is terminal)', async () => {
    // A rejected predecessor never comes back from findOpenDuplicateDraft
    // (its WHERE only matches pending_review/needs_changes at the DB layer),
    // so this mirrors rows 43-45's real, legitimate reworkedFrom chain.
    h.state.selects.push([])
    h.state.insertResults.push([{ id: 45 }])
    const result = await createDraftSocialPost({ ...DRAFT, reworkedFrom: 44 })
    expect(result).toEqual({ id: 45, deduped: false })
    expect(h.state.inserts).toHaveLength(1)
  })

  it('still dedupes when no scheduledFor is given (platform + caption + open status alone)', async () => {
    h.state.selects.push([{ id: 12 }])
    const result = await createDraftSocialPost({
      platform: 'instagram', postType: 'manual', tweetText: 'no day set',
    })
    expect(result).toEqual({ id: 12, deduped: true })
    expect(h.state.inserts).toHaveLength(0)
  })
})
