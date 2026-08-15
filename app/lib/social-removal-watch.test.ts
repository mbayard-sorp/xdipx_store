// The removal watcher (ticket #2741).
//
// Two failure modes are worth more than the rest here, and they point opposite
// ways. Missing a real removal keeps an unattended publisher running into a
// second strike on an account Meta disables retroactively. Inventing one, which
// an expired token makes easy, silently strangles a working channel over an env
// var. The cases below are mostly about telling those two apart.
import { describe, it, expect } from 'vitest'
import {
  runRemovalWatch,
  steppedDown,
  VALVE_OFF_AT_REMOVALS,
  type PostedRow,
  type RemovalWatchRepo,
} from './social-removal-watch.server'
import type { BlockerInput } from './owner-blockers-core'

function row(id: number): PostedRow {
  return {
    id,
    externalPostId: `ig_${id}`,
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

const allLive = async () => ({ state: 'live' as const })

describe('steppedDown', () => {
  it('halves and never reaches zero', () => {
    expect(steppedDown(4)).toBe(2)
    expect(steppedDown(3)).toBe(1)
    expect(steppedDown(1)).toBe(1)
  })
})

describe('runRemovalWatch', () => {
  it('writes nothing when every post is still live', async () => {
    const { calls, deps } = harness([row(1), row(2)])
    const r = await runRemovalWatch({ ...deps, mediaState: allLive })
    expect(r.removed).toEqual([])
    expect(calls.settings).toEqual([])
    expect(calls.blockers).toEqual([])
  })

  it('marks a removed post and steps the drafting quota down', async () => {
    const { calls, deps } = harness([row(1), row(2)])
    const r = await runRemovalWatch({
      ...deps,
      mediaState: async (id) => (id === 'ig_1' ? { state: 'gone' } : { state: 'live' }),
    })
    expect(r.removed).toEqual([1])
    expect(calls.removed).toEqual([1])
    expect(calls.settings).toEqual([{ key: 'social_freq_instagram', value: '2' }])
  })

  it('leaves autopublish ON after a single removal', async () => {
    // One removal is a signal to slow down. Killing the channel on one strike
    // hands back the bottleneck the owner asked to be rid of.
    const { calls, deps } = harness([row(1), row(2)])
    const r = await runRemovalWatch({
      ...deps,
      mediaState: async (id) => (id === 'ig_1' ? { state: 'gone' } : { state: 'live' }),
    })
    expect(r.valveTurnedOff).toBeUndefined()
    expect(calls.settings.some(s => s.key === 'instagram_autopublish_enabled')).toBe(false)
  })

  it('turns autopublish OFF on the second removal in the window', async () => {
    // Two is a pattern rather than an incident, and the next correct action
    // needs a person.
    const { calls, deps } = harness([row(1), row(2)], VALVE_OFF_AT_REMOVALS - 1)
    const r = await runRemovalWatch({
      ...deps,
      mediaState: async (id) => (id === 'ig_1' ? { state: 'gone' } : { state: 'live' }),
    })
    expect(r.valveTurnedOff).toBe(true)
    expect(calls.settings).toContainEqual({ key: 'instagram_autopublish_enabled', value: 'false' })
    expect(calls.blockers[0]?.dedupeKey).toBe('ig-removals-pattern')
  })

  it('refuses to conclude anything when NOTHING answered normally', async () => {
    // The expired-token trap. Every lookup failing "does not exist" is far more
    // likely to be the credential than an account purge, and a watcher that
    // believed it would strangle a working channel over an env var.
    const { calls, deps } = harness([row(1), row(2), row(3)])
    const r = await runRemovalWatch({ ...deps, mediaState: async () => ({ state: 'gone' }) })
    expect(r.abstained).toBe('token_unhealthy')
    expect(r.removed).toEqual([])
    expect(calls.removed).toEqual([])
    expect(calls.settings).toEqual([])
    // It is loud about it, because while this is true removals are invisible.
    expect(calls.blockers[0]).toEqual({
      dedupeKey: 'ig-removal-watch-token-unhealthy',
      category: 'credential',
    })
  })

  it('treats an ambiguous API error as unknown, not as a removal', async () => {
    // Rate limits and network failures are not verdicts.
    const { calls, deps } = harness([row(1), row(2)])
    const r = await runRemovalWatch({
      ...deps,
      mediaState: async (id) => (id === 'ig_1' ? { state: 'unknown', detail: 'HTTP 429' } : { state: 'live' }),
    })
    expect(r.unknown).toBe(1)
    expect(r.removed).toEqual([])
    expect(calls.settings).toEqual([])
  })

  it('does nothing on an account with no posts yet', async () => {
    const { calls, deps } = harness([])
    const r = await runRemovalWatch({ ...deps, mediaState: allLive })
    expect(r.abstained).toBe('nothing_posted')
    expect(calls.blockers).toEqual([])
  })

  it('does not step a quota that is already at the floor', async () => {
    const { calls, deps } = harness([row(1), row(2)])
    const r = await runRemovalWatch({
      ...deps,
      readSetting: async () => '1',
      mediaState: async (id) => (id === 'ig_1' ? { state: 'gone' } : { state: 'live' }),
    })
    expect(r.frequencySteppedTo).toBeUndefined()
    expect(calls.settings.some(s => s.key === 'social_freq_instagram')).toBe(false)
    // Still tells the owner, which is the part that must not be skipped.
    expect(calls.blockers).toHaveLength(1)
  })
})
