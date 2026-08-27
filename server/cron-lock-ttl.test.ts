/**
 * The poller lock invariant (ticket #5941).
 *
 * advanceJob dispatches on job.stage and marks no row busy, so the KV lock is
 * the ONLY thing keeping two passes off the same job. At the old 110s against
 * a 120s cron and a 300s maxDuration, any pass slower than 110s had its lock
 * expire while it was still working: the next tick acquired it, re-selected
 * the same in-flight rows and re-ran the same stage concurrently — composing
 * and PAYING FOR a second set of frame candidates, or re-running the post pass
 * with its metered music generation.
 *
 * This is a config invariant, not a behaviour, so it is asserted against the
 * two files that carry the numbers rather than by exercising a lambda. Reading
 * them as text is deliberate: the point is that cron.ts and vercel.json agree,
 * and importing either would not check that.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CRON_SRC = readFileSync(join(process.cwd(), 'server', 'cron.ts'), 'utf8')
const VERCEL = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
  builds: { config: { maxDuration: number } }[]
  crons: { path: string; schedule: string }[]
}

const maxDuration = VERCEL.builds[0]!.config.maxDuration
const lockTtl = Number(/const POLLER_LOCK_TTL_SECONDS = (\d+)/.exec(CRON_SRC)?.[1])

describe('poller lock TTL invariant', () => {
  it('declares a single shared TTL constant', () => {
    expect(Number.isFinite(lockTtl)).toBe(true)
  })

  it('outlives the function, so a lock cannot lapse while its holder still runs', () => {
    // The margin below maxDuration is intentional: the lambda is killed first,
    // then the lock lapses, then the next tick retries. Never the reverse.
    expect(lockTtl).toBeGreaterThanOrEqual(maxDuration - 10)
    expect(lockTtl).toBeLessThanOrEqual(maxDuration)
  })

  it('outlives the video poller cron interval, so the next tick skips rather than doubling up', () => {
    const schedule = VERCEL.crons.find(c => c.path === '/cron/video-job-poller')?.schedule
    expect(schedule).toBe('*/2 * * * *')
    expect(lockTtl).toBeGreaterThan(2 * 60)
  })

  it('is what both pollers actually pass to kvSetNX — no stray literal TTLs', () => {
    for (const lock of ['lock:video-poller', 'lock:enrichment-poller']) {
      // Match the whole call line: a nested `)` from String(Date.now()) makes a
      // [^)]* pattern stop early and silently assert nothing.
      const line = CRON_SRC.split('\n').find(l => l.includes(`kvSetNX('${lock}'`)) ?? ''
      expect(line, `${lock} should use the shared constant`).toContain('POLLER_LOCK_TTL_SECONDS')
      expect(line, `${lock} should not carry a hardcoded TTL`).not.toMatch(/,\s*\d+\s*\)/)
    }
  })
})
