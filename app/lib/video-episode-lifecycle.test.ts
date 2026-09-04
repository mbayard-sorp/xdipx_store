/**
 * The episode claim lifecycle (ticket #5726).
 *
 * claimNextEpisode stamps 'rendering' before the render lane knows whether it
 * can enqueue, and only 'approved' rows are claimable — so every path OUT of
 * 'rendering' is load-bearing. Before this ticket there were none: a refused
 * enqueue, a failed render, or a crashed run left the row unclaimable AND
 * undecidable, its episode number spent and its open loop never closing.
 *
 * The db is mocked to the thinnest thing these four functions actually touch:
 * one select-by-id, and one update whose set/where is captured for assertion.
 *
 * Lives in app/lib beside the module under test; video-episodes.test.ts covers
 * the pure validators in the non-.server twin.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface EpisodeRow {
  id: number
  productionStatus: string
  videoJobId: number | null
  priorJobIdsJson: number[] | null
  reviewNotesJson: unknown[] | null
  plannedSlotAt: Date | null
  scriptJson: Record<string, unknown> | null
  siteCutJson: { title?: string; dek?: string; copy?: string } | null
}

const state = vi.hoisted(() => ({
  row: null as EpisodeRow | null,
  /** Every db.update(...).set(...) payload, in order. */
  sets: [] as Record<string, unknown>[],
  /** Rows the update pretends to have matched (drives the boolean returns). */
  updateReturns: [] as { id: number }[],
}))

vi.mock('./db.server', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(state.row ? [state.row] : []) }),
      }),
    }),
    update: () => ({
      set: (payload: Record<string, unknown>) => {
        state.sets.push(payload)
        return {
          where: () => ({ returning: () => Promise.resolve(state.updateReturns) }),
          returning: () => Promise.resolve(state.updateReturns),
        }
      },
    }),
  },
}))
// Pulled in only for proposeEpisodes' dry-run; irrelevant here and cyclic if real.
vi.mock('./video-pipeline.server', () => ({ dryRunEpisodeScript: vi.fn() }))

import {
  releaseEpisodeClaim,
  markEpisodeRenderFailed,
  reapStaleEpisodeClaims,
  decideEpisode,
  editEpisodeScript,
} from './video-episodes.server'

function episode(over: Partial<EpisodeRow> = {}): EpisodeRow {
  return {
    id: 7,
    productionStatus: 'rendering',
    videoJobId: null,
    priorJobIdsJson: null,
    reviewNotesJson: null,
    plannedSlotAt: null,
    scriptJson: null,
    siteCutJson: null,
    ...over,
  }
}

beforeEach(() => {
  state.row = null
  state.sets = []
  state.updateReturns = [{ id: 7 }]
})

describe('releaseEpisodeClaim', () => {
  it('hands a claimed-but-unrendered episode back to approved', async () => {
    state.row = episode()
    await expect(releaseEpisodeClaim(7, 'gated')).resolves.toBe(true)
    expect(state.sets[0]).toMatchObject({ productionStatus: 'approved', renderStartedAt: null })
  })

  it('records why, so the retro can read it back', async () => {
    state.row = episode()
    await releaseEpisodeClaim(7, 'over_ceiling')
    const notes = state.sets[0]?.['reviewNotesJson'] as { decision: string; note: string }[]
    expect(notes).toHaveLength(1)
    expect(notes[0]?.decision).toBe('released')
    expect(notes[0]?.note).toMatch(/over_ceiling/)
  })

  it('appends to existing notes rather than overwriting them', async () => {
    state.row = episode({ reviewNotesJson: [{ at: 'x', decision: 'approved', by: 'mike' }] })
    await releaseEpisodeClaim(7, 'gated')
    expect(state.sets[0]?.['reviewNotesJson']).toHaveLength(2)
  })

  it('refuses a row that already reached a provider — that outcome is the job’s', async () => {
    state.row = episode({ videoJobId: 42 })
    await expect(releaseEpisodeClaim(7, 'gated')).resolves.toBe(false)
    expect(state.sets).toHaveLength(0)
  })

  it('refuses a row that is not claimed', async () => {
    state.row = episode({ productionStatus: 'approved' })
    await expect(releaseEpisodeClaim(7, 'gated')).resolves.toBe(false)
    expect(state.sets).toHaveLength(0)
  })

  it('refuses a missing episode', async () => {
    state.row = null
    await expect(releaseEpisodeClaim(7, 'gated')).resolves.toBe(false)
  })
})

describe('markEpisodeRenderFailed', () => {
  it('moves a rendering episode to failed with the reason attached', async () => {
    state.row = episode()
    await expect(markEpisodeRenderFailed(7, 'job vid-1 failed: runpod timed out')).resolves.toBe(true)
    expect(state.sets[0]).toMatchObject({ productionStatus: 'failed' })
    const notes = state.sets[0]?.['reviewNotesJson'] as { decision: string; note: string }[]
    expect(notes[0]?.decision).toBe('render_failed')
    expect(notes[0]?.note).toMatch(/runpod timed out/)
  })

  it('does NOT auto-return to approved: a deterministic failure would re-burn GPU every run', async () => {
    state.row = episode()
    await markEpisodeRenderFailed(7, 'tier not implemented by the worker image')
    expect(state.sets[0]?.['productionStatus']).not.toBe('approved')
  })

  it('leaves an already-posted episode alone', async () => {
    state.row = episode({ productionStatus: 'posted' })
    await expect(markEpisodeRenderFailed(7, 'late failure')).resolves.toBe(false)
    expect(state.sets).toHaveLength(0)
  })
})

describe('reapStaleEpisodeClaims', () => {
  it('returns claims with no job attached to approved', async () => {
    state.updateReturns = [{ id: 7 }, { id: 9 }]
    await expect(reapStaleEpisodeClaims()).resolves.toBe(2)
    expect(state.sets[0]).toMatchObject({ productionStatus: 'approved', renderStartedAt: null })
  })

  it('reports zero when nothing is stale', async () => {
    state.updateReturns = []
    await expect(reapStaleEpisodeClaims()).resolves.toBe(0)
  })
})

describe('decideEpisode on a failed render', () => {
  it('lets the owner retake a failed episode', async () => {
    state.row = episode({ productionStatus: 'failed', videoJobId: 42 })
    await decideEpisode({ episodeId: 7, decision: 'approved', decidedBy: 'mike@xdipx.com' })
    expect(state.sets[0]).toMatchObject({ productionStatus: 'approved', videoJobId: null, renderStartedAt: null })
  })

  it('retires the dead job onto prior_job_ids so a second retake is possible', async () => {
    state.row = episode({ productionStatus: 'failed', videoJobId: 42, priorJobIdsJson: [11] })
    await decideEpisode({ episodeId: 7, decision: 'approved', decidedBy: 'mike@xdipx.com' })
    expect(state.sets[0]?.['priorJobIdsJson']).toEqual([11, 42])
  })

  it('lets the owner send a failed episode back to the room instead', async () => {
    state.row = episode({ productionStatus: 'failed', videoJobId: 42 })
    await decideEpisode({ episodeId: 7, decision: 'needs_changes', decidedBy: 'mike@xdipx.com', note: 'rewrite beat 3' })
    expect(state.sets[0]).toMatchObject({ productionStatus: 'needs_changes' })
    // Not a retake: the job link stays for the audit trail.
    expect(state.sets[0]).not.toHaveProperty('videoJobId')
  })

  it('refuses to re-arm an episode whose job is genuinely still rendering', async () => {
    state.row = episode({ productionStatus: 'rendering', videoJobId: 42 })
    await expect(decideEpisode({ episodeId: 7, decision: 'approved', decidedBy: 'mike@xdipx.com' }))
      .rejects.toThrow(/still rendering|wait for that render/)
  })

  it('still allows deciding a claim that never reached a provider', async () => {
    state.row = episode({ productionStatus: 'rendering', videoJobId: null })
    await decideEpisode({ episodeId: 7, decision: 'rejected', decidedBy: 'mike@xdipx.com', note: 'drop it' })
    expect(state.sets[0]).toMatchObject({ productionStatus: 'rejected' })
  })

  it('still refuses a posted episode', async () => {
    state.row = episode({ productionStatus: 'posted' })
    await expect(decideEpisode({ episodeId: 7, decision: 'approved', decidedBy: 'mike@xdipx.com' }))
      .rejects.toThrow(/can be decided/)
  })
})

describe('editEpisodeScript (ticket #7558)', () => {
  it('merges an edited field into scriptJson without dropping the rest', async () => {
    state.row = episode({
      productionStatus: 'pending_approval',
      scriptJson: { presenterLine: 'old line', durationSeconds: 12, sceneSlug: 'kitchen' },
    })
    await editEpisodeScript({ episodeId: 7, editedBy: 'mike@xdipx.com', script: { presenterLine: 'new line' } })
    expect(state.sets[0]?.['scriptJson']).toEqual({ presenterLine: 'new line', durationSeconds: 12, sceneSlug: 'kitchen' })
  })

  it('merges caption edits shallowly, per platform key, leaving other platforms untouched', async () => {
    state.row = episode({
      productionStatus: 'approved',
      scriptJson: { captions: { instagram: 'old ig caption', tiktok: 'old tiktok caption' } },
    })
    await editEpisodeScript({ episodeId: 7, editedBy: 'mike@xdipx.com', script: { captions: { instagram: 'new ig caption' } } })
    expect((state.sets[0]?.['scriptJson'] as { captions: Record<string, string> }).captions).toEqual({
      instagram: 'new ig caption',
      tiktok: 'old tiktok caption',
    })
  })

  it('merges siteCut edits into siteCutJson without dropping untouched fields', async () => {
    state.row = episode({ productionStatus: 'needs_changes', siteCutJson: { title: 'old title', dek: 'old dek' } })
    await editEpisodeScript({ episodeId: 7, editedBy: 'mike@xdipx.com', siteCut: { title: 'new title' } })
    expect(state.sets[0]?.['siteCutJson']).toEqual({ title: 'new title', dek: 'old dek' })
  })

  it('appends an "edited" review note without overwriting prior notes', async () => {
    state.row = episode({
      productionStatus: 'approved',
      reviewNotesJson: [{ at: '2026-09-01T00:00:00.000Z', decision: 'approved', by: 'mike@xdipx.com' }],
    })
    await editEpisodeScript({ episodeId: 7, editedBy: 'mike@xdipx.com', script: { cta: 'new cta' } })
    const notes = state.sets[0]?.['reviewNotesJson'] as { decision: string }[]
    expect(notes).toHaveLength(2)
    expect(notes[0]?.decision).toBe('approved')
    expect(notes[1]?.decision).toBe('edited')
  })

  it('never touches productionStatus (edit is not a decision)', async () => {
    state.row = episode({ productionStatus: 'needs_changes' })
    await editEpisodeScript({ episodeId: 7, editedBy: 'mike@xdipx.com', script: { voiceover: 'new voiceover' } })
    expect(state.sets[0]).not.toHaveProperty('productionStatus')
  })

  it.each(['rendering', 'rendered', 'scheduled', 'posted', 'measured', 'shelved'])(
    'refuses to edit a script once the episode is %s',
    async status => {
      state.row = episode({ productionStatus: status })
      await expect(editEpisodeScript({ episodeId: 7, editedBy: 'mike@xdipx.com', script: { cta: 'x' } }))
        .rejects.toThrow(/script edits are not allowed/)
      expect(state.sets).toHaveLength(0)
    },
  )

  it('allows editing on statuses short of render', async () => {
    for (const status of ['idea', 'drafting', 'pending_approval', 'needs_changes', 'approved', 'failed', 'rejected']) {
      state.row = episode({ productionStatus: status })
      state.sets = []
      await editEpisodeScript({ episodeId: 7, editedBy: 'mike@xdipx.com', script: { cta: 'x' } })
      expect(state.sets).toHaveLength(1)
    }
  })

  it('refuses when neither script nor siteCut is given', async () => {
    state.row = episode({ productionStatus: 'approved' })
    await expect(editEpisodeScript({ episodeId: 7, editedBy: 'mike@xdipx.com' }))
      .rejects.toThrow(/requires at least one/)
  })

  it('refuses an unknown episode', async () => {
    state.row = null
    await expect(editEpisodeScript({ episodeId: 999, editedBy: 'mike@xdipx.com', script: { cta: 'x' } }))
      .rejects.toThrow(/not found/)
  })
})
