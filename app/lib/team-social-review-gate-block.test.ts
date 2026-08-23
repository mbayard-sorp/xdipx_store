/**
 * Ticket #3895 (incident id49, 2026-08-16): a social-publish-gate BLOCK is an
 * account-safety hard stop the manual owner-approval path (`reviewSocialPost`,
 * behind the admin.socials `review` / `review-batch` intents) must never be
 * able to silently clear.
 *
 * `reviewSocialPost` refuses to write `reviewStatus:'approved'` when the row's
 * CURRENT feedback carries a stamped `[publish-gate BLOCK ...]` verdict, full
 * stop — there is no override path, so the ads-policy imagery-ceiling BLOCK
 * the gate agent can return (one BLOCK reason among others, with no separate
 * code path of its own) inherits the same guarantee as every other BLOCK.
 *
 * The autopublish tick's half of this ("the manual owner-approval path" vs.
 * "the autopublish tick") is covered by social-publish-job.server.test.ts.
 *
 * Same discipline as team-social-post-dedupe.test.ts: the database here is
 * PRODUCTION, so the db client (and kv.server) are mocked out entirely at
 * import time.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    /** FIFO of row-arrays handed to successive db.select() chains. */
    selects: [] as unknown[][],
    /** How many times db.select() was actually called. */
    selectCalls: 0,
    /** FIFO of row-arrays handed to successive db.update()...returning() chains. */
    updateResults: [] as unknown[][],
    /** How many times db.update() was actually called. */
    updateCalls: 0,
    /** Every value object passed to a update's .set(), in order. */
    updateSets: [] as unknown[],
  }

  /** A thenable proxy: any method returns itself, awaiting it yields result(). */
  function chain(result: () => unknown, onCall?: (m: string, args: unknown[]) => void) {
    const proxy: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
            Promise.resolve(result()).then(ok, err)
        }
        return (...args: unknown[]) => {
          onCall?.(String(prop), args)
          return proxy
        }
      },
    }) as Record<string, unknown>
    return proxy
  }

  const db = {
    select: () => {
      state.selectCalls++
      return chain(() => state.selects.shift() ?? [])
    },
    update: () => {
      state.updateCalls++
      return chain(
        () => state.updateResults.shift() ?? [],
        (m, args) => { if (m === 'set') state.updateSets.push(args[0]) },
      )
    },
  }
  return { state, db }
})

vi.mock('~/lib/db.server', () => ({ db: h.db }))

import { reviewSocialPost, wouldClearGateBlock } from '~/lib/team.server'

const BLOCK_STAMP =
  '[publish-gate BLOCK by social-publish-gate on 2026-08-16, product: none]\n' +
  'Explicit imagery: rendered vulva and anatomical detail past the ads-policy ceiling.'
const PASS_STAMP =
  '[publish-gate PASS by social-publish-gate on 2026-08-16, product: none]\nLooked at the frame.'
const REVISE_STAMP =
  '[publish-gate REVISE by social-publish-gate on 2026-08-16, product: none]\nTighten the CTA.'

beforeEach(() => {
  h.state.selects.length = 0
  h.state.selectCalls = 0
  h.state.updateResults.length = 0
  h.state.updateCalls = 0
  h.state.updateSets.length = 0
})

describe('wouldClearGateBlock (pure)', () => {
  it('is true only for a stamped BLOCK verdict', () => {
    expect(wouldClearGateBlock(BLOCK_STAMP)).toBe(true)
  })
  it('is false for PASS, REVISE, no stamp, and null', () => {
    expect(wouldClearGateBlock(PASS_STAMP)).toBe(false)
    expect(wouldClearGateBlock(REVISE_STAMP)).toBe(false)
    expect(wouldClearGateBlock('the owner just typed a plain note')).toBe(false)
    expect(wouldClearGateBlock(null)).toBe(false)
    expect(wouldClearGateBlock(undefined)).toBe(false)
  })
  it('is true on gate_status = block whatever the stamp says (#4913, column wins)', () => {
    expect(wouldClearGateBlock(PASS_STAMP, 'block')).toBe(true)
    expect(wouldClearGateBlock(null, 'block')).toBe(true)
    expect(wouldClearGateBlock(PASS_STAMP, 'pass')).toBe(false)
  })
})

describe('reviewSocialPost keeps the gate verdict across an owner approve (#4913 burn-in)', () => {
  it('preserves the PASS stamp behind the owner note and leaves the gate columns alone', async () => {
    h.state.selects.push([{ feedback: PASS_STAMP, status: 'draft', gateStatus: 'pass', editedText: null }])
    h.state.updateResults.push([{ id: 52 }])
    const result = await reviewSocialPost(52, { reviewStatus: 'approved', feedback: 'ship it', reviewedBy: 'mike' })
    expect(result).toEqual({ ok: true })
    const set = h.state.updateSets[0] as Record<string, unknown>
    expect(String(set['feedback']).startsWith('ship it')).toBe(true)
    expect(String(set['feedback'])).toContain(PASS_STAMP)
    expect(set).not.toHaveProperty('gateStatus')
  })

  it('burns the stamp and the gate columns when the owner also edits the caption', async () => {
    h.state.selects.push([{ feedback: PASS_STAMP, status: 'draft', gateStatus: 'pass', editedText: null }])
    h.state.updateResults.push([{ id: 53 }])
    const result = await reviewSocialPost(53, { reviewStatus: 'approved', editedText: 'a different line', reviewedBy: 'mike' })
    expect(result).toEqual({ ok: true })
    const set = h.state.updateSets[0] as Record<string, unknown>
    expect(set['gateStatus']).toBeNull()
    expect(set['gateFindings']).toBeNull()
    expect(set['feedback']).toBeNull()
  })

  it('refuses to approve on gate_status = block even with no stamp', async () => {
    h.state.selects.push([{ feedback: null, status: 'draft', gateStatus: 'block', editedText: null }])
    const result = await reviewSocialPost(54, { reviewStatus: 'approved', reviewedBy: 'mike' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('gate_block')
    expect(h.state.updateCalls).toBe(0)
  })
})

describe('reviewSocialPost gate-BLOCK hard stop (#3895)', () => {
  it('refuses to approve a row whose current feedback carries a stamped BLOCK, and never issues the update', async () => {
    h.state.selects.push([{ feedback: BLOCK_STAMP, status: 'draft' }])
    const result = await reviewSocialPost(49, {
      reviewStatus: 'approved',
      reviewedBy: 'mike',
    })
    expect(result).toEqual({
      ok: false,
      reason: 'gate_block',
      error: expect.stringContaining('unresolved publish-gate BLOCK'),
    })
    expect(h.state.updateCalls).toBe(0)
  })

  it('refuses even when the owner supplies fresh feedback text alongside the approval', async () => {
    // The owner typing something new does not launder the row: the check is
    // on the row's CURRENT stored feedback, read before any write happens.
    h.state.selects.push([{ feedback: BLOCK_STAMP, status: 'draft' }])
    const result = await reviewSocialPost(49, {
      reviewStatus: 'approved',
      feedback: 'looks fine to me, ship it',
      reviewedBy: 'mike',
    })
    expect(result.ok).toBe(false)
    expect(h.state.updateCalls).toBe(0)
  })

  it('approves normally when the row carries a PASS stamp', async () => {
    h.state.selects.push([{ feedback: PASS_STAMP, status: 'draft' }])
    h.state.updateResults.push([{ id: 50 }])
    const result = await reviewSocialPost(50, {
      reviewStatus: 'approved',
      reviewedBy: 'mike',
    })
    expect(result).toEqual({ ok: true })
    expect(h.state.updateCalls).toBe(1)
  })

  it('approves normally when the row has never been gated (no stamp at all)', async () => {
    h.state.selects.push([{ feedback: null, status: 'draft' }])
    h.state.updateResults.push([{ id: 51 }])
    const result = await reviewSocialPost(51, {
      reviewStatus: 'approved',
      reviewedBy: 'mike',
    })
    expect(result).toEqual({ ok: true })
    expect(h.state.updateCalls).toBe(1)
  })

  it('reports not_found rather than gate_block when the row is already posted', async () => {
    h.state.selects.push([{ feedback: BLOCK_STAMP, status: 'posted' }])
    const result = await reviewSocialPost(49, {
      reviewStatus: 'approved',
      reviewedBy: 'mike',
    })
    expect(result).toEqual({
      ok: false,
      reason: 'not_found',
      error: expect.stringContaining('already posted'),
    })
    expect(h.state.updateCalls).toBe(0)
  })

  it('does not run the gate-BLOCK check at all for non-approval decisions (reject/needs_changes stay reversible)', async () => {
    // Rejecting or requesting changes on a BLOCKed row is not "clearing" it,
    // so this path skips straight to the update without the pre-read.
    h.state.updateResults.push([{ id: 49 }])
    const result = await reviewSocialPost(49, {
      reviewStatus: 'needs_changes',
      feedback: 'redraft with a different frame',
      reviewedBy: 'mike',
    })
    expect(result).toEqual({ ok: true })
    expect(h.state.selectCalls).toBe(0)
    expect(h.state.updateCalls).toBe(1)
  })
})
