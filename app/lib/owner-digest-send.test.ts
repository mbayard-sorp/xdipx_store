import { describe, expect, it } from 'vitest'

import { shouldSendDigest, renderMoneyBlock, renderOwnerQueueEntries } from '~/lib/owner-digest.server'
import type { MoneyBlock, OwnerQueueEntry } from '~/lib/owner-queue.server'

const base = {
  fingerprint: 'a:1|b:2',
  lastFingerprint: 'a:1|b:2',
  oldestEntryAgeDays: 1,
  isMonday: false,
}

describe('send-on-change', () => {
  it('stays quiet when nothing changed', () => {
    // The whole point of the stage. Fifteen senders became one, and one that
    // fires on an unchanged list is still a daily interruption.
    expect(shouldSendDigest(base)).toEqual({ send: false, reason: 'queue-unchanged' })
  })

  it('sends when the queue changed', () => {
    expect(shouldSendDigest({ ...base, fingerprint: 'a:1|b:2|c:3' }).send).toBe(true)
  })

  it('sends on Mondays regardless', () => {
    // A weekly floor. Without it, a genuinely stable queue would mean the owner
    // hears nothing indefinitely, and "no news" would slowly stop meaning
    // anything at all.
    expect(shouldSendDigest({ ...base, isMonday: true })).toEqual({ send: true, reason: 'monday' })
  })

  it('sends when something has been waiting a week, even unchanged', () => {
    // An unchanged queue is not the same as a queue that is fine. A row nobody
    // has touched in seven days is exactly the thing a quiet digest would bury.
    expect(shouldSendDigest({ ...base, oldestEntryAgeDays: 7 }).reason).toBe('entry-older-than-7d')
    expect(shouldSendDigest({ ...base, oldestEntryAgeDays: 6 }).send).toBe(false)
  })

  it('sends on the first ever run, when there is no prior fingerprint', () => {
    expect(shouldSendDigest({ ...base, lastFingerprint: null }).reason).toBe('queue-changed')
  })

  it('always returns a reason, so a quiet day is reportable', () => {
    // This is what closes the blind window. /cron/owner-digest is a recorded
    // route, and Stage C's classifyCronOutcome reads `{ skipped: '...' }` as
    // status `skipped` — distinct from both `succeeded` and `failed`, and
    // distinct again from a route with no row at all, which the janitor sweep
    // reads as a breach. A deliberately quiet day and a broken send must never
    // look the same, which they would if this ever returned nothing.
    for (const input of [base, { ...base, isMonday: true }, { ...base, fingerprint: 'x' }]) {
      expect(shouldSendDigest(input).reason.length).toBeGreaterThan(0)
    }
  })
})

describe('the money block', () => {
  const money: MoneyBlock = {
    ordersLast7: 0,
    revenueLast7Usd: 0,
    profitLast30Usd: 19.62,
    goalUsd: 2000,
    estateSpendLast30Usd: 93.31,
    verdict: 'the fleet cost more than the store took',
  }

  it('renders the real numbers', () => {
    const html = renderMoneyBlock(money)
    expect(html).toContain('$19.62')
    expect(html).toContain('$93.31')
    expect(html).toContain('the fleet cost more than the store took')
  })

  it('says "could not read" rather than showing a zero', () => {
    // A dead query and a dead store both produce no number. Rendering the first
    // as "$0.00" is how a digest reports GOOD over a broken pipeline, which
    // this estate has already paid for once.
    const html = renderMoneyBlock({ ...money, revenueLast7Usd: null, ordersLast7: null })
    expect(html).toContain('could not read')
    expect(html).not.toContain('<strong>0</strong>')
  })
})

describe('the queue rendering', () => {
  const entry = (over: Partial<OwnerQueueEntry> = {}): OwnerQueueEntry => ({
    id: 'blocker:1',
    cls: 'blocker',
    priority: 2,
    title: 'Flip promo_execute_enabled',
    move: '/admin — pipeline settings',
    ageDays: 3,
    source: 'blocker #1 (agent)',
    probe: null,
    ...over,
  })

  it('leads each entry with the move', () => {
    const html = renderOwnerQueueEntries([entry()])
    expect(html).toContain('&rarr; /admin — pipeline settings')
  })

  it('says so plainly when nothing is waiting', () => {
    expect(renderOwnerQueueEntries([])).toContain('Nothing is waiting on you')
  })

  it('flags a stale probe rather than showing its last verdict as current', () => {
    const html = renderOwnerQueueEntries([
      entry({ probe: { kind: 'pr_merged', arg: '1024', lastEvaluatedAt: null, lastOk: true, stale: true } }),
    ])
    expect(html).toContain('not evaluated in 24h')
  })

  it('distinguishes "no probe" from "stale probe"', () => {
    // An honest gap and a broken check are different problems with different
    // fixes, and a reader who cannot tell them apart will treat both as noise.
    expect(renderOwnerQueueEntries([entry()])).toContain('no probe')
  })

  it('caps the list and says how many are hidden', () => {
    const many = Array.from({ length: 30 }, (_, i) => entry({ id: `blocker:${i}` }))
    const html = renderOwnerQueueEntries(many)
    expect(html).toContain('and 5 more')
  })
})
