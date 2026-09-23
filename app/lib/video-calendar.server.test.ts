/**
 * listCalendarVideoClips maps video_episodes (+ posted social_posts, + the
 * job's product handle) onto the calendar's videoClips shape, and clipWindow
 * resolves the default 14-back / 14-forward window. db.server is mocked: each
 * awaited query shifts the next canned result off a queue, in call order
 * (episodes, posts, jobs).
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

import { clipWindow, listCalendarVideoClips } from './video-calendar.server'

beforeEach(() => { queue.length = 0 })

describe('clipWindow', () => {
  const now = new Date('2026-09-23T15:00:00.000Z')

  it('defaults to 14 days back through the whole day 14 days forward', () => {
    const w = clipWindow(undefined, undefined, now)
    expect(w.start.toISOString()).toBe('2026-09-09T00:00:00.000Z')
    expect(w.endExclusive.toISOString()).toBe('2026-10-08T00:00:00.000Z')
  })

  it('honours explicit from/to, with to inclusive of its day', () => {
    const w = clipWindow('2026-09-20', '2026-09-21', now)
    expect(w.start.toISOString()).toBe('2026-09-20T00:00:00.000Z')
    expect(w.endExclusive.toISOString()).toBe('2026-09-22T00:00:00.000Z')
  })
})

describe('listCalendarVideoClips', () => {
  it('returns [] and skips the follow-up reads when no episode is in the window', async () => {
    queue.push([])
    expect(await listCalendarVideoClips()).toEqual([])
  })

  it('maps pitch speaker/format, prefers the IG permalink, and falls back to the job handle', async () => {
    queue.push([
      {
        id: 11, productionStatus: 'posted',
        plannedSlotAt: new Date('2026-09-18T17:00:00.000Z'), postedAt: new Date('2026-09-18T17:05:00.000Z'),
        logline: 'Maya on the rose', hookText: 'It is smaller than you think', siteCutJson: { title: 'The rose, up close' },
        scriptJson: { pitch: { speaker: 'Maya', format: 'show-and-tell' }, speaker: 'ignored' },
        productPlacements: [{ handle: 'rose-toy', role: 'considered', mentionType: 'spec_cited' }],
        videoJobId: 90,
      },
      {
        id: 12, productionStatus: 'approved',
        plannedSlotAt: null, postedAt: null,
        logline: 'Jordan compares two wands', hookText: null, siteCutJson: null,
        scriptJson: { speaker: 'jordan', format: 'versus' },
        productPlacements: [],
        videoJobId: 91,
      },
    ])
    queue.push([
      { episodeId: 11, platform: 'x', postedAt: new Date('2026-09-18T17:06:00.000Z'), permalink: 'https://x.com/hello_xdipx/status/1' },
      { episodeId: 11, platform: 'instagram', postedAt: new Date('2026-09-18T17:05:00.000Z'), permalink: 'https://instagram.com/reel/abc' },
    ])
    queue.push([{ id: 90, productHandle: 'rose-toy' }, { id: 91, productHandle: 'magic-wand' }])

    const clips = await listCalendarVideoClips('2026-09-10', '2026-09-30')
    expect(clips).toEqual([
      {
        episodeId: 11, productHandle: 'rose-toy', title: 'The rose, up close', speaker: 'maya', format: 'show-and-tell',
        status: 'posted', plannedSlotAt: '2026-09-18T17:00:00.000Z', postedAt: '2026-09-18T17:05:00.000Z',
        permalink: 'https://instagram.com/reel/abc',
      },
      {
        episodeId: 12, productHandle: 'magic-wand', title: 'Jordan compares two wands', speaker: 'jordan', format: 'versus',
        status: 'approved', plannedSlotAt: null,
      },
    ])
  })
})
