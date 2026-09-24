/**
 * The pitch loop (plan Phase 2b): the pitch stored on propose, the room's
 * episode-revise write-back, and the owner's line notes.
 *
 * The db is mocked as a chain whose every method returns itself and whose
 * await resolves to the next queued select result, so propose's three
 * differently-shaped reads and revise's conditional update all run against
 * one small fake. Writes are captured for assertion.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  /** Results for successive db.select(...) chains, in call order. */
  selects: [] as unknown[][],
  sets: [] as Record<string, unknown>[],
  /** Rows the update's returning() pretends to have matched. */
  updateReturns: [{ id: 7 }] as { id: number }[],
  inserts: [] as unknown[],
  dryRun: vi.fn(),
  maxCostCents: 500 as number | null,
}))

vi.mock('./db.server', () => {
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {}
    for (const m of ['from', 'where', 'orderBy', 'limit']) c[m] = () => c
    c['then'] = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej)
    return c
  }
  return {
    db: {
      select: () => chain(() => state.selects.shift() ?? []),
      update: () => ({
        set: (payload: Record<string, unknown>) => {
          state.sets.push(payload)
          const w = { returning: () => Promise.resolve(state.updateReturns), then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r) }
          return { where: () => w }
        },
      }),
      insert: () => ({
        values: (payload: unknown) => {
          state.inserts.push(payload)
          const p = Promise.resolve(undefined) as Promise<unknown> & { returning?: () => Promise<unknown> }
          // Echo the inserted rows back as RETURNING would (propose maps by episodeUid).
          p.returning = () => Promise.resolve(Array.isArray(payload)
            ? (payload as { episodeUid?: string; episodeNumber?: number }[]).map((r, i) => ({ id: 100 + i, episodeUid: r.episodeUid, episodeNumber: r.episodeNumber }))
            : [])
          return p
        },
      }),
    },
  }
})
vi.mock('./video-pipeline.server', () => ({
  dryRunEpisodeScript: state.dryRun,
  getMaxCostCents: () => (state.maxCostCents == null ? Promise.reject(new Error('no row')) : Promise.resolve(state.maxCostCents)),
}))

import { addLineNote, EpisodeReviseError, proposeEpisodes, reviseEpisodeScript } from './video-episodes.server'

interface Ep {
  id: number
  productionStatus: string
  scriptJson: Record<string, unknown> | null
  siteCutJson: null
  reviewNotesJson: unknown[] | null
  modelTier: string | null
  estCostUsd: string | null
}

function ep(over: Partial<Ep> = {}): Ep {
  return {
    id: 7,
    productionStatus: 'pending_approval',
    scriptJson: {
      presenterLine: 'old line',
      captions: { instagram: 'old ig', x: 'old x' },
      pitch: { format: 'spec-roast', productHandle: 'wand-1', readAudioUrl: 'https://cdn.test/read.mp3', estCostUsd: 0.8 },
    },
    siteCutJson: null,
    reviewNotesJson: null,
    modelTier: null,
    estCostUsd: '0.80000',
    ...over,
  }
}

beforeEach(() => {
  state.selects = []
  state.sets = []
  state.updateReturns = [{ id: 7 }]
  state.inserts = []
  state.dryRun.mockReset()
  state.maxCostCents = 500
})

const PITCH = {
  format: 'spec-roast',
  speaker: 'emma',
  fact: '11 settings',
  factSource: 'spec',
  laugh: 'the box is bigger than the toy',
  firstFrameConcept: 'kitchen counter, box open',
  estCostUsd: 0.9,
  readAudioUrl: 'https://cdn.test/read.mp3',
  productHandle: 'wand-1',
  alternate: true,
}

describe('episode-propose stores the pitch', () => {
  function queuePropose() {
    // resolveSeries hit, then the max(episode_number) read.
    state.selects.push([{ id: 3, slug: 'product-talk', title: 'Product talk' }], [{ max: 4 }])
  }

  it('writes the validated pitch onto scriptJson.pitch and uses its estimate when there is no dry-run', async () => {
    queuePropose()
    const result = await proposeEpisodes({
      seriesSlug: 'product-talk',
      episodes: [{ logline: 'a wand, roasted', formula: 'myth-busting', scriptJson: { presenterLine: 'hi' }, ...PITCH }],
    })
    expect(result.episodes[0]).toMatchObject({ episodeNumber: 5, estCostUsd: 0.9 })
    const inserted = (state.inserts[0] as Record<string, unknown>[])[0]!
    const script = inserted['scriptJson'] as Record<string, unknown>
    expect(script['presenterLine']).toBe('hi')
    expect(script['pitch']).toMatchObject({ format: 'spec-roast', factSource: 'spec', alternate: true, productHandle: 'wand-1' })
    expect(inserted['estCostUsd']).toBe('0.9')
    expect(inserted['productionStatus']).toBe('pending_approval')
  })

  it('leaves a pitchless propose byte-for-byte as before', async () => {
    queuePropose()
    await proposeEpisodes({ seriesSlug: 'product-talk', episodes: [{ logline: 'x', formula: 'myth-busting', scriptJson: { presenterLine: 'hi' } }] })
    const inserted = (state.inserts[0] as Record<string, unknown>[])[0]!
    expect(inserted['scriptJson']).toEqual({ presenterLine: 'hi' })
    expect(inserted['estCostUsd']).toBeNull()
  })

  it('holds a pitch estimate to the per-video ceiling like a dry-run estimate', async () => {
    queuePropose()
    await expect(proposeEpisodes({
      seriesSlug: 'product-talk',
      episodes: [{ logline: 'x', formula: 'myth-busting', ...PITCH, estCostUsd: 6 }],
    })).rejects.toThrow(/over the \$5\.00 per-video ceiling/)
  })

  it('refuses a partial pitch rather than dropping it', async () => {
    queuePropose()
    const { laugh: _l, ...partial } = PITCH
    await expect(proposeEpisodes({
      seriesSlug: 'product-talk',
      episodes: [{ logline: 'x', formula: 'myth-busting', ...partial }],
    })).rejects.toThrow(/episodes\[0\]\.laugh is required/)
    expect(state.inserts).toHaveLength(0)
  })
})

describe('reviseEpisodeScript (episode-revise)', () => {
  it('saves the revision, one video_script_edits row per changed field, editedBy video-room', async () => {
    state.selects.push([ep()])
    const out = await reviseEpisodeScript({
      episodeId: 7,
      fields: { presenterLine: 'new line', captionIg: 'new ig', captionX: 'old x' },
      editedBy: 'video-room',
      note: 'owner said the opener drags',
    })
    expect(out.changedFields).toEqual(['script.presenterLine', 'script.captions.instagram'])
    const rows = state.inserts[0] as Record<string, unknown>[]
    expect(rows).toHaveLength(2)
    expect(rows.every(r => r['editedBy'] === 'video-room')).toBe(true)
    expect(rows[0]).toMatchObject({ field: 'script.presenterLine', before: 'old line', after: 'new line' })
    const set = state.sets[0]!
    const script = set['scriptJson'] as Record<string, unknown>
    expect(script['captions']).toEqual({ instagram: 'new ig', x: 'old x' })
    expect(set['productionStatus']).toBe('pending_approval')
    const notes = set['reviewNotesJson'] as { decision: string; note: string; by: string }[]
    expect(notes.at(-1)).toMatchObject({ decision: 'revised', by: 'video-room' })
    expect(notes.at(-1)!.note).toMatch(/owner said the opener drags/)
  })

  it('returns a needs_changes row to pending_approval', async () => {
    state.selects.push([ep({ productionStatus: 'needs_changes' })])
    const out = await reviseEpisodeScript({ episodeId: 7, fields: { cta: 'Show me' }, editedBy: 'video-room', note: 'answered the note' })
    expect(out.productionStatus).toBe('pending_approval')
    expect(state.sets[0]!['productionStatus']).toBe('pending_approval')
  })

  it.each(['approved', 'rejected', 'rendering', 'posted'])('refuses a %s episode with 409 and writes nothing', async status => {
    state.selects.push([ep({ productionStatus: status })])
    const err = await reviseEpisodeScript({ episodeId: 7, fields: { cta: 'x' }, editedBy: 'video-room', note: 'n' }).catch(e => e)
    expect(err).toBeInstanceOf(EpisodeReviseError)
    expect((err as EpisodeReviseError).status).toBe(409)
    expect(state.sets).toHaveLength(0)
    expect(state.inserts).toHaveLength(0)
  })

  it('refuses with 409 when the owner decided between the read and the write', async () => {
    state.selects.push([ep()])
    state.updateReturns = []
    const err = await reviseEpisodeScript({ episodeId: 7, fields: { cta: 'x' }, editedBy: 'video-room', note: 'n' }).catch(e => e)
    expect((err as EpisodeReviseError).status).toBe(409)
    expect(state.inserts).toHaveLength(0)
  })

  it('404s an unknown episode', async () => {
    state.selects.push([])
    const err = await reviseEpisodeScript({ episodeId: 9, fields: { cta: 'x' }, editedBy: 'video-room', note: 'n' }).catch(e => e)
    expect((err as EpisodeReviseError).status).toBe(404)
  })

  it('never writes under another editor name: the team token cannot forge an owner edit', async () => {
    const err = await reviseEpisodeScript({ episodeId: 7, fields: { cta: 'x' }, editedBy: 'mike@xdipx.com', note: 'n' }).catch(e => e)
    expect((err as EpisodeReviseError).status).toBe(400)
  })

  it('requires a note, a known field, and a non-empty value', async () => {
    const base = { episodeId: 7, editedBy: 'video-room' }
    await expect(reviseEpisodeScript({ ...base, fields: { cta: 'x' }, note: ' ' })).rejects.toThrow(/note is required/)
    await expect(reviseEpisodeScript({ ...base, fields: { hookText: 'x' } as never, note: 'n' })).rejects.toThrow(/unknown field/)
    await expect(reviseEpisodeScript({ ...base, fields: { cta: '' }, note: 'n' })).rejects.toThrow(/non-empty/)
    await expect(reviseEpisodeScript({ ...base, fields: {}, note: 'n' })).rejects.toThrow(/at least one/)
  })

  it('marks the recorded read stale when a spoken line changes without a new read', async () => {
    state.selects.push([ep()])
    await reviseEpisodeScript({ episodeId: 7, fields: { presenterLine: 'new' }, editedBy: 'video-room', note: 'n' })
    const pitch = (state.sets[0]!['scriptJson'] as Record<string, unknown>)['pitch'] as Record<string, unknown>
    expect(pitch['readAudioStale']).toBe(true)
  })

  it('does not mark the read stale for a caption-only revision', async () => {
    state.selects.push([ep()])
    await reviseEpisodeScript({ episodeId: 7, fields: { captionIg: 'new ig' }, editedBy: 'video-room', note: 'n' })
    const pitch = (state.sets[0]!['scriptJson'] as Record<string, unknown>)['pitch'] as Record<string, unknown>
    expect(pitch['readAudioStale']).toBeUndefined()
  })

  it('swaps in a fresh read when one is supplied', async () => {
    state.selects.push([ep({ scriptJson: { presenterLine: 'old', pitch: { format: 'f', productHandle: 'h', readAudioUrl: 'https://cdn.test/a.mp3', readAudioStale: true } } })])
    await reviseEpisodeScript({ episodeId: 7, fields: { presenterLine: 'new' }, editedBy: 'video-room', note: 'n', readAudioUrl: 'https://cdn.test/b.mp3' })
    const pitch = (state.sets[0]!['scriptJson'] as Record<string, unknown>)['pitch'] as Record<string, unknown>
    expect(pitch['readAudioUrl']).toBe('https://cdn.test/b.mp3')
    expect(pitch['readAudioStale']).toBeUndefined()
  })

  it('re-estimates a tiered episode from the dry-run and writes the new estimate', async () => {
    state.selects.push([ep({ modelTier: 'omnihuman' })])
    state.dryRun.mockReturnValue({ estCostUsd: 1.25 })
    const out = await reviseEpisodeScript({ episodeId: 7, fields: { presenterLine: 'longer' }, editedBy: 'video-room', note: 'n' })
    expect(out.estCostUsd).toBe(1.25)
    expect(state.sets[0]!['estCostUsd']).toBe('1.25')
  })

  it('re-runs the dry-run on a tiered episode and refuses an over-ceiling revision', async () => {
    state.selects.push([ep({ modelTier: 'omnihuman' })])
    state.dryRun.mockReturnValue({ estCostUsd: 9.99 })
    const err = await reviseEpisodeScript({ episodeId: 7, fields: { presenterLine: 'a much longer line' }, editedBy: 'video-room', note: 'n' }).catch(e => e)
    expect(state.dryRun).toHaveBeenCalledTimes(1)
    expect((err as EpisodeReviseError).status).toBe(400)
    expect((err as Error).message).toMatch(/ceiling/)
    expect(state.sets).toHaveLength(0)
  })
})

describe('addLineNote', () => {
  it('appends a line_note with field and lineIdx and never touches status or text', async () => {
    state.selects.push([ep({ reviewNotesJson: [{ at: 'x', decision: 'approved', by: 'mike' }] })])
    await addLineNote({ episodeId: 7, field: 'scenes', lineIdx: '1', note: 'cut the clause', by: 'mike' })
    const set = state.sets[0]!
    expect(Object.keys(set).sort()).toEqual(['reviewNotesJson', 'updatedAt'])
    const notes = set['reviewNotesJson'] as Record<string, unknown>[]
    expect(notes).toHaveLength(2)
    expect(notes[1]).toMatchObject({ decision: 'line_note', field: 'scenes', lineIdx: 1, note: 'cut the clause', by: 'mike' })
  })

  it('refuses an invalid note before reading the row', async () => {
    await expect(addLineNote({ episodeId: 7, field: 'logline', lineIdx: 0, note: 'x', by: 'mike' })).rejects.toThrow(/field must be one of/)
    expect(state.sets).toHaveLength(0)
  })
})
