import { describe, expect, it } from 'vitest'

import {
  MONTHLY_PROFIT_GOAL_USD,
  PROBE_STALE_HOURS,
  UNREGISTERED_PR_HOURS,
  blockerEntries,
  fingerprintOf,
  moneyVerdict,
  probeFrom,
  sortEntries,
  staleProbeEntries,
  unregisteredEntries,
} from '~/lib/owner-queue.server'
import type { OwnerBlocker } from '~/lib/owner-blockers-core'

const NOW = Date.UTC(2026, 8, 2, 12, 0, 0)
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

function blocker(over: Partial<OwnerBlocker> = {}): OwnerBlocker {
  return {
    id: 1,
    dedupeKey: 'k',
    title: 'Flip promo_execute_enabled',
    detail: null,
    unblocks: null,
    whereToGo: '/admin — pipeline settings',
    category: 'valve',
    priority: 2,
    status: 'open',
    source: 'agent',
    sourceRef: null,
    evidence: null,
    verifyProbe: null,
    verifyArg: null,
    lastVerifiedAt: null,
    lastVerifyOk: null,
    firstSeenAt: hoursAgo(48),
    lastSeenAt: hoursAgo(1),
    ageDays: 2,
    ...over,
  }
}

describe('probe freshness', () => {
  it('treats a never-evaluated probe as stale, not as fresh', () => {
    // The absence of evidence is not evidence. A probe that has never run says
    // nothing about whether the condition holds, and rendering that as a pass
    // is how a blocker list quietly becomes decorative.
    const p = probeFrom(blocker({ verifyProbe: 'pr_merged', verifyArg: '1024' }), NOW)
    expect(p?.stale).toBe(true)
    expect(p?.lastEvaluatedAt).toBeNull()
  })

  it('goes stale exactly at the window', () => {
    const fresh = probeFrom(
      blocker({ verifyProbe: 'setting_true', lastVerifiedAt: hoursAgo(PROBE_STALE_HOURS - 1) }),
      NOW,
    )
    const old = probeFrom(
      blocker({ verifyProbe: 'setting_true', lastVerifiedAt: hoursAgo(PROBE_STALE_HOURS + 1) }),
      NOW,
    )
    expect(fresh?.stale).toBe(false)
    expect(old?.stale).toBe(true)
  })

  it('returns null when there is no probe at all', () => {
    // Distinct from a stale one: no probe is an honest gap (a `console` or
    // `decision` blocker has nothing checkable), a stale probe is a broken
    // check. Collapsing them would hide the second behind the first.
    expect(probeFrom(blocker(), NOW)).toBeNull()
  })

  it('carries lastOk through without reinterpreting it', () => {
    const p = probeFrom(
      blocker({ verifyProbe: 'env_present', lastVerifiedAt: hoursAgo(1), lastVerifyOk: false }),
      NOW,
    )
    expect(p?.lastOk).toBe(false)
    expect(p?.stale).toBe(false)
  })
})

describe('every entry names a move', () => {
  it('uses whereToGo as the move when the blocker gives one', () => {
    const [e] = blockerEntries([blocker()], NOW)
    expect(e!.move).toBe('/admin — pipeline settings')
  })

  it('falls back to the title rather than inventing a move', () => {
    // A blocker whose title does not imply an action is a badly-filed blocker.
    // Synthesising a plausible-sounding move here would hide that from the
    // person who has to act on it.
    const [e] = blockerEntries([blocker({ whereToGo: '   ' })], NOW)
    expect(e!.move).toBe('Flip promo_execute_enabled')
  })

  it('gives every entry a non-empty move', () => {
    const entries = [
      ...blockerEntries([blocker(), blocker({ id: 2, whereToGo: null })], NOW),
      ...unregisteredEntries({
        ownerOnlyTickets: [{ id: 77, kind: 'config', ageDays: 9, suggestion: 'raise a cap' }],
        needsOwnerPrs: [{ number: 991, title: 'vision gate', ageHours: 100 }],
        registeredRefs: new Set<string>(),
      }),
    ]
    expect(entries.length).toBeGreaterThan(0)
    for (const e of entries) expect(e.move.trim().length, e.id).toBeGreaterThan(0)
  })
})

describe('the counter-rule for unregistered owner asks', () => {
  it('flags an owner-only ticket that no blocker mentions', () => {
    const [e] = unregisteredEntries({
      ownerOnlyTickets: [{ id: 77, kind: 'config', ageDays: 30, suggestion: 'raise the cap' }],
      needsOwnerPrs: [],
      registeredRefs: new Set<string>(),
    })
    expect(e!.cls).toBe('unregistered-owner-ask')
    expect(e!.move).toContain('#77')
  })

  it('stays quiet when a blocker already registered it', () => {
    // Otherwise every properly-filed ask would appear twice, and a rule that
    // duplicates the well-behaved cases is one people learn to ignore.
    const out = unregisteredEntries({
      ownerOnlyTickets: [{ id: 77, kind: 'config', ageDays: 30, suggestion: 'x' }],
      needsOwnerPrs: [{ number: 991, title: 'y', ageHours: 200 }],
      registeredRefs: new Set(['ticket:77', 'pr:991']),
    })
    expect(out).toEqual([])
  })

  it('gives a needs-owner PR a grace period before calling it unregistered', () => {
    // A PR labelled ten minutes ago has not been forgotten, it has just been
    // labelled. Flagging it immediately would make the rule fire on every
    // ordinary escalation.
    const fresh = unregisteredEntries({
      ownerOnlyTickets: [],
      needsOwnerPrs: [{ number: 1, title: 'x', ageHours: UNREGISTERED_PR_HOURS - 1 }],
      registeredRefs: new Set<string>(),
    })
    const stale = unregisteredEntries({
      ownerOnlyTickets: [],
      needsOwnerPrs: [{ number: 1, title: 'x', ageHours: UNREGISTERED_PR_HOURS + 1 }],
      registeredRefs: new Set<string>(),
    })
    expect(fresh).toEqual([])
    expect(stale).toHaveLength(1)
  })
})

describe('stale-probe entries', () => {
  it('raises one for a probe that has gone quiet on an older row', () => {
    const base = blockerEntries(
      [blocker({ verifyProbe: 'pr_merged', verifyArg: '1024', ageDays: 3 })],
      NOW,
    )
    const [e] = staleProbeEntries(base)
    expect(e!.cls).toBe('stale-probe')
    expect(e!.move).toContain('/cron/blocker-list')
  })

  it('does not fire on a row filed today', () => {
    // A blocker filed twenty minutes ago has a never-evaluated probe by
    // definition. Flagging it would put a warning on the queue the moment
    // anything is filed, which trains the reader to skip the class.
    const base = blockerEntries(
      [blocker({ verifyProbe: 'pr_merged', ageDays: 0 })],
      NOW,
    )
    expect(staleProbeEntries(base)).toEqual([])
  })

  it('does not fire when the probe is fresh', () => {
    const base = blockerEntries(
      [blocker({ verifyProbe: 'setting_true', lastVerifiedAt: hoursAgo(2), ageDays: 5 })],
      NOW,
    )
    expect(staleProbeEntries(base)).toEqual([])
  })
})

describe('ordering and fingerprinting', () => {
  it('sorts by priority, then by age', () => {
    const entries = blockerEntries(
      [
        blocker({ id: 1, priority: 3, ageDays: 1 }),
        blocker({ id: 2, priority: 1, ageDays: 1 }),
        blocker({ id: 3, priority: 3, ageDays: 40 }),
      ],
      NOW,
    )
    expect(sortEntries(entries).map((e) => e.id)).toEqual(['blocker:2', 'blocker:3', 'blocker:1'])
  })

  it('ignores age, so an unchanged queue fingerprints the same tomorrow', () => {
    // The whole point of the send-on-change rule. If age were included, the
    // fingerprint would change every single day and "send only when the queue
    // changed" would silently mean "send every day" — the rule still there,
    // doing nothing.
    const today = blockerEntries([blocker({ ageDays: 2 })], NOW)
    const tomorrow = blockerEntries([blocker({ ageDays: 3 })], NOW + 86_400_000)
    expect(fingerprintOf(today)).toBe(fingerprintOf(tomorrow))
  })

  it('changes when a row is added, removed, or re-prioritised', () => {
    const a = blockerEntries([blocker({ id: 1 })], NOW)
    const b = blockerEntries([blocker({ id: 1 }), blocker({ id: 2 })], NOW)
    const c = blockerEntries([blocker({ id: 1, priority: 1 })], NOW)
    expect(fingerprintOf(a)).not.toBe(fingerprintOf(b))
    expect(fingerprintOf(a)).not.toBe(fingerprintOf(c))
  })

  it('is order-independent', () => {
    const x = blockerEntries([blocker({ id: 1 }), blocker({ id: 2 })], NOW)
    const y = blockerEntries([blocker({ id: 2 }), blocker({ id: 1 })], NOW)
    expect(fingerprintOf(x)).toBe(fingerprintOf(y))
  })
})

describe('the money verdict', () => {
  it('says plainly that the fleet costs more than the store earns', () => {
    // The real numbers, read from production 2026-09-02: zero orders in 7 days,
    // $19.62 profit over 30, $93.31 of estate spend over the same 30. Every
    // invariant in this program is about the fleet's health and none is about
    // the store's; a money block that opened with "profit vs goal" would report
    // this as a percentage rather than as a fact.
    const v = moneyVerdict({
      ordersLast7: 0,
      revenueLast7Usd: 0,
      profitLast30Usd: 19.62,
      goalUsd: MONTHLY_PROFIT_GOAL_USD,
      estateSpendLast30Usd: 93.31,
      subscriptionRatedCeilingUsd: 2397.14,
      subscriptionRatedUnknownPct: 95,
      fixedMonthlyUsd: null,
    })
    expect(v).toContain('$93.31')
    expect(v).toContain('took nothing')
    expect(v).toContain('demand question')
  })

  it('distinguishes an unreadable number from a zero', () => {
    const v = moneyVerdict({
      ordersLast7: null,
      revenueLast7Usd: null,
      profitLast30Usd: null,
      goalUsd: MONTHLY_PROFIT_GOAL_USD,
      estateSpendLast30Usd: null,
      subscriptionRatedCeilingUsd: null,
      subscriptionRatedUnknownPct: null,
      fixedMonthlyUsd: null,
    })
    expect(v).toContain('gap, not a zero')
  })

  it('reports both sides once there is revenue', () => {
    const v = moneyVerdict({
      ordersLast7: 4,
      revenueLast7Usd: 240,
      profitLast30Usd: 300,
      goalUsd: MONTHLY_PROFIT_GOAL_USD,
      estateSpendLast30Usd: 93.31,
      subscriptionRatedCeilingUsd: 2397.14,
      subscriptionRatedUnknownPct: 95,
      fixedMonthlyUsd: null,
    })
    expect(v).toContain('$240.00')
    expect(v).toContain('$93.31')
  })
})
