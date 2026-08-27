/**
 * logVideoCost normally skips a call with no output-seconds. A FAILED RunPod
 * render produces zero output-seconds while still burning (and being invoiced
 * for) GPU-seconds, passed as an explicit actualCostUsd. That burn must reach
 * api_token_log so the budget gate sees it (this ticket).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const inserts = vi.hoisted(() => [] as Record<string, unknown>[])

vi.mock('~/lib/db.server', () => ({
  db: {
    insert: () => ({ values: (v: Record<string, unknown>) => { inserts.push(v); return Promise.resolve() } }),
  },
}))
vi.mock('~/lib/kv.server', () => ({
  kvGet: vi.fn(async () => null),
  kvIncrBy: vi.fn(async () => undefined),
}))

import { logVideoCost } from './token-log.server'

beforeEach(() => { inserts.length = 0 })
afterEach(() => { vi.clearAllMocks() })

describe('logVideoCost — failed-render burn', () => {
  it('logs a positive actualCostUsd even when output seconds is 0', async () => {
    await logVideoCost({
      feature: 'video-clip',
      model: 'runpod/wan22',
      seconds: 0,
      caller: 'video-pipeline',
      sku: 'satin-wand',
      refId: 'job-1',
      actualCostUsd: 0.02,
    })
    expect(inserts).toHaveLength(1)
    expect(inserts[0]!['estCostUsd']).toBe('0.02')
    expect(inserts[0]!['feature']).toBe('video-clip')
  })

  it('still skips when there is genuinely nothing to bill (0 seconds, no burn)', async () => {
    await logVideoCost({
      feature: 'video-clip',
      model: 'runpod/wan22',
      seconds: 0,
      caller: 'video-pipeline',
      refId: 'job-2',
    })
    expect(inserts).toHaveLength(0)
  })

  it('skips a zero-dollar burn (a job that never ran)', async () => {
    await logVideoCost({
      feature: 'video-avatar',
      model: 'runpod/wan22-s2v',
      seconds: 0,
      caller: 'video-pipeline',
      refId: 'job-3',
      actualCostUsd: 0,
    })
    expect(inserts).toHaveLength(0)
  })

  it('still logs a normal completed clip (positive seconds)', async () => {
    await logVideoCost({
      feature: 'video-clip',
      model: 'runpod/wan22',
      seconds: 5,
      caller: 'video-pipeline',
      refId: 'job-4',
      actualCostUsd: 0.1,
    })
    expect(inserts).toHaveLength(1)
    expect(inserts[0]!['estCostUsd']).toBe('0.1')
  })
})
