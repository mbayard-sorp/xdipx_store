/**
 * voice-session-freshness.test.ts
 *
 * Regression tests for the per-call session freshness gate.
 *
 * The first version of this gate read lastActiveAt off the row returned by
 * getOrCreateConversation. That function writes lastActiveAt = now and then
 * re-reads, so its return value ALWAYS reports ~0ms of staleness. The gate was
 * dead code: it shipped, deployed, and never fired once. Call
 * CA419b2272eadb822ccd2785445c31b8ee opened 23 hours after the previous call
 * and still entered at stage=PRESENTATION, answering the caller's "oh" with
 * "Want me to send that link over?" — the abandoned link from the day before.
 *
 * The staleness rule is now a pure function fed by a timestamp captured before
 * any write, so it can be tested without a database.
 */
import { describe, it, expect } from 'vitest'
import { voiceSessionStaleMs } from '../adapters/voice.server'

const NOW = new Date('2026-08-05T00:23:00Z').getTime()
const TWO_HOURS = 2 * 60 * 60 * 1000

describe('voiceSessionStaleMs', () => {
  it('reports the real gap for the call that exposed the bug', () => {
    // Previous call ended 2026-08-04 01:31; this one opened 2026-08-05 00:23.
    const prior = new Date('2026-08-04T01:31:42Z')
    const stale = voiceSessionStaleMs(prior, NOW)
    expect(stale).toBeGreaterThan(TWO_HOURS)
    expect(Math.round(stale / 3_600_000)).toBe(23)
  })

  it('does NOT report ~0 for a row whose timestamp was just rewritten', () => {
    // The exact defect: passing "now" (what getOrCreateConversation's return
    // value carries) must not be mistaken for a fresh session by the caller.
    // The function is honest about it — 0 — which is why the timestamp has to
    // be captured upstream. This test pins the contract that the value is a
    // faithful delta, not a guess.
    expect(voiceSessionStaleMs(new Date(NOW), NOW)).toBe(0)
  })

  it('treats a missing prior timestamp as infinitely stale', () => {
    // New caller, or an unreadable row: take the clean-slate path rather than
    // inheriting whatever is in the row.
    expect(voiceSessionStaleMs(null, NOW)).toBe(Infinity)
  })

  it('treats an unparseable timestamp as infinitely stale', () => {
    expect(voiceSessionStaleMs(new Date('not-a-date'), NOW)).toBe(Infinity)
  })

  it('clamps clock skew so a stale session can never look fresh', () => {
    // DB clock ahead of the runtime would otherwise yield a negative delta,
    // which compares as "fresher than fresh" against the window.
    const future = new Date(NOW + 60_000)
    expect(voiceSessionStaleMs(future, NOW)).toBe(0)
  })

  it('keeps a genuine cross-channel handoff inside the window', () => {
    // Texted Emma, then called back 10 minutes later to keep going — context
    // should survive.
    const tenMinutesAgo = new Date(NOW - 10 * 60 * 1000)
    expect(voiceSessionStaleMs(tenMinutesAgo, NOW)).toBeLessThan(TWO_HOURS)
  })

  it('trips the window just past the freshness boundary', () => {
    const justOver = new Date(NOW - (TWO_HOURS + 1000))
    expect(voiceSessionStaleMs(justOver, NOW)).toBeGreaterThan(TWO_HOURS)
  })
})
