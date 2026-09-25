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

import { listOwnerScriptEdits, listLineNotes, extractLineNotes } from './video-episodes.server'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

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

const dialect = new PgDialect()
const sqlOf = (cond: unknown) => dialect.sqlToQuery(cond as SQL)

describe('listOwnerScriptEdits excludeEditedBy (plan Phase 2b)', () => {
  it('filters the room out by editor name when asked', async () => {
    await listOwnerScriptEdits({ excludeEditedBy: ['video-room'] })
    const q = sqlOf(state.lastWhere)
    expect(q.sql).toMatch(/"edited_by" not in/)
    expect(q.params).toContain('video-room')
  })

  it('combines the exclusion with an episode filter', async () => {
    await listOwnerScriptEdits({ episodeId: 7, excludeEditedBy: ['video-room'] })
    const q = sqlOf(state.lastWhere)
    expect(q.sql).toMatch(/"episode_id" = .* and .*"edited_by" not in/)
  })

  it('an empty exclusion list adds no condition', async () => {
    await listOwnerScriptEdits({ excludeEditedBy: [] })
    expect(state.lastWhere).toBeUndefined()
  })
})

describe('line notes for the retro (plan Phase 2b)', () => {
  const notes = [
    { at: '2026-09-20T10:00:00.000Z', decision: 'approved' as const, by: 'mike' },
    { at: '2026-09-21T10:00:00.000Z', decision: 'line_note' as const, field: 'scenes', lineIdx: 1, note: 'cut the second clause', by: 'mike' },
    { at: '2026-09-22T10:00:00.000Z', decision: 'line_note' as const, field: 'cta', lineIdx: 0, note: 'wrong CTA', by: 'mike' },
  ]

  it('extracts only line_note entries, newest first, with their episode', () => {
    const out = extractLineNotes([{ id: 7, reviewNotesJson: notes }, { id: 8, reviewNotesJson: null }], 50)
    expect(out).toEqual([
      { episodeId: 7, at: '2026-09-22T10:00:00.000Z', field: 'cta', lineIdx: 0, note: 'wrong CTA', by: 'mike' },
      { episodeId: 7, at: '2026-09-21T10:00:00.000Z', field: 'scenes', lineIdx: 1, note: 'cut the second clause', by: 'mike' },
    ])
  })

  it('caps at the limit', () => {
    expect(extractLineNotes([{ id: 7, reviewNotesJson: notes }], 1)).toHaveLength(1)
  })

  it('listLineNotes queries only episodes carrying a line_note and flattens them', async () => {
    ;(state.rows as unknown[]) = [{ id: 7, reviewNotesJson: notes }]
    const out = await listLineNotes({ episodeId: 7 })
    expect(out.map(n => n.field)).toEqual(['cta', 'scenes'])
    const q = sqlOf(state.lastWhere)
    expect(q.sql).toContain('"decision":"line_note"')
    expect(q.sql).toMatch(/"id" = /)
  })
})
