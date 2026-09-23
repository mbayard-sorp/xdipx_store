import { describe, it, expect, vi, beforeEach } from 'vitest'
import { instagramTickDeps, xTickDeps, VIDEO_TICK_VALVE_KEY } from './social-publish-run.server'
import {
  runSocialPublishTick,
  MAX_PER_TICK,
  VIDEO_SKIP_LOOKAHEAD,
  type PostRow,
  type PublishRepo,
  type PublishTickDeps,
} from './social-publish-job.server'
import { manualPublishValveKey } from './social-publish/manual-publish-gate.server'
import { VALVE_KEYS } from './team-keys'

// Valve reads are stubbed at the team.server boundary so the deps wiring is
// tested without settings or a database. Keyed by the real valve names.
const { valves, getValveMock } = vi.hoisted(() => {
  const valves = new Map<string, boolean>()
  return { valves, getValveMock: vi.fn(async (key: string) => valves.get(key) ?? false) }
})
vi.mock('./team.server', async () => {
  const keys = await import('./team-keys')
  return { getValve: getValveMock, VALVE_KEYS: keys.VALVE_KEYS }
})

/**
 * Coverage for the publish closure the scheduled tick runs (`publishViaRegistry`,
 * reached here through the exported `instagramTickDeps().publish`).
 *
 * The regression this guards (ticket #3744): the closure called the adapter,
 * which returns `{ ok, externalPostId, note }` when a post published with a
 * caveat (e.g. untagged because the product was not approved for tagging), but
 * dropped `note` on the way out, so the reason reached only a `console.warn`
 * and never the tick report. The file had zero test coverage, which is why the
 * drop was never caught.
 */

const publishMock = vi.fn()

vi.mock('./social-publish/registry.server', () => ({
  getPublisher: () => ({
    platform: 'instagram',
    configured: () => true,
    publish: publishMock,
  }),
}))

vi.mock('./social-publish-approve.server', async (importOriginal) => ({
  // The real module (the tick below needs isTickEligible and friends), with
  // parseGateStamp stubbed: the featured handle is irrelevant to
  // note-forwarding and the gate stamp path is exercised by the job suite.
  ...(await importOriginal<typeof import('./social-publish-approve.server')>()),
  parseGateStamp: () => ({ productHandle: null }),
}))

// The deterministic gate has its own suite; here it passes everything so the
// only thing deciding a video row's fate is the valve under test.
vi.mock('./social-publish-gate.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./social-publish-gate.server')>()),
  runDeterministicPublishChecks: async () => ({ blocked: false, held: false, findings: [] }),
}))

function post(over: Partial<PostRow> = {}): PostRow {
  return {
    id: 1, platform: 'instagram', postType: 'campaign', externalPostId: null,
    parentPostId: null, dealHistoryId: null,
    tweetText: 'a caption', mediaUrls: ['https://cdn.example/social-a.jpg'],
    mediaIds: null, status: 'draft', errorMessage: null, postedAt: null,
    createdAt: new Date('2026-08-01'), createdBy: 'agent',
    reviewStatus: 'approved', feedback: null, editedText: null,
    reviewedBy: null, reviewedAt: null, scheduledFor: '2026-08-17',
    reworkedFrom: null, videoJobId: null, posterUrl: null,
    ...over,
  } as PostRow
}

describe('publishViaRegistry (the scheduled tick publish closure)', () => {
  beforeEach(() => publishMock.mockReset())

  it('forwards the adapter note on a successful publish, so the reason survives past console.warn (ticket #3744)', async () => {
    const note = 'published untagged: product not approved for tagging'
    publishMock.mockResolvedValue({ ok: true, externalPostId: 'ig_1', note })
    const deps = await instagramTickDeps()
    const result = await deps.publish(post())
    expect(result).toEqual({ ok: true, externalPostId: 'ig_1', note })
  })

  it('omits note when the adapter returns none, rather than forwarding undefined', async () => {
    publishMock.mockResolvedValue({ ok: true, externalPostId: 'ig_1' })
    const deps = await instagramTickDeps()
    const result = await deps.publish(post())
    expect(result).toEqual({ ok: true, externalPostId: 'ig_1' })
    expect(result).not.toHaveProperty('note')
  })

  it('reports a failure with its detail unchanged', async () => {
    publishMock.mockResolvedValue({ ok: false, detail: 'Meta 500' })
    const deps = await instagramTickDeps()
    const result = await deps.publish(post())
    expect(result).toEqual({ ok: false, detail: 'Meta 500' })
  })
})

// ── The video autopublish double-gate (Phase 3) ─────────────────────────────
//
// A video row publishes unattended only when BOTH the platform valve and
// `video_team_autopublish` are on. Off is a skip: the row is never claimed or
// written, so it stays eligible for the tick after the owner flips the valve.

const videoRow = (id: number, over: Partial<PostRow> = {}) => post({
  id, mediaUrls: [`https://blob.example/clip-${id}.mp4`], videoJobId: 42,
  gateStatus: 'pass', mediaKind: 'video', ...over,
} as Partial<PostRow>)
const stillRow = (id: number, over: Partial<PostRow> = {}) => post({
  id, mediaUrls: [`https://cdn.example/still-${id}.jpg`], gateStatus: 'pass', ...over,
} as Partial<PostRow>)

function fakeRepo(rows: PostRow[]) {
  const calls = { claimed: [] as number[], posted: [] as number[], written: [] as number[], limits: [] as number[] }
  const repo: PublishRepo = {
    sweepAbandoned: async () => 0,
    countPublishedToday: async () => 0,
    listEligible: async (limit) => { calls.limits.push(limit); return rows.slice(0, limit) },
    recentCaptions: async () => [],
    claim: async (id) => { calls.claimed.push(id); return rows.find(r => r.id === id) ?? null },
    markPosted: async (id) => { calls.posted.push(id) },
    markNeedsChanges: async (id) => { calls.written.push(id) },
    markFailed: async (id) => { calls.written.push(id) },
  }
  return { repo, calls }
}

/** A tick with everything but the valves and the repo stubbed out. */
function tickWith(rows: PostRow[], over: Pick<PublishTickDeps, 'isVideoEnabled'> & Partial<Pick<PublishTickDeps, 'isEnabled'>>) {
  const { repo, calls } = fakeRepo(rows)
  const publish = vi.fn(async (p: PostRow) => ({ ok: true as const, externalPostId: `ext-${p.id}` }))
  const run = () => runSocialPublishTick({
    isEnabled: async () => true,
    maxPerDay: async () => 10,
    publish,
    repo,
    removalWatch: async () => null,
    productHandleFor: async () => null,
    ...over,
  })
  return { run, calls, publish }
}

describe('the video double-gate in the scheduled tick', () => {
  it('skips a video row when the video valve is off, without claiming or writing it', async () => {
    const { run, calls, publish } = tickWith([videoRow(1)], { isVideoEnabled: async () => false })
    const r = await run()
    expect(r.attempts).toEqual([{ postId: 1, outcome: 'skipped_video_valve_off' }])
    expect(publish).not.toHaveBeenCalled()
    expect(calls.claimed).toEqual([])
    expect(calls.written).toEqual([])
    expect(calls.posted).toEqual([])
  })

  it('publishes the same video row when the video valve is on', async () => {
    const { run, calls, publish } = tickWith([videoRow(1)], { isVideoEnabled: async () => true })
    const r = await run()
    expect(r.attempts).toEqual([{ postId: 1, outcome: 'published' }])
    expect(publish).toHaveBeenCalledTimes(1)
    expect(calls.posted).toEqual([1])
  })

  it('is still gated by the platform valve: video valve on, platform off, nothing runs', async () => {
    const isVideoEnabled = vi.fn(async () => true)
    const { run, calls, publish } = tickWith([videoRow(1)], { isEnabled: async () => false, isVideoEnabled })
    const r = await run()
    expect(r.skipped).toBe('valve_off')
    expect(publish).not.toHaveBeenCalled()
    expect(calls.claimed).toEqual([])
  })

  it('does not gate stills on the video valve', async () => {
    const { run, calls } = tickWith([stillRow(1)], { isVideoEnabled: async () => false })
    const r = await run()
    expect(r.attempts).toEqual([{ postId: 1, outcome: 'published' }])
    expect(calls.posted).toEqual([1])
  })

  it('an off video valve cannot starve the stills queued behind videos', async () => {
    const rows = [videoRow(1), videoRow(2), videoRow(3), stillRow(4), stillRow(5), stillRow(6)]
    const { run, calls } = tickWith(rows, { isVideoEnabled: async () => false })
    const r = await run()
    // Looks past the videos, and still publishes no more than the tick allows.
    expect(calls.limits[0]).toBeGreaterThan(MAX_PER_TICK)
    expect(calls.posted).toEqual([4, 5])
    expect(calls.posted).toHaveLength(MAX_PER_TICK)
    expect(r.attempts.filter(a => a.outcome === 'skipped_video_valve_off').map(a => a.postId)).toEqual([1, 2, 3])
  })

  it('with the video valve on, reads exactly the room it has, as before', async () => {
    const { run, calls } = tickWith([stillRow(1)], { isVideoEnabled: async () => true })
    await run()
    expect(calls.limits).toEqual([MAX_PER_TICK])
  })

  it('notes video_lookahead_exhausted when the widened read is full and all video', async () => {
    const rows = Array.from({ length: MAX_PER_TICK + VIDEO_SKIP_LOOKAHEAD + 3 }, (_, i) => videoRow(i + 1))
    const { run, calls } = tickWith(rows, { isVideoEnabled: async () => false })
    const r = await run()
    expect(calls.limits).toEqual([MAX_PER_TICK + VIDEO_SKIP_LOOKAHEAD])
    expect(calls.posted).toEqual([])
    expect(r.note).toBe('video_lookahead_exhausted')
  })

  it('does not note exhaustion when the read was short (the queue simply ran out)', async () => {
    const { run } = tickWith([videoRow(1), videoRow(2)], { isVideoEnabled: async () => false })
    const r = await run()
    expect(r).not.toHaveProperty('note')
  })

  it('does not note exhaustion when the read was full but held a still', async () => {
    const rows = Array.from({ length: MAX_PER_TICK + VIDEO_SKIP_LOOKAHEAD }, (_, i) =>
      i === MAX_PER_TICK + VIDEO_SKIP_LOOKAHEAD - 1 ? stillRow(i + 1) : videoRow(i + 1))
    const { run, calls } = tickWith(rows, { isVideoEnabled: async () => false })
    const r = await run()
    expect(calls.posted).toEqual([MAX_PER_TICK + VIDEO_SKIP_LOOKAHEAD])
    expect(r).not.toHaveProperty('note')
  })

  it('does not note exhaustion with the video valve on', async () => {
    const { run } = tickWith([videoRow(1), videoRow(2)], { isVideoEnabled: async () => true })
    const r = await run()
    expect(r).not.toHaveProperty('note')
  })
})

describe('the tick deps read the right valves', () => {
  beforeEach(() => {
    valves.clear()
    getValveMock.mockClear()
    publishMock.mockReset()
  })

  it('both scheduled platforms read video_team_autopublish for isVideoEnabled', async () => {
    for (const depsFor of [instagramTickDeps, xTickDeps]) {
      const deps = await depsFor()
      valves.set(VALVE_KEYS.videoAutopublish, false)
      expect(await deps.isVideoEnabled!()).toBe(false)
      valves.set(VALVE_KEYS.videoAutopublish, true)
      expect(await deps.isVideoEnabled!()).toBe(true)
    }
    expect(getValveMock.mock.calls.every(([k]) => k === 'video_team_autopublish')).toBe(true)
  })

  it('keeps the platform valve separate from the video valve', async () => {
    valves.set(VALVE_KEYS.videoAutopublish, true)
    expect(await (await instagramTickDeps()).isEnabled()).toBe(false)
    expect(await (await xTickDeps()).isEnabled()).toBe(false)
    expect(getValveMock.mock.calls.map(([k]) => k)).toEqual([VALVE_KEYS.instagramAutopublish, VALVE_KEYS.xAutopublish])
  })

  it('end to end on X: video valve off skips the row even with x_autopublish_enabled on', async () => {
    valves.set(VALVE_KEYS.xAutopublish, true)
    valves.set(VALVE_KEYS.videoAutopublish, false)
    const deps = await xTickDeps()
    const { repo, calls } = fakeRepo([videoRow(1, { platform: 'x' })])
    const r = await runSocialPublishTick({
      ...deps,
      repo,
      removalWatch: async () => null,
      maxPerDay: async () => 2,
      monthSpendUsd: async () => 0,
      maxSpendUsd: async () => 15,
      productHandleFor: async () => null,
    })
    expect(r.attempts).toEqual([{ postId: 1, outcome: 'skipped_video_valve_off' }])
    expect(calls.claimed).toEqual([])
    expect(publishMock).not.toHaveBeenCalled()
  })
})

describe('manual-gate parity', () => {
  it('the tick and the manual Post-now path name the same video valve', () => {
    expect(VIDEO_TICK_VALVE_KEY).toBe(manualPublishValveKey(true))
    expect(VIDEO_TICK_VALVE_KEY).toBe('video_team_autopublish')
  })
})
