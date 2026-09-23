/**
 * Video learn loop (Phase 2b): reach-keyed rollups by speaker and format,
 * per-batch owner-behaviour signals, and the threshold flags. The pure half
 * (video-learn-signals.ts) is driven directly; listEpisodePerformance and
 * listBatchSignals run against a queued db mock (each awaited query shifts
 * the next canned result, in call order).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const queue: unknown[][] = []

vi.mock('./db.server', () => {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    for (const k of ['from', 'where', 'orderBy', 'limit']) c[k] = () => c
    c['then'] = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(queue.shift() ?? []).then(res, rej)
    return c
  }
  return { db: { select: () => chain() } }
})

import {
  computeBatchSignals,
  episodeEditStats,
  episodeFormat,
  episodeSpeaker,
  learnFlags,
  primaryReachOf,
  wordEditDistance,
  type BatchEpisodeInput,
  type BatchSignals,
} from './video-learn-signals'
import { listBatchSignals, listEpisodePerformance, rollupByDimension, type EpisodePerformance } from './video-learn.server'

beforeEach(() => { queue.length = 0 })

describe('dimensions and primary reach', () => {
  it('reads speaker/format from scriptJson.pitch first, then scriptJson', () => {
    expect(episodeSpeaker({ pitch: { speaker: 'Maya' }, speaker: 'jordan' })).toBe('maya')
    expect(episodeSpeaker({ speaker: 'Jordan' })).toBe('jordan')
    expect(episodeSpeaker({ pitch: { speaker: '  ' } })).toBeNull()
    expect(episodeFormat({ pitch: { format: 'versus' }, format: 'x' })).toBe('versus')
    expect(episodeFormat({ format: 'show-and-tell' })).toBe('show-and-tell')
    expect(episodeFormat(null)).toBeNull()
  })

  it('uses IG reach, else X impressions, never a sum', () => {
    expect(primaryReachOf({ reach: 300, saved: 4 }, { impressions: 9000 })).toEqual({ value: 300, source: 'ig_reach' })
    expect(primaryReachOf({ saved: 4 }, { impressions: 9000 })).toEqual({ value: 9000, source: 'x_impressions' })
    expect(primaryReachOf(null, null)).toEqual({ value: null, source: null })
  })

  it('rolls up by speaker and format on median reach, skipping unswept rows', () => {
    const row = (id: number, speaker: string, format: string, primaryReach: number | null, unswept = false): EpisodePerformance => ({
      episodeId: id, label: `S1E${id}`, logline: '', hookText: null, speaker, format, productHandles: [], modelTier: null,
      costUsd: null, postedAt: null, runtimeSeconds: null, primaryReach, primaryReachSource: primaryReach == null ? null : 'ig_reach',
      reach: primaryReach, impressions: null, saves: null, comments: null, plays: null, avgWatchTimeMs: null, avgPctViewed: null, unswept,
    })
    const rows = [row(1, 'maya', 'versus', 100), row(2, 'maya', 'show', 300), row(3, 'jordan', 'versus', 900), row(4, 'jordan', 'show', null, true)]
    const bySpeaker = rollupByDimension(rows, 'speaker')
    expect(bySpeaker.map(r => [r.value, r.n, r.medianPrimaryReach])).toEqual([['jordan', 1, 900], ['maya', 2, 200]])
    expect(bySpeaker.every(r => r.underpowered)).toBe(true)
    expect(rollupByDimension(rows, 'format').map(r => r.value)).toEqual(['versus', 'show'])
  })

  it('counts a two-handle clip in both product groups', () => {
    const base = {
      label: '', logline: '', hookText: null, speaker: 'maya', format: 'versus', modelTier: null, costUsd: null,
      postedAt: null, runtimeSeconds: null, primaryReachSource: 'ig_reach' as const, impressions: null, saves: null,
      comments: null, plays: null, avgWatchTimeMs: null, avgPctViewed: null, unswept: false,
    }
    const rows: EpisodePerformance[] = [
      { ...base, episodeId: 1, productHandles: ['rose-toy', 'magic-wand'], primaryReach: 500, reach: 500 },
      { ...base, episodeId: 2, productHandles: ['rose-toy'], primaryReach: 100, reach: 100 },
    ]
    expect(rollupByDimension(rows, 'product').map(r => [r.value, r.n, r.medianPrimaryReach])).toEqual([
      ['magic-wand', 1, 500],
      ['rose-toy', 2, 300],
    ])
  })
})

describe('owner edit ratio', () => {
  it('counts a swapped word once', () => {
    expect(wordEditDistance('this one hums low', 'this one purrs low')).toBe(1)
    expect(wordEditDistance(null, 'three new words')).toBe(3)
    expect(wordEditDistance('Hi, there.', 'hi there')).toBe(0)
  })

  it('divides changed spoken words by the ORIGINAL spoken words, ignoring captions', () => {
    const current = { presenterLine: 'this one purrs low and slow', voiceover: 'ten speeds four modes' }
    const stats = episodeEditStats(current, [
      { field: 'script.presenterLine', before: 'this one hums low', after: 'this one purrs low and slow', createdAt: '2026-09-22T10:00:00Z' },
      { field: 'script.captions.instagram', before: 'a', after: 'b c d e f', createdAt: '2026-09-22T10:00:00Z' },
    ])
    // original: 4 (hums line) + 4 (voiceover) = 8; changed: hums->purrs + "and slow" = 3
    expect(stats).toEqual({ changedWords: 3, spokenWords: 8 })
  })

  it('counts a spoken CTA edit in both numerator and denominator', () => {
    const stats = episodeEditStats({ presenterLine: 'one two three four', cta: 'Take a peek' }, [
      { field: 'script.cta', before: 'Show me', after: 'Take a peek', createdAt: '2026-09-22T10:00:00Z' },
    ])
    // original: 4 (presenterLine) + 2 ("Show me") = 6; changed: Show->Take, me->a, +peek = 3
    expect(stats).toEqual({ changedWords: 3, spokenWords: 6 })
  })

  it('is null for a script with no spoken words', () => {
    expect(episodeEditStats({ captions: { instagram: 'read, not heard' } }, [])).toBeNull()
  })
})

function ep(over: Partial<BatchEpisodeInput> & { episodeId: number; batchId: string }): BatchEpisodeInput {
  return {
    createdAt: '2026-09-15T17:00:00Z', approvedAt: null, reviewNotes: null,
    scriptJson: { presenterLine: 'one two three four five six seven eight nine ten' }, edits: [], jobFrameRetries: [],
    ...over,
  }
}

describe('computeBatchSignals', () => {
  it('computes edit ratio, rates, re-rolls and hours to first decision per batch, oldest first', () => {
    const batches = computeBatchSignals([
      ep({
        episodeId: 1, batchId: 'b2', createdAt: '2026-09-22T17:00:00Z', approvedAt: '2026-09-23T17:00:00Z',
        reviewNotes: [{ at: '2026-09-23T17:00:00Z', decision: 'approved' }], jobFrameRetries: [2, 1],
      }),
      ep({
        episodeId: 2, batchId: 'b2', createdAt: '2026-09-22T17:00:00Z',
        reviewNotes: [{ at: '2026-09-22T19:00:00Z', decision: 'edited' }, { at: '2026-09-25T17:00:00Z', decision: 'needs_changes', note: 'flat' }],
        edits: [{ field: 'script.presenterLine', before: 'one two three four five six seven eight nine ten', after: 'one two three four five six seven eight nine eleven', createdAt: '2026-09-22T19:00:00Z' }],
        scriptJson: { presenterLine: 'one two three four five six seven eight nine eleven' },
      }),
      ep({ episodeId: 3, batchId: 'b2', createdAt: '2026-09-22T17:00:00Z' }), // still pending
      ep({ episodeId: 4, batchId: 'b1', reviewNotes: [{ at: '2026-09-15T18:00:00Z', decision: 'rejected' }] }),
    ])
    expect(batches.map(b => b.batchId)).toEqual(['b1', 'b2'])
    const b2 = batches[1]!
    expect(b2.episodes).toBe(3)
    expect(b2.decided).toBe(2)
    expect(b2.editRatio).toBe(round(1 / 30))
    expect(b2.approvedRate).toBe(0.5)
    expect(b2.needsChangesRate).toBe(0.5)
    expect(b2.rerollRate).toBe(1.5)
    expect(b2.medianHoursToDecision).toBe(48) // median of 24h and 72h; the 'edited' note is not a decision
    expect(batches[0]!.rerollRate).toBeNull()
    expect(batches[0]!.approvedRate).toBe(0)
  })
})

function round(n: number) { return Math.round(n * 1000) / 1000 }

function sig(batchId: string, over: Partial<BatchSignals>): BatchSignals {
  return {
    batchId, startedAt: `2026-09-${batchId.padStart(2, '0')}T00:00:00Z`, episodes: 5, decided: 5,
    editRatio: 0.1, needsChangesRate: 0, approvedRate: 0.8, rerollRate: 0.5, medianHoursToDecision: 20, ...over,
  }
}

describe('learnFlags', () => {
  const on = (bs: BatchSignals[]) => learnFlags(bs).filter(f => f.triggered).map(f => f.key)

  it('trips nothing on a healthy history', () => {
    expect(on([sig('1', {}), sig('2', {})])).toEqual([])
  })

  it('needs two consecutive batches over the edit and approval thresholds', () => {
    expect(on([sig('1', { editRatio: 0.3, approvedRate: 0.4 })])).toEqual([])
    expect(on([sig('1', { editRatio: 0.3, approvedRate: 0.4 }), sig('2', { editRatio: 0.1, approvedRate: 0.8 })])).toEqual([])
    expect(on([sig('1', { editRatio: 0.25, approvedRate: 0.4 }), sig('2', { editRatio: 0.21, approvedRate: 0.59 })]))
      .toEqual(['edit_ratio_high', 'approved_rate_low'])
  })

  it('reads re-roll and time-to-approve off the latest batch that has a value', () => {
    expect(on([sig('1', { rerollRate: 2 }), sig('2', { rerollRate: null })])).toEqual(['reroll_high'])
    expect(on([sig('1', { medianHoursToDecision: 80 }), sig('2', { medianHoursToDecision: 72 })])).toEqual([])
    expect(on([sig('1', {}), sig('2', { medianHoursToDecision: 73 })])).toEqual(['time_to_approve_slow'])
  })
})

describe('listEpisodePerformance (db)', () => {
  it('keys on IG reach, falls back to X impressions, and skips clips with no posted post', async () => {
    queue.push([
      { id: 1, seasonNumber: 2, episodeNumber: 1, logline: 'a', hookText: null, scriptJson: { pitch: { speaker: 'maya', format: 'versus' } }, productPlacements: [], modelTier: null, actualCostUsd: '1.2', estCostUsd: null, videoJobId: 10, postedAt: null },
      { id: 2, seasonNumber: 2, episodeNumber: 2, logline: 'b', hookText: null, scriptJson: null, productPlacements: [], modelTier: null, actualCostUsd: null, estCostUsd: null, videoJobId: 11, postedAt: null },
      { id: 3, seasonNumber: 2, episodeNumber: 3, logline: 'c', hookText: null, scriptJson: null, productPlacements: [], modelTier: null, actualCostUsd: null, estCostUsd: null, videoJobId: 12, postedAt: null },
    ])
    queue.push([{ id: 10, scenesJson: null, scriptJson: { durationSeconds: 20 } }])
    queue.push([
      { episodeId: 1, platform: 'instagram', status: 'posted', postedAt: new Date('2026-09-20T00:00:00Z'), metricsJson: { reach: 420, saved: 3, avgWatchTimeMs: 10000 } },
      { episodeId: 2, platform: 'x', status: 'posted', postedAt: new Date('2026-09-21T00:00:00Z'), metricsJson: { impressions: 1500, bookmarks: 2 } },
      { episodeId: 3, platform: 'instagram', status: 'draft', postedAt: null, metricsJson: null },
    ])
    const rows = await listEpisodePerformance()
    expect(rows.map(r => [r.episodeId, r.speaker, r.format, r.primaryReach, r.primaryReachSource, r.saves])).toEqual([
      [1, 'maya', 'versus', 420, 'ig_reach', 3],
      [2, 'unspecified', 'unspecified', 1500, 'x_impressions', 2],
    ])
    expect(rows[0]!.avgPctViewed).toBe(50)
  })
})

describe('listBatchSignals (db)', () => {
  it('reads frame re-rolls from frameFeedback on current and prior jobs', async () => {
    queue.push([
      { id: 1, batchId: 'b1', createdAt: new Date('2026-09-22T17:00:00Z'), approvedAt: new Date('2026-09-23T05:00:00Z'), reviewNotesJson: [{ at: '2026-09-23T05:00:00Z', decision: 'approved' }], scriptJson: null, videoJobId: 21, priorJobIdsJson: [20] },
    ])
    queue.push([]) // edits
    queue.push([
      { id: 20, scriptJson: { frameFeedback: ['warmer', 'hands', 'closer'] } },
      { id: 21, scriptJson: {} },
    ])
    const { batches, flags } = await listBatchSignals()
    expect(batches).toHaveLength(1)
    expect(batches[0]!.rerollRate).toBe(1.5)
    expect(batches[0]!.medianHoursToDecision).toBe(12)
    expect(flags.find(f => f.key === 'reroll_high')!.triggered).toBe(false)
  })

  it('returns no batches and untriggered flags when nothing was pitched', async () => {
    queue.push([])
    const { batches, flags } = await listBatchSignals()
    expect(batches).toEqual([])
    expect(flags.every(f => !f.triggered)).toBe(true)
  })
})
