/**
 * Episode claim lifecycle (this ticket): a claimed-but-unrendered episode can
 * return to 'approved' (releaseEpisodeClaim / reapStaleEpisodeClaims), a dead
 * job takes its episode to 'failed' and no further (markEpisodeRenderFailed),
 * and the owner decides a failed row with retake/reroute/drop (decideEpisode),
 * a retake retiring the dead job into prior_job_ids_json.
 *
 * The db layer is mocked: what is under test is the decision/transition logic
 * and the exact UPDATE payload, not SQL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  selectRows: [] as Record<string, unknown>[],   // db.select().from().where().limit()
  staleRows: [] as Record<string, unknown>[],    // db.select().from().leftJoin().where()
  updateReturns: [] as Array<Array<{ id: number }>>, // queue for .returning()
  updateCalls: [] as Record<string, unknown>[],  // captured .set() payloads
}))

vi.mock('~/lib/db.server', () => {
  const selectWhere: Record<string, unknown> = {
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(state.staleRows).then(res, rej),
    limit: () => Promise.resolve(state.selectRows),
  }
  const selectChain: Record<string, unknown> = {
    from: () => selectChain,
    leftJoin: () => selectChain,
    where: () => selectWhere,
    orderBy: () => selectChain,
  }
  const updateWhere: Record<string, unknown> = {
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(undefined).then(res, rej),
    returning: () => Promise.resolve(state.updateReturns.shift() ?? []),
  }
  const updateChain = {
    set: (v: Record<string, unknown>) => { state.updateCalls.push(v); return { where: () => updateWhere } },
  }
  return { db: { select: () => selectChain, update: () => updateChain } }
})

// Keep the heavy pipeline module out of the import graph (video-episodes.server
// imports dryRunEpisodeScript from it at module load).
vi.mock('~/lib/video-pipeline.server', () => ({ dryRunEpisodeScript: vi.fn() }))
vi.mock('~/lib/fal-video.server', () => ({ isVideoModelId: () => true }))

import {
  decideEpisode,
  releaseEpisodeClaim,
  markEpisodeRenderFailed,
  reapStaleEpisodeClaims,
} from './video-episodes.server'

function episode(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 42,
    productionStatus: 'failed',
    reviewNotesJson: null,
    videoJobId: 7,
    priorJobIdsJson: null,
    ...over,
  }
}

beforeEach(() => {
  state.selectRows = []
  state.staleRows = []
  state.updateReturns = []
  state.updateCalls.length = 0
})
afterEach(() => vi.clearAllMocks())

describe('decideEpisode — failed-row decisions', () => {
  it('retake re-approves and retires the dead job into prior_job_ids_json', async () => {
    state.selectRows = [episode({ videoJobId: 7, priorJobIdsJson: [3] })]
    await decideEpisode({ episodeId: 42, decision: 'retake', decidedBy: 'owner@x' })
    const set = state.updateCalls[0]!
    expect(set['productionStatus']).toBe('approved')
    expect(set['priorJobIdsJson']).toEqual([3, 7])
    expect(set['videoJobId']).toBeNull()
    expect(set['renderStartedAt']).toBeNull()
    expect(set['approvedBy']).toBe('owner@x')
    const notes = set['reviewNotesJson'] as { decision: string }[]
    expect(notes[notes.length - 1]!.decision).toBe('retake')
  })

  it('retake with no prior jobs starts the retirement list from the dead job', async () => {
    state.selectRows = [episode({ videoJobId: 9, priorJobIdsJson: null })]
    await decideEpisode({ episodeId: 42, decision: 'retake', decidedBy: 'owner@x' })
    expect(state.updateCalls[0]!['priorJobIdsJson']).toEqual([9])
  })

  it('reroute lands the row in needs_changes and requires a note', async () => {
    state.selectRows = [episode()]
    await expect(decideEpisode({ episodeId: 42, decision: 'reroute', decidedBy: 'o' }))
      .rejects.toThrow(/requires a note/)
    state.updateCalls.length = 0
    state.selectRows = [episode()]
    await decideEpisode({ episodeId: 42, decision: 'reroute', decidedBy: 'o', note: 'reblock the beat' })
    expect(state.updateCalls[0]!['productionStatus']).toBe('needs_changes')
  })

  it('drop lands the row in rejected', async () => {
    state.selectRows = [episode()]
    await decideEpisode({ episodeId: 42, decision: 'drop', decidedBy: 'o', note: 'not worth a retake' })
    expect(state.updateCalls[0]!['productionStatus']).toBe('rejected')
    expect(state.updateCalls[0]!['rejectReason']).toBe('not worth a retake')
  })

  it('refuses retake/reroute/drop on a non-failed row', async () => {
    state.selectRows = [episode({ productionStatus: 'approved' })]
    await expect(decideEpisode({ episodeId: 42, decision: 'retake', decidedBy: 'o' }))
      .rejects.toThrow(/require a failed row/)
  })

  it('still handles the pre-render decisions unchanged', async () => {
    state.selectRows = [episode({ productionStatus: 'pending_approval' })]
    await decideEpisode({ episodeId: 42, decision: 'approved', decidedBy: 'owner@x' })
    expect(state.updateCalls[0]!['productionStatus']).toBe('approved')
    expect(state.updateCalls[0]!['approvedBy']).toBe('owner@x')
  })

  it('refuses a pre-render decision on a failed row', async () => {
    state.selectRows = [episode({ productionStatus: 'failed' })]
    await expect(decideEpisode({ episodeId: 42, decision: 'approved', decidedBy: 'o' }))
      .rejects.toThrow(/only pending_approval\/needs_changes\/approved/)
  })
})

describe('releaseEpisodeClaim', () => {
  it('returns true when a rendering row was released', async () => {
    state.updateReturns = [[{ id: 5 }]]
    expect(await releaseEpisodeClaim(5)).toBe(true)
    expect(state.updateCalls[0]!['productionStatus']).toBe('approved')
    expect(state.updateCalls[0]!['renderStartedAt']).toBeNull()
  })

  it('returns false when nothing was rendering', async () => {
    state.updateReturns = [[]]
    expect(await releaseEpisodeClaim(5)).toBe(false)
  })
})

describe('markEpisodeRenderFailed', () => {
  it('moves a rendering row to failed and reports it did', async () => {
    state.updateReturns = [[{ id: 9 }]]
    expect(await markEpisodeRenderFailed(9)).toBe(true)
    expect(state.updateCalls[0]!['productionStatus']).toBe('failed')
  })

  it('reports false when no rendering row was linked to the job', async () => {
    state.updateReturns = [[]]
    expect(await markEpisodeRenderFailed(9)).toBe(false)
  })
})

describe('reapStaleEpisodeClaims', () => {
  it('releases stale rows but leaves a rendering row with a live job alone', async () => {
    state.staleRows = [
      { id: 1, jobId: null, jobStatus: null },        // crashed before enqueue -> release
      { id: 2, jobId: 7, jobStatus: 'running' },       // live job -> leave
      { id: 3, jobId: 8, jobStatus: 'failed' },        // dead job -> release
    ]
    state.updateReturns = [[{ id: 1 }], [{ id: 3 }]]
    expect(await reapStaleEpisodeClaims()).toBe(2)
    expect(state.updateCalls).toHaveLength(2)
    expect(state.updateCalls.every(c => c['productionStatus'] === 'approved')).toBe(true)
  })

  it('releases nothing when there are no stale rows', async () => {
    state.staleRows = []
    expect(await reapStaleEpisodeClaims()).toBe(0)
    expect(state.updateCalls).toHaveLength(0)
  })
})
