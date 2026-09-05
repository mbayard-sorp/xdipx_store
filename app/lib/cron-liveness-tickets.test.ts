// The close pass is the part worth testing, because it is the part that makes
// the alarm safe to arm at all.
//
// `fileDetectionTicket` dedupes against an index excluding only applied and
// dismissed, so an open undated row holds its key forever. An alarm that files
// and never closes therefore disarms itself permanently on its first firing.
// That is not hypothetical: four homepage freshness slots went mute exactly
// this way. So the assertions below care less about "does it file" than about
// "does it stop filing, and can it fire twice".
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FiledTicket {
  kind: string
  dedupeKey: string
  priority: number
  targetTeam?: string
  suggestion: string
}
interface ListFilter { dedupeKeys?: string[] }

const fileDetectionTicket = vi.fn<(i: FiledTicket) => Promise<number>>(async () => 1)
const listSuggestions = vi.fn<(f?: ListFilter) => Promise<Array<{ id: number }>>>(async () => [])
const transitionSuggestion =
  vi.fn<(id: number, to: string, actor: string, opts?: unknown) => Promise<void>>(async () => undefined)

/** Answer only for the pass whose keys match, the way the real query would. */
function openRowsFor(prefix: string, ids: number[]) {
  return async (f?: ListFilter) =>
    (f?.dedupeKeys ?? []).some(k => k.startsWith(prefix)) ? ids.map(id => ({ id })) : []
}

/** The nth ticket handed to fileDetectionTicket, or a failure if none was. */
function filed(n = 0): FiledTicket {
  const call = fileDetectionTicket.mock.calls[n]
  if (!call) throw new Error(`no fileDetectionTicket call at index ${n}`)
  return call[0]
}
const store = new Map<string, string>()

vi.mock('~/lib/detection-tickets.server', () => ({
  fileDetectionTicket: (i: FiledTicket) => fileDetectionTicket(i),
  makeDedupeKey: (...parts: unknown[]) => parts.filter(Boolean).join(':'),
}))
vi.mock('~/lib/kv.server', () => ({
  kvGet: async (k: string) => store.get(k) ?? null,
  kvSet: async (k: string, v: string) => { store.set(k, v) },
  kvDel: async (k: string) => { store.delete(k) },
}))
vi.mock('~/lib/team.server', () => ({
  listSuggestions: (f?: ListFilter) => listSuggestions(f),
  transitionSuggestion: (id: number, to: string, actor: string, opts?: unknown) =>
    transitionSuggestion(id, to, actor, opts),
}))

import { ESCALATE_AFTER_SWEEPS, reconcileCronAlarms } from '~/lib/cron-liveness-tickets.server'

type L = Parameters<typeof reconcileCronAlarms>[0][number]

function live(over: Partial<L> = {}): L {
  return {
    route: '/cron/x', plane: 'vercel', periodMinutes: 60, graceMinutes: 10,
    moneyRelevant: false, ownerTeam: 'strategy', lastSeenAt: new Date('2026-09-04T00:00:00Z'),
    source: 'row', ageMinutes: 5, breached: false, demandDriven: false,
    lastStatus: 'succeeded', lastError: null, consecutiveFailures: 0, failing: false,
    ...over,
  } as L
}

beforeEach(() => {
  store.clear()
  fileDetectionTicket.mockClear().mockResolvedValue(1)
  listSuggestions.mockClear().mockImplementation(async () => [])
  transitionSuggestion.mockClear()
})

describe('filing', () => {
  it('files a process row for a breach, never a code row on the first sweep', async () => {
    const out = await reconcileCronAlarms([live({ breached: true })], [])
    expect(out.filed).toEqual(['cron-breach:/cron/x'])
    expect(out.escalated).toEqual([])
    // `process` is the whole design: `code` has no agent-reachable close edge,
    // so filing there would guarantee an owner-only row.
    expect(filed().kind).toBe('process')
    expect(filed().targetTeam).toBe('strategy')
  })

  it('separates silence from failure, because they are different faults', async () => {
    const out = await reconcileCronAlarms(
      [live({ route: '/cron/a', breached: true }), live({ route: '/cron/b', failing: true, consecutiveFailures: 3 })],
      [],
    )
    expect(out.filed.sort()).toEqual(['cron-breach:/cron/a', 'cron-failing:/cron/b'])
  })

  it('prioritises a money-path route', async () => {
    await reconcileCronAlarms([live({ breached: true, moneyRelevant: true })], [])
    expect(filed().priority).toBe(1)
  })

  it('escalates to a code row only after the streak, and keys it apart', async () => {
    const row = live({ breached: true })
    for (let i = 1; i < ESCALATE_AFTER_SWEEPS; i += 1) {
      const mid = await reconcileCronAlarms([row], [])
      expect(mid.escalated, `sweep ${i}`).toEqual([])
    }
    const out = await reconcileCronAlarms([row], [])
    expect(out.escalated).toEqual(['cron-breach:/cron/x'])
    const code = fileDetectionTicket.mock.calls.map(c => c[0]).filter(k => k.kind === 'code')
    expect(code).toHaveLength(1)
    // A distinct key, or the code row would dedupe against the process row and
    // never appear at all.
    expect(code[0]!.dedupeKey).toBe('cron-breach:/cron/x:persistent')
  })
})

describe('closing, which is what makes the undated key safe', () => {
  it('closes an open row once the route reports life again', async () => {
    listSuggestions.mockImplementation(openRowsFor('cron-breach', [42]))
    const out = await reconcileCronAlarms([live({ breached: false })], [])
    expect(out.closed).toContain(42)
    expect(transitionSuggestion).toHaveBeenCalledWith(42, 'applied', 'system', expect.anything())
  })

  it('closes through the transition map, never a bulk update', async () => {
    listSuggestions.mockImplementation(openRowsFor('cron-breach', [7]))
    await reconcileCronAlarms([live()], [])
    const call = transitionSuggestion.mock.calls[0]
    expect(call?.[1]).toBe('applied')
    expect(call?.[2]).toBe('system')
  })

  it('survives a 409 on one row without abandoning the rest', async () => {
    listSuggestions.mockImplementation(openRowsFor('cron-breach', [1, 2]))
    transitionSuggestion.mockRejectedValueOnce(new Error('409 conflict'))
    const out = await reconcileCronAlarms([live()], [])
    expect(out.closed).toEqual([2])
  })

  it('lets the same route alarm a second time after it recovered', async () => {
    // The muting regression, stated as a test. If closing ever stops working
    // this is the assertion that fails, and it is the one failure that would
    // make the alarm worse than no alarm at all.
    const breached = live({ breached: true })
    await reconcileCronAlarms([breached], [])
    expect(store.has('cron:alarmcount:cron-breach:/cron/x')).toBe(true)

    listSuggestions.mockImplementation(openRowsFor('cron-breach', [99]))
    const healthy = await reconcileCronAlarms([live({ breached: false })], [])
    expect(healthy.closed).toContain(99)
    // The counter is released too, so the next incident starts from one rather
    // than escalating immediately on an old streak.
    expect(store.has('cron:alarmcount:cron-breach:/cron/x')).toBe(false)

    listSuggestions.mockImplementation(async () => [])
    fileDetectionTicket.mockClear()
    const again = await reconcileCronAlarms([breached], [])
    expect(again.filed).toEqual(['cron-breach:/cron/x'])
    expect(again.escalated).toEqual([])
  })
})

describe('what it refuses to file', () => {
  it('reports an unreadable actions-plane route instead of ticketing it', async () => {
    // A row with no cron_runs tier, no heartbeat and no external reader cannot
    // ever satisfy its floor. That is a manifest bug, and filing it every six
    // hours would rebuild the noise this whole change removes.
    const out = await reconcileCronAlarms(
      [live({ route: '.github/workflows/checkout-probe.yml', plane: 'actions', breached: true, source: 'none', lastSeenAt: null, ageMinutes: null })],
      [],
    )
    expect(out.unreadable).toEqual(['.github/workflows/checkout-probe.yml'])
    expect(out.filed).toEqual([])
  })

  it('never alarms on a demand-driven route', async () => {
    const out = await reconcileCronAlarms([live({ demandDriven: true, breached: false, source: 'none', lastSeenAt: null })], [])
    expect(out.filed).toEqual([])
    expect(out.unreadable).toEqual([])
  })

  it('keeps filing cheap when a filing throws', async () => {
    fileDetectionTicket.mockRejectedValue(new Error('bus down'))
    const out = await reconcileCronAlarms([live({ breached: true })], [])
    expect(out.filed).toEqual([])
  })
})

describe('unwatched lanes', () => {
  it('files one row per lane, at that lane', async () => {
    const out = await reconcileCronAlarms([], [{ team: 'social', runType: 'evening', runs: 12, lastRunAt: '2026-09-03' }])
    expect(out.filed).toEqual(['unwatched-lane:social:evening'])
    expect(filed().targetTeam).toBe('social')
  })
})
