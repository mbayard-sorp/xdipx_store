/**
 * The cron manifest is asserted against reality, in the required `check` job.
 *
 * This one CAN be a CI gate, and the distinction matters. The routine-cadence
 * drift check deliberately is not: `AGENT_EDITOR_ALLOWLIST_RE` matches `.md`
 * only, so a `.json` manifest sits outside it, and a gate there would red any
 * agent-editor PR touching `routine-schedule.md` while agent-editor is
 * structurally unable to edit the JSON that would fix it — a permanently
 * unmergeable PR created by the machinery meant to stop drift. This file touches
 * no `.md` and no allowlist, so it creates no such deadlock.
 *
 * What it buys: a cron cannot be added to `vercel.json` without declaring what
 * its absence means and who acts on it. That is invariant 1 (no state without a
 * next actor) applied to the scheduler.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  CRON_EXPECTATIONS,
  CRON_EXPECTATION_BY_ROUTE,
  RECORDED_CRON_ROUTES,
  isRecordedCronRoute,
} from '~/lib/cron-expectations'

const REPO_ROOT = join(import.meta.dirname, '..', '..')

function vercelCrons(): Array<{ path: string; schedule: string }> {
  const raw = readFileSync(join(REPO_ROOT, 'vercel.json'), 'utf8')
  return (JSON.parse(raw).crons ?? []) as Array<{ path: string; schedule: string }>
}

describe('the cron expectation manifest', () => {
  it('declares an expectation for every cron in vercel.json', () => {
    const missing = vercelCrons()
      .map((c) => c.path)
      .filter((p) => !CRON_EXPECTATION_BY_ROUTE.has(p))
    // If this fails you added a cron without saying what its absence means or
    // who acts on it. Add a row to CRON_EXPECTATIONS; do not delete this test.
    expect(missing).toEqual([])
  })

  it('records the same schedule vercel.json does', () => {
    const drifted = vercelCrons()
      .filter((c) => {
        const e = CRON_EXPECTATION_BY_ROUTE.get(c.path)
        return e && e.schedule !== c.schedule
      })
      .map((c) => `${c.path}: vercel.json says "${c.schedule}", manifest says "${CRON_EXPECTATION_BY_ROUTE.get(c.path)?.schedule}"`)
    expect(drifted).toEqual([])
  })

  it('covers the GitHub Actions plane, which vercel.json cannot see', () => {
    // The single most load-bearing assertion in this file. The browser checkout
    // probe runs from Actions, outside Vercel and outside cronRoute, and it is
    // the closest thing this estate has to "can a customer reach checkout". A
    // manifest that enumerated the Vercel crons and stopped would certify that
    // blindness as healthy.
    const actions = CRON_EXPECTATIONS.filter((e) => e.plane === 'actions')
    expect(actions.length).toBeGreaterThan(0)

    const probe = CRON_EXPECTATION_BY_ROUTE.get('.github/workflows/checkout-probe.yml')
    expect(probe).toBeDefined()
    expect(probe?.moneyRelevant).toBe(true)

    const workflow = readFileSync(join(REPO_ROOT, '.github/workflows/checkout-probe.yml'), 'utf8')
    expect(workflow).toContain(probe!.schedule)
  })

  it('gives every route a period, a grace, and an owning lane', () => {
    for (const e of CRON_EXPECTATIONS) {
      expect(e.periodMinutes, e.route).toBeGreaterThan(0)
      // Zero grace is how a floor gets trained away: a 300s lambda plus a cold
      // start plus scheduler jitter is ordinary variance, and a line that WARNs
      // every day is a line the reader learns to skip.
      expect(e.graceMinutes, e.route).toBeGreaterThan(0)
      // Invariant 3: a breach files a ticket at a lane, never an email to the
      // owner. A route with no lane has nowhere to file.
      expect(e.ownerTeam, e.route).not.toBeNull()
    }
  })

  it('has no duplicate routes', () => {
    expect(CRON_EXPECTATION_BY_ROUTE.size).toBe(CRON_EXPECTATIONS.length)
  })

  it('never records the two pollers whose whole design is to not touch Neon', () => {
    // server/cron.ts builds a KV negative cache for these specifically so 1,440
    // daily invocations query Neon zero times. Recording them would reinstate
    // 2,880 writes a day of `skipped: idle` and pin DB compute awake around the
    // clock, on a platform billed by compute-hour. This is a regression guard,
    // not a style preference.
    expect(isRecordedCronRoute('/cron/enrichment-batch-poller')).toBe(false)
    expect(isRecordedCronRoute('/cron/video-job-poller')).toBe(false)
  })

  it('keeps the recorded set small enough to stay cheap', () => {
    // ~12 routes at their declared cadences is ~360 rows/day, ~5 MB/month
    // against 29 MB if everything were recorded. The number is not sacred; the
    // discipline of noticing when it grows is.
    //
    // Raised 15 -> 17 for /cron/db-backup and /cron/db-restore-probe (Stage
    // G1), and the arithmetic is why the raise is fine rather than the start of
    // a slide: both are DAILY, so they add 2 rows a day to ~360. The number
    // this cap actually guards against is a poller — the two every-2-minute
    // ones would add 2,880 a day between them, which is why they are asserted
    // unrecorded by name in the test above rather than left to this ceiling.
    expect(RECORDED_CRON_ROUTES.size).toBeLessThanOrEqual(17)
  })

  it('records the surfaces whose failure has a next actor', () => {
    for (const route of [
      '/cron/pricing-batch-recompute',
      '/cron/release-engine',
      '/cron/checkout-probe',
      '/cron/owner-digest',
      // Load-bearing in a way that is easy to miss: verifyBlockers() has exactly
      // one caller chain and it ends at this cron, so it is the only thing that
      // evaluates blocker probes and auto-clears rows.
      '/cron/blocker-list',
      '/cron/homepage-healthcheck',
      '/cron/profit-summary',
      // Money-adjacent, and one of the three that used to bypass the wrapper
      // entirely with a bare router.post.
      '/cron/purchase-reconcile',
    ]) {
      expect(isRecordedCronRoute(route), route).toBe(true)
    }
  })
})
