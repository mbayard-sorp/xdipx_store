// The X removal watcher (ticket #3745). Mirrors social-removal-watch.test.ts:
// the same two opposite failure modes matter (missing a real removal on an
// unattended channel, versus inventing one out of a broken credential), plus
// the batch-lookup shapes that are X-specific.
import { describe, it, expect } from 'vitest'
import { runXRemovalWatch, type TweetStatesFn } from './x-removal-watch.server'
import { VALVE_OFF_AT_REMOVALS, type PostedRow, type RemovalWatchRepo } from './social-removal-watch.server'
import type { BlockerInput } from './owner-blockers-core'

function row(id: number): PostedRow {
  return {
    id,
    externalPostId: `tw_${id}`,
    postedAt: new Date('2026-08-14'),
    caption: `post ${id}`,
  }
}

function harness(rows: PostedRow[], removedInWindow = 0) {
  const calls = {
    removed: [] as number[],
    settings: [] as { key: string; value: string }[],
    blockers: [] as { dedupeKey: string; category: string | null | undefined }[],
  }
  const repo: RemovalWatchRepo = {
    recentLive: async () => rows,
    markRemoved: async (id) => { calls.removed.push(id) },
    countRemovedSince: async () => removedInWindow + calls.removed.length,
  }
  return {
    calls,
    deps: {
      repo,
      readSetting: async () => '4',
      writeSetting: async (key: string, value: string) => { calls.settings.push({ key, value }) },
      fileBlocker: async (input: BlockerInput) => {
        calls.blockers.push({ dedupeKey: input.dedupeKey, category: input.category })
        return {}
      },
      now: () => new Date('2026-08-15T12:00:00Z'),
    },
  }
}

/** Batch verdicts where every id except those in `goneIds` is live. */
function states(goneIds: string[] = []): TweetStatesFn {
  return async (ids) => ({
    ok: true,
    states: new Map(ids.map(id => [
      id,
      goneIds.includes(id) ? { state: 'gone' as const } : { state: 'live' as const },
    ])),
  })
}

describe('runXRemovalWatch', () => {
  it('writes nothing when every tweet is still live', async () => {
    const { calls, deps } = harness([row(1), row(2)])
    const r = await runXRemovalWatch({ ...deps, tweetStates: states() })
    expect(r.removed).toEqual([])
    expect(calls.settings).toEqual([])
    expect(calls.blockers).toEqual([])
  })

  it('marks a removed tweet and steps the drafting quota down', async () => {
    const { calls, deps } = harness([row(1), row(2)])
    const r = await runXRemovalWatch({ ...deps, tweetStates: states(['tw_1']) })
    expect(r.removed).toEqual([1])
    expect(calls.removed).toEqual([1])
    // Three writes, not one. The cut is the first; the other two are what makes
    // it reversible, and before this the cut was permanent by omission.
    expect(calls.settings).toEqual([
      { key: 'social_freq_x', value: '2' },
      { key: 'social_freq_x_ceiling', value: '4' },
      { key: 'social_freq_x_changed_at', value: expect.any(String) },
    ])
  })

  it('leaves autopublish ON after a single removal', async () => {
    const { calls, deps } = harness([row(1), row(2)])
    const r = await runXRemovalWatch({ ...deps, tweetStates: states(['tw_1']) })
    expect(r.valveTurnedOff).toBeUndefined()
    expect(calls.settings.some(s => s.key === 'x_autopublish_enabled')).toBe(false)
  })

  it('turns autopublish OFF on the second removal in the window and files the blocker', async () => {
    const { calls, deps } = harness([row(1), row(2)], VALVE_OFF_AT_REMOVALS - 1)
    const r = await runXRemovalWatch({ ...deps, tweetStates: states(['tw_1']) })
    expect(r.valveTurnedOff).toBe(true)
    expect(calls.settings).toContainEqual({ key: 'x_autopublish_enabled', value: 'false' })
    expect(calls.blockers[0]?.dedupeKey).toBe('x-removals-pattern')
  })

  it('refuses to conclude anything when NOTHING answered normally', async () => {
    // The broken-credential trap: every id flagged gone at once is far more
    // likely to be the keys than an account purge.
    const { calls, deps } = harness([row(1), row(2), row(3)])
    const r = await runXRemovalWatch({
      ...deps,
      tweetStates: states(['tw_1', 'tw_2', 'tw_3']),
    })
    expect(r.abstained).toBe('token_unhealthy')
    expect(r.removed).toEqual([])
    expect(calls.removed).toEqual([])
    expect(calls.settings).toEqual([])
    expect(calls.blockers[0]).toEqual({
      dedupeKey: 'x-removal-watch-token-unhealthy',
      category: 'credential',
    })
  })

  it('treats a whole-request auth failure as the credential, not a purge', async () => {
    const { calls, deps } = harness([row(1), row(2)])
    const r = await runXRemovalWatch({
      ...deps,
      tweetStates: async () => ({ ok: false, detail: 'X API GET https://api.x.com/2/tweets → 401: Unauthorized' }),
    })
    expect(r.abstained).toBe('token_unhealthy')
    expect(calls.settings).toEqual([])
    expect(calls.blockers[0]?.category).toBe('credential')
  })

  it('treats a whole-request rate limit as unknown, silently', async () => {
    const { calls, deps } = harness([row(1), row(2)])
    const r = await runXRemovalWatch({
      ...deps,
      tweetStates: async () => ({ ok: false, detail: 'X API GET https://api.x.com/2/tweets → 429: Too Many Requests' }),
    })
    expect(r.abstained).toBeUndefined()
    expect(r.unknown).toBe(2)
    expect(r.removed).toEqual([])
    expect(calls.settings).toEqual([])
    expect(calls.blockers).toEqual([])
  })

  it('treats a per-id unknown as no verdict, not as a removal', async () => {
    const { calls, deps } = harness([row(1), row(2)])
    const r = await runXRemovalWatch({
      ...deps,
      tweetStates: async (ids) => ({
        ok: true,
        states: new Map(ids.map(id => [
          id,
          id === 'tw_1' ? { state: 'unknown' as const, detail: 'odd shape' } : { state: 'live' as const },
        ])),
      }),
    })
    expect(r.unknown).toBe(1)
    expect(r.removed).toEqual([])
    expect(calls.settings).toEqual([])
  })

  it('does nothing on an account with no posts yet', async () => {
    const { calls, deps } = harness([])
    const r = await runXRemovalWatch({ ...deps, tweetStates: states() })
    expect(r.abstained).toBe('nothing_posted')
    expect(calls.blockers).toEqual([])
  })

  it('does not step a quota that is already at the floor, but still tells the owner', async () => {
    const { calls, deps } = harness([row(1), row(2)])
    const r = await runXRemovalWatch({
      ...deps,
      readSetting: async () => '1',
      tweetStates: states(['tw_1']),
    })
    expect(r.frequencySteppedTo).toBeUndefined()
    expect(calls.settings.some(s => s.key === 'social_freq_x')).toBe(false)
    expect(calls.blockers).toHaveLength(1)
  })

  it('names what it checked in the tick report', async () => {
    const { deps } = harness([row(1), row(2), row(3)])
    const r = await runXRemovalWatch({ ...deps, tweetStates: states() })
    expect(r.checked).toBe(3)
  })
})
