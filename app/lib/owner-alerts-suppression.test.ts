// The owner queue valve, exercised against the real sender.
//
// This file exists because of a two-day outage that every existing test was
// blind to. `owner-digest-send.test.ts` covers `shouldSendDigest()` as a pure
// function and the money-block renderer, and `owner-escalation.test.ts` covers
// the class registry as data. Neither ever called `sendOwnerEmail` with the
// valve on, so nothing noticed that turning `owner_queue_enabled` to `true` on
// 2026-09-03 made the digest suppress itself: `daily-digest` was classed
// `queue`, the sender's guard read `channel !== 'page'`, and the carrier of the
// owner queue was swallowed by the valve that exists to fold OTHER classes into
// it. `/cron/owner-digest` returned 500 on both days it ran, the failure was
// recorded in `cron_runs`, and nothing reads failed rows.
//
// `resetOwnerQueueCache()` had been exported as a test seam and had zero
// callers in the entire tree. That is the tell: the seam was built for a test
// that was never written, and the untested path was the one that broke.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getPipelineSetting = vi.fn<(key: string) => Promise<string | null>>()

vi.mock('~/lib/feed-processor.server', () => ({
  getPipelineSetting: (key: string) => getPipelineSetting(key),
}))

import { resetOwnerQueueCache, sendOwnerEmail } from '~/lib/owner-alerts.server'

/** Valve on or off, with the 60s memo dropped so each case reads it fresh. */
function valve(on: boolean): void {
  getPipelineSetting.mockReset()
  getPipelineSetting.mockResolvedValue(on ? 'true' : 'false')
  resetOwnerQueueCache()
}

const SMTP_KEYS = ['ZOHO_SMTP_USER', 'ZOHO_SMTP_PASS'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  // Unset SMTP so a send that is NOT suppressed stops at the credential check
  // instead of dialling Zoho from CI. The distinction under test is
  // `suppressed` versus reaching the transport at all, and a missing-credential
  // return proves the guard let it through.
  for (const k of SMTP_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of SMTP_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  resetOwnerQueueCache()
})

describe('the queue valve and the digest carrier', () => {
  it('never suppresses the digest, which is the queue it would be folded into', async () => {
    // The regression. Before the fix this returned { suppressed: 'queue' }, the
    // caller read a falsy `sent` with no `error` and threw
    // "owner digest send failed: unknown error", and the cron 500ed daily.
    valve(true)
    const res = await sendOwnerEmail('subject', '<p>body</p>', { escalation: 'daily-digest' })
    expect(res.suppressed).toBeUndefined()
    expect(res.error).toBe('SMTP credentials not configured')
  })

  it('still suppresses a class that really is a queue section', async () => {
    // The valve must keep doing its job. `blocker-list` is the canonical case:
    // Stage D4 folded it into the queue deliberately and kept the cron only
    // because verifyBlockers() runs before the send.
    valve(true)
    const res = await sendOwnerEmail('subject', '<p>body</p>', { escalation: 'blocker-list' })
    expect(res.sent).toBe(false)
    expect(res.suppressed).toBe('queue')
  })

  it('still suppresses a lane class', async () => {
    valve(true)
    const res = await sendOwnerEmail('subject', '<p>body</p>', { escalation: 'ci-red-main' })
    expect(res.suppressed).toBe('lane')
  })

  it('never suppresses a paging class', async () => {
    valve(true)
    const res = await sendOwnerEmail('subject', '<p>body</p>', { escalation: 'money-path-down' })
    expect(res.suppressed).toBeUndefined()
  })

  it('suppresses nothing at all while the valve is off', async () => {
    valve(false)
    for (const cls of ['daily-digest', 'blocker-list', 'ci-red-main', 'money-path-down'] as const) {
      const res = await sendOwnerEmail('subject', '<p>body</p>', { escalation: cls })
      expect(res.suppressed, cls).toBeUndefined()
    }
  })

  it('fails open when the valve cannot be read', async () => {
    // A settings blip must never mute the owner. The sender already intended
    // this; nothing asserted it.
    getPipelineSetting.mockReset()
    getPipelineSetting.mockRejectedValue(new Error('neon down'))
    resetOwnerQueueCache()
    const res = await sendOwnerEmail('subject', '<p>body</p>', { escalation: 'blocker-list' })
    expect(res.suppressed).toBeUndefined()
  })

  it('reports a suppression distinguishably from a failure', async () => {
    // The shape the callers branch on. A suppression carries `suppressed` and
    // no `error`; a real failure carries `error` and no `suppressed`. Collapsing
    // the two into "not sent" is precisely what turned a deliberate design
    // decision into a daily 500.
    valve(true)
    const suppressed = await sendOwnerEmail('s', '<p>b</p>', { escalation: 'blocker-list' })
    const failed = await sendOwnerEmail('s', '<p>b</p>', { escalation: 'daily-digest' })
    expect(suppressed.error).toBeUndefined()
    expect(suppressed.suppressed).toBeTruthy()
    expect(failed.suppressed).toBeUndefined()
    expect(failed.error).toBeTruthy()
  })
})
