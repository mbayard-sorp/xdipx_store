import { describe, expect, it } from 'vitest'

import { ACTION_FLOOR_SESSIONS, summarize } from '~/lib/ga4-summary.server'
import type { HomepageSignals } from '~/lib/ga4.server'

function signals(over: Partial<HomepageSignals> = {}): HomepageSignals {
  return {
    isConfigured: true,
    windowDays: 28,
    activeUsers: 29,
    sessions: 141,
    screenPageViews: 400,
    engagementRate: 0.5,
    topPages: [],
    topProductPages: [],
    addToCarts: 1,
    checkouts: 1,
    purchases: 1,
    revenue: 28.11,
    itemLists: [],
    dataGaps: [],
    ...over,
  }
}

describe('the GA4 action floor', () => {
  it('refuses to call the live numbers actionable', () => {
    // The real measurement, 2026-09-02, against production property 532477050.
    // One purchase in 28 days. A routine reading a 30% swing in add-to-carts
    // here is reading the difference between one and zero, and this is what
    // stops seven briefs that said "unreadable" becoming seven briefs that
    // optimise confidently on n=1.
    const s = summarize(signals())
    expect(s.sessions).toBe(141)
    expect(s.purchases).toBe(1)
    expect(s.actionable).toBe(false)
    expect(s.verdict).toContain('do not optimise on them')
  })

  it('turns actionable at the floor, not above it', () => {
    expect(summarize(signals({ sessions: ACTION_FLOOR_SESSIONS - 1 })).actionable).toBe(false)
    expect(summarize(signals({ sessions: ACTION_FLOOR_SESSIONS })).actionable).toBe(true)
  })

  it('still reports the numbers when they are not actionable', () => {
    // Not actionable is not "withhold". The strategy brief should still print
    // 141 sessions and one purchase; what it must not do is act on the delta.
    const s = summarize(signals())
    expect(s.revenue).toBe(28.11)
    expect(s.activeUsers).toBe(29)
    expect(s.windowDays).toBe(28)
  })

  it('distinguishes "not configured" from "no traffic"', () => {
    // The failure this whole endpoint exists to end: an unreadable API and a
    // dead store both render as zeroes unless something separates them. Seven
    // consecutive briefs printed "GA4 UNREADABLE" about a module that worked.
    const unconfigured = summarize(signals({ isConfigured: false, sessions: 0, purchases: 0 }))
    expect(unconfigured.configured).toBe(false)
    expect(unconfigured.actionable).toBe(false)
    expect(unconfigured.verdict).toContain('not configured')
    expect(unconfigured.verdict).toContain('distinct from thin traffic')

    const quiet = summarize(signals({ sessions: 0, purchases: 0 }))
    expect(quiet.configured).toBe(true)
    expect(quiet.verdict).not.toContain('not configured')
  })

  it('never marks an unconfigured property actionable, whatever it reports', () => {
    // Belt and braces: a stale cache or a partial report could carry a big
    // session count with isConfigured false. Acting on that would be acting on
    // numbers from nowhere.
    const s = summarize(signals({ isConfigured: false, sessions: 50_000 }))
    expect(s.actionable).toBe(false)
  })

  it('carries data gaps through rather than swallowing them', () => {
    const s = summarize(signals({ dataGaps: ['ecommerce sub-report failed'] }))
    expect(s.dataGaps).toEqual(['ecommerce sub-report failed'])
  })

  it('publishes the floor it used, so a consumer can explain itself', () => {
    expect(summarize(signals()).actionFloorSessions).toBe(ACTION_FLOOR_SESSIONS)
  })
})
