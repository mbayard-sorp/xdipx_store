import { describe, expect, it } from 'vitest'

import { classifyCronOutcome, heartbeatKey, CRON_RUN_RETENTION_DAYS } from '~/lib/cron-runs.server'

describe('classifyCronOutcome', () => {
  it('reads a plain 200 as succeeded', () => {
    expect(classifyCronOutcome({ statusCode: 200, payload: { ok: true, archived: 3 } }))
      .toEqual({ status: 'succeeded', error: null })
  })

  it('reads `skipped` as its own outcome, not as a failure', () => {
    // An idle poller and a gate-closed routine both did their job, and both
    // answer HTTP 200. Collapsing this into `succeeded` would make the two
    // every-2-minute pollers — idle most of the day by design — read as the
    // healthiest routes in the estate while telling you nothing.
    expect(classifyCronOutcome({ statusCode: 200, payload: { ok: true, skipped: 'idle' } }))
      .toEqual({ status: 'skipped', error: null })
    expect(classifyCronOutcome({ statusCode: 200, payload: { ok: true, skipped: 'locked' } }).status)
      .toBe('skipped')
  })

  it('does not mistake a non-string `skipped` for a skip', () => {
    // A handler answering `{ skipped: 0 }` or `{ skipped: false }` ran. Reading
    // a falsy-but-present key as a skip would silently hide real work.
    expect(classifyCronOutcome({ statusCode: 200, payload: { ok: true, skipped: 0 } }).status)
      .toBe('succeeded')
    expect(classifyCronOutcome({ statusCode: 200, payload: { ok: true, skipped: false } }).status)
      .toBe('succeeded')
  })

  it('reads a 4xx or 5xx as failed even when nothing threw', () => {
    expect(classifyCronOutcome({ statusCode: 500, payload: { error: 'boom' } }))
      .toEqual({ status: 'failed', error: 'HTTP 500' })
    expect(classifyCronOutcome({ statusCode: 400, payload: { error: 'railId required' } }).status)
      .toBe('failed')
  })

  it('prefers the thrown error text over the status code', () => {
    // The status code on a throw is whatever Express last set, often still 200.
    // The message is the diagnostic, so it wins.
    const out = classifyCronOutcome({ thrown: new Error('neon: connection reset'), statusCode: 200 })
    expect(out.status).toBe('failed')
    expect(out.error).toBe('neon: connection reset')
  })

  it('stringifies a non-Error throw rather than dropping it', () => {
    expect(classifyCronOutcome({ thrown: 'timed out', statusCode: 200 }))
      .toEqual({ status: 'failed', error: 'timed out' })
  })

  it('treats a handler that answered nothing as succeeded, not skipped', () => {
    // `payload` is null when res.json was never called (a res.send, a redirect,
    // a 204). Absence of a body is not evidence of a skip.
    expect(classifyCronOutcome({ statusCode: 200, payload: null }).status).toBe('succeeded')
    expect(classifyCronOutcome({ statusCode: 204 }).status).toBe('succeeded')
  })
})

describe('heartbeat keys and retention', () => {
  it('namespaces heartbeats per route', () => {
    expect(heartbeatKey('/cron/warm')).toBe('cron:lastok:/cron/warm')
    expect(heartbeatKey('/cron/warm')).not.toBe(heartbeatKey('/cron/warm-homepage'))
  })

  it('keeps failures far longer than successes', () => {
    // A succeeded row is worth a fortnight; a failed one is evidence you may
    // need months later to establish when a lane actually broke.
    expect(CRON_RUN_RETENTION_DAYS.failed).toBeGreaterThan(CRON_RUN_RETENTION_DAYS.ok)
  })
})
