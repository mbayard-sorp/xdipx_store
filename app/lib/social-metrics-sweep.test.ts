/**
 * Scheduled social metrics sweep (ticket #4916). Every dependency is injected;
 * nothing here touches the DB, KV, or either platform.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  runSocialMetricsSweep,
  monthKey,
  SWEEP_SAMPLE,
  X_METRICS_MAX_READS_MONTH_DEFAULT,
  type SocialMetricsSweepDeps,
} from './social-metrics-sweep.server'
import type { EngagementCaptureRepo, EngagementCaptureRow, EngagementReportRow } from './social-engagement.server'

const NOW = new Date('2026-08-22T18:20:00Z')

function rows(n: number): EngagementCaptureRow[] {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, externalPostId: `ext-${i + 1}`, postedAt: NOW }))
}

function repoOf(list: EngagementCaptureRow[]): EngagementCaptureRepo {
  return { recentPosted: async () => list, persistMetrics: vi.fn(async () => {}) }
}

/** A capture double that reports one ok row per repo row, mirroring the real shape. */
function captureFrom(platform?: 'x') {
  return vi.fn(async (deps: { repo?: EngagementCaptureRepo } = {}): Promise<EngagementReportRow[]> => {
    const list = await deps.repo!.recentPosted(8)
    return list.map(r => ({
      postId: r.id,
      externalPostId: r.externalPostId!,
      metrics: { likes: 1 },
      ...(platform ? { platform } : {}),
    }))
  })
}

function baseDeps(over: SocialMetricsSweepDeps = {}) {
  const recordXReads = vi.fn(async () => {})
  const deps: SocialMetricsSweepDeps = {
    now: () => NOW,
    isEnabled: async () => true,
    xMaxReadsMonth: async () => X_METRICS_MAX_READS_MONTH_DEFAULT,
    xReadsThisMonth: async () => 0,
    recordXReads,
    instagramRepo: repoOf(rows(3)),
    xRepo: repoOf(rows(5)),
    captureInstagram: captureFrom(),
    captureX: captureFrom('x'),
    captureAccount: vi.fn(async () => ({ account: { followersCount: 120 } })),
    ...over,
  }
  return { deps, recordXReads }
}

describe('monthKey', () => {
  it('buckets by UTC month', () => {
    expect(monthKey(new Date('2026-08-31T23:59:59Z'))).toBe('2026-08')
    expect(monthKey(new Date('2026-09-01T00:00:00Z'))).toBe('2026-09')
  })
})

describe('runSocialMetricsSweep', () => {
  it('does nothing when the valve is off', async () => {
    const { deps } = baseDeps({ isEnabled: async () => false })
    const result = await runSocialMetricsSweep(deps)
    expect(result.skipped).toBe('valve_off')
    expect(deps.captureInstagram).not.toHaveBeenCalled()
    expect(deps.captureX).not.toHaveBeenCalled()
    expect(deps.captureAccount).not.toHaveBeenCalled()
  })

  it('sweeps both platforms, records X reads, and takes a follower reading', async () => {
    const { deps, recordXReads } = baseDeps()
    const result = await runSocialMetricsSweep(deps)
    expect(result.instagram).toEqual({ checked: 3, errors: 0 })
    expect(result.x).toEqual({ checked: 5, errors: 0, readsUsedMonth: 5, maxReadsMonth: X_METRICS_MAX_READS_MONTH_DEFAULT })
    expect(recordXReads).toHaveBeenCalledWith('2026-08', 5)
    expect(result.account).toEqual({ account: { followersCount: 120 } })
  })

  it('skips X once the monthly read cap is reached and still sweeps Instagram', async () => {
    const { deps, recordXReads } = baseDeps({ xMaxReadsMonth: async () => 100, xReadsThisMonth: async () => 100 })
    const result = await runSocialMetricsSweep(deps)
    expect(result.x?.skipped).toBe('read_cap_reached')
    expect(result.x?.readsUsedMonth).toBe(100)
    expect(deps.captureX).not.toHaveBeenCalled()
    expect(recordXReads).not.toHaveBeenCalled()
    expect(result.instagram).toEqual({ checked: 3, errors: 0 })
  })

  it('bounds the X sample by the reads left this month', async () => {
    const { deps, recordXReads } = baseDeps({
      xMaxReadsMonth: async () => 10,
      xReadsThisMonth: async () => 8,
      xRepo: repoOf(rows(5)),
    })
    const result = await runSocialMetricsSweep(deps)
    expect(result.x?.checked).toBe(2)
    expect(result.x?.readsUsedMonth).toBe(10)
    expect(recordXReads).toHaveBeenCalledWith('2026-08', 2)
  })

  it('never sends more than SWEEP_SAMPLE ids to X in one sweep', async () => {
    const { deps, recordXReads } = baseDeps({ xRepo: repoOf(rows(SWEEP_SAMPLE + 10)) })
    const result = await runSocialMetricsSweep(deps)
    expect(result.x?.checked).toBe(SWEEP_SAMPLE)
    expect(recordXReads).toHaveBeenCalledWith('2026-08', SWEEP_SAMPLE)
  })

  it('a zero cap pauses X reads without touching Instagram', async () => {
    const { deps } = baseDeps({ xMaxReadsMonth: async () => 0 })
    const result = await runSocialMetricsSweep(deps)
    expect(result.x?.skipped).toBe('read_cap_reached')
    expect(result.instagram?.checked).toBe(3)
  })

  it('isolates a platform throw: Instagram failing does not stop X', async () => {
    const { deps } = baseDeps({ captureInstagram: vi.fn(async () => { throw new Error('graph down') }) })
    const result = await runSocialMetricsSweep(deps)
    expect(result.instagram).toEqual({ checked: 0, errors: 0, skipped: 'threw', detail: 'graph down' })
    expect(result.x?.checked).toBe(5)
  })

  it('counts error rows without failing the sweep', async () => {
    const { deps } = baseDeps({
      captureX: vi.fn(async (): Promise<EngagementReportRow[]> => [
        { postId: 1, externalPostId: 'ext-1', metrics: { likes: 2 }, platform: 'x' },
        { postId: 2, externalPostId: 'ext-2', error: 'gone', platform: 'x' },
      ]),
    })
    const result = await runSocialMetricsSweep(deps)
    expect(result.x?.checked).toBe(2)
    expect(result.x?.errors).toBe(1)
  })

  it('an account fetch throw lands on the account block only', async () => {
    const { deps } = baseDeps({ captureAccount: vi.fn(async () => { throw new Error('no token') }) })
    const result = await runSocialMetricsSweep(deps)
    expect(result.account).toEqual({ error: 'no token' })
    expect(result.instagram?.checked).toBe(3)
  })
})

// ── Phase 4: permalink backfill and the follower history table (#4939) ──────

describe('permalink backfill', () => {
  it('runs per platform after the metrics pass and reports what it filled', async () => {
    const backfillPermalink = vi.fn(async (p: 'instagram' | 'x') => (p === 'instagram' ? 2 : 5))
    const { deps } = baseDeps({ backfillPermalink })
    const result = await runSocialMetricsSweep(deps)
    expect(backfillPermalink).toHaveBeenCalledWith('instagram')
    expect(backfillPermalink).toHaveBeenCalledWith('x')
    expect(result.instagram?.permalinksBackfilled).toBe(2)
    expect(result.x?.permalinksBackfilled).toBe(5)
  })

  it('still backfills X under the read cap (permalinks are arithmetic, not reads), never fails a block, and is a no-op behind injected repos', async () => {
    const backfillPermalink = vi.fn(async (p: 'instagram' | 'x') => {
      if (p === 'instagram') throw new Error('graph down')
      return 1
    })
    const { deps } = baseDeps({ backfillPermalink, xMaxReadsMonth: async () => 0 })
    const result = await runSocialMetricsSweep(deps)
    expect(result.instagram).toEqual({ checked: 3, errors: 0 })
    expect(result.x?.skipped).toBe('read_cap_reached')
    expect(result.x?.permalinksBackfilled).toBe(1)

    // No dep injected and the repos are doubles: nothing reaches a database.
    const plain = await runSocialMetricsSweep(baseDeps().deps)
    expect(plain.instagram).not.toHaveProperty('permalinksBackfilled')
    expect(plain.x).not.toHaveProperty('permalinksBackfilled')
  })
})

describe('follower history table', () => {
  it('appends the account reading with the sweep timestamp, and tolerates a failed append', async () => {
    const appendFollowerHistory = vi.fn(async () => {})
    const { deps } = baseDeps({
      appendFollowerHistory,
      captureAccount: vi.fn(async () => ({ account: { followersCount: 120, followsCount: 7 } })),
    })
    const result = await runSocialMetricsSweep(deps)
    expect(appendFollowerHistory).toHaveBeenCalledWith({
      platform: 'instagram', capturedAt: NOW, followers: 120, follows: 7, mediaCount: null,
    })
    expect(result.account).toEqual({ account: { followersCount: 120, followsCount: 7 } })

    const failing = baseDeps({ appendFollowerHistory: vi.fn(async () => { throw new Error('neon down') }) })
    const r2 = await runSocialMetricsSweep(failing.deps)
    expect(r2.account).toEqual({ account: { followersCount: 120 } })

    // No reading, no row.
    const none = vi.fn(async () => {})
    await runSocialMetricsSweep(baseDeps({ appendFollowerHistory: none, captureAccount: vi.fn(async () => ({ error: 'no token' })) }).deps)
    expect(none).not.toHaveBeenCalled()
  })
})
