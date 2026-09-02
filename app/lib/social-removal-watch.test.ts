// The removal watcher (ticket #2741).
//
// Two failure modes are worth more than the rest here, and they point opposite
// ways. Missing a real removal keeps an unattended publisher running into a
// second strike on an account Meta disables retroactively. Inventing one, which
// an expired token makes easy, silently strangles a working channel over an env
// var. The cases below are mostly about telling those two apart.
import { describe, it, expect } from 'vitest'
import {
  recoveredFrequency,
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
    // Three writes, not one. The cut is the first; the other two are what makes
    // it reversible, and before this the cut was permanent by omission.
    expect(calls.settings).toEqual([
      { key: 'social_freq_instagram', value: '2' },
      { key: 'social_freq_instagram_ceiling', value: '4' },
      { key: 'social_freq_instagram_changed_at', value: expect.any(String) },
    ])
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

describe('recoveredFrequency — the half that was written down and never built', () => {
  const base = {
    current: 1,
    ceiling: 3,
    removalsInWindow: 0,
    lastChangeAt: new Date('2026-08-01T00:00:00Z'),
    now: new Date('2026-09-02T00:00:00Z'),   // 32 days clean
    observed: true,
  }

  it('gives one step back after a clean stretch', () => {
    // The blocker email the owner receives has always said "volume is earned
    // back by a clean stretch". Nothing implemented that sentence, so a single
    // removal was a permanent halving.
    expect(recoveredFrequency(base)).toBe(2)
  })

  it('climbs by one where it fell by half', () => {
    // Asymmetric on purpose: trust that took a strike to lose should not come
    // back in a single tick.
    expect(steppedDown(4)).toBe(2)
    expect(recoveredFrequency({ ...base, current: 2, ceiling: 4 })).toBe(3)
  })

  it('never climbs past where it was before the cut', () => {
    expect(recoveredFrequency({ ...base, current: 3, ceiling: 3 })).toBeNull()
    expect(recoveredFrequency({ ...base, current: 2, ceiling: 3 })).toBe(3)
  })

  it('does nothing when no ceiling was ever recorded', () => {
    // Reversing a penalty, not setting policy. With no record of a cut there is
    // nothing to reverse, and inventing a target would be this function
    // deciding the store's posting volume.
    expect(recoveredFrequency({ ...base, ceiling: null })).toBeNull()
  })

  it('refuses while a removal sits inside the window', () => {
    expect(recoveredFrequency({ ...base, removalsInWindow: 1 })).toBeNull()
  })

  it('refuses before the stretch is long enough', () => {
    const now = new Date('2026-08-21T00:00:00Z')   // 20 days
    expect(recoveredFrequency({ ...base, now })).toBeNull()
    expect(recoveredFrequency({ ...base, now: new Date('2026-08-22T00:00:00Z') })).toBe(2)
  })

  it('refuses when it does not know when the clock started', () => {
    // The safe default for a missing timestamp on a channel under a strike is
    // to stay throttled, not to assume the cut was long ago.
    expect(recoveredFrequency({ ...base, lastChangeAt: null })).toBeNull()
  })

  it('refuses when the sweep could not actually look', () => {
    // #4702 applied here: a could-not-ask is not a no. Zero removals because
    // the token is dead, and zero removals because nothing was taken down, must
    // never mean the same thing — and only one of them is a clean stretch. The
    // same holds for a channel that posted nothing at all, which has proved
    // nothing.
    expect(recoveredFrequency({ ...base, observed: false })).toBeNull()
  })
})

describe('runRemovalWatch restores volume', () => {
  it('climbs one step when everything is live and the stretch is clean', async () => {
    const { calls, deps } = harness([row(1), row(2)])
    const long_ago = new Date(Date.now() - 40 * 86_400_000).toISOString()
    const r = await runRemovalWatch({
      ...deps,
      mediaState: allLive,
      readSetting: async (k: string) =>
        k === 'social_freq_instagram' ? '1'
        : k === 'social_freq_instagram_ceiling' ? '3'
        : k === 'social_freq_instagram_changed_at' ? long_ago
        : null,
    })
    expect(r.frequencyRestoredTo).toBe(2)
    expect(calls.settings).toEqual([
      { key: 'social_freq_instagram', value: '2' },
      { key: 'social_freq_instagram_changed_at', value: expect.any(String) },
    ])
  })

  it('never turns the autopublish valve back on', async () => {
    // Volume is a throttle and can be earned back. Permission to publish
    // unattended is a judgement call, turned off by a pattern of removals and
    // back on only by the owner. Nothing here is entitled to make it.
    const { calls, deps } = harness([row(1), row(2)])
    const long_ago = new Date(Date.now() - 40 * 86_400_000).toISOString()
    await runRemovalWatch({
      ...deps,
      mediaState: allLive,
      readSetting: async (k: string) =>
        k === 'social_freq_instagram' ? '1'
        : k === 'social_freq_instagram_ceiling' ? '3'
        : k === 'social_freq_instagram_changed_at' ? long_ago
        : null,
    })
    expect(calls.settings.some(s => s.key.includes('autopublish'))).toBe(false)
  })
})
