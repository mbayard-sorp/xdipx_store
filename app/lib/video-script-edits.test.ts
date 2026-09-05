/**
 * listOwnerScriptEdits (ticket #7567, B1 of #7559 — Part B of #7557): the
 * writers room's read side of editEpisodeScript's diff capture. Covers only
 * the read op; the write side (editEpisodeScript's diff-capture inserts) is
 * covered in video-episode-lifecycle.test.ts alongside its other tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface EditRow {
  id: number
  episodeId: number
  field: string
  before: string | null
  after: string
  editedBy: string
  createdAt: string
}

const state = vi.hoisted(() => ({
  rows: [] as EditRow[],
  /** Captured (where, limit) args from the one select chain this module builds. */
  lastWhere: undefined as unknown,
  lastLimit: undefined as number | undefined,
}))

vi.mock('./db.server', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          state.lastWhere = cond
          return {
            orderBy: () => ({
              limit: (n: number) => {
                state.lastLimit = n
                return Promise.resolve(state.rows)
              },
            }),
          }
        },
      }),
    }),
  },
}))

// Pulled in only for proposeEpisodes' dry-run; irrelevant here and cyclic if real
// (same mock as video-episode-lifecycle.test.ts, which exercises the rest of this module).
vi.mock('./video-pipeline.server', () => ({ dryRunEpisodeScript: vi.fn() }))

import { listOwnerScriptEdits } from './video-episodes.server'

function edit(over: Partial<EditRow> = {}): EditRow {
  return {
    id: 1,
    episodeId: 7,
    field: 'script.cta',
    before: 'old cta',
    after: 'new cta',
    editedBy: 'mike@xdipx.com',
    createdAt: '2026-09-05T00:00:00.000Z',
    ...over,
  }
}

beforeEach(() => {
  state.rows = []
  state.lastWhere = undefined
  state.lastLimit = undefined
})

describe('listOwnerScriptEdits', () => {
  it('returns the rows the query resolves', async () => {
    state.rows = [edit(), edit({ id: 2, field: 'script.voiceover' })]
    await expect(listOwnerScriptEdits()).resolves.toEqual({ edits: state.rows })
  })

  it('passes an episodeId filter through as a where condition', async () => {
    await listOwnerScriptEdits({ episodeId: 7 })
    expect(state.lastWhere).toBeDefined()
  })

  it('omits the where condition when no episodeId is given', async () => {
    await listOwnerScriptEdits()
    expect(state.lastWhere).toBeUndefined()
  })

  it('defaults the limit to 50', async () => {
    await listOwnerScriptEdits()
    expect(state.lastLimit).toBe(50)
  })

  it('clamps a requested limit to the 1-200 range', async () => {
    await listOwnerScriptEdits({ limit: 5000 })
    expect(state.lastLimit).toBe(200)
    await listOwnerScriptEdits({ limit: 0 })
    expect(state.lastLimit).toBe(1)
  })
})
