/**
 * Ticket #9699. `readCronLiveness()`'s own contract (cron-runs.server.ts) is
 * "has this surface shown evidence of life", not "did it succeed" — but the
 * `instrument()` wrapper here used to call `heartbeatCron` only `if (!failed)`.
 * For an unrecorded route (a KV heartbeat is its only liveness tier) that made
 * the route's own correct, deliberate non-2xx report of a content problem the
 * reason its liveness signal went stale: notebook-healthcheck and seo-daily
 * both fired on schedule and 503'd on a real finding, and the janitor sweep
 * read both as dark for over a day.
 *
 * Asserted against the source text rather than by exercising the Express
 * router, matching this file's existing convention (see
 * cron-lock-ttl.test.ts): the point is that the heartbeat call in the
 * `finally` block is unconditional, and importing `server/cron.ts` for real
 * would not check that without reproducing Express's req/res plumbing.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CRON_SRC = readFileSync(join(process.cwd(), 'server', 'cron.ts'), 'utf8')

describe('cron heartbeat liveness invariant (#9699)', () => {
  it('calls heartbeatCron unconditionally in the finally block', () => {
    const line = CRON_SRC.split('\n').find((l) => l.includes('await heartbeatCron(route, startedAt)'))
    expect(line, 'heartbeatCron call should still exist in the instrument() finally block').toBeDefined()
    // A regression here would look like `if (!failed) await heartbeatCron(...)`
    // or `if (someCondition) {` on the same line as the call.
    expect(line).not.toMatch(/if\s*\(/)
  })

  it('still records every invocation into cron_runs regardless of outcome', () => {
    // recordCronRun's own call must not be newly gated either — the fix is
    // "heartbeat always", not "stop recording failures".
    expect(CRON_SRC).toMatch(/await recordCronRun\(\{/)
    const recordIndex = CRON_SRC.indexOf('await recordCronRun({')
    const precedingLine = CRON_SRC.slice(0, recordIndex).split('\n').at(-2) ?? ''
    expect(precedingLine).not.toMatch(/if\s*\(/)
  })
})
