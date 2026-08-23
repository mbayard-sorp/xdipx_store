// What the manual Post-now path refuses, and what it deliberately no longer
// refuses.
//
// Ticket #3674 / incident #3640: Post-now once bypassed the publish gate
// entirely and gated every surface on the VIDEO valve, so an approved-by-hand
// Instagram still (post #49) reached Instagram without the gate ever seeing it
// and the Instagram kill switch governed nothing here.
//
// The publish-gate PASS stamp requirement that fixed it is lifted for the
// owner's click by owner direction (2026-08-23): the stamp is written by an
// agent on its own run, the Studio cannot summon one, so the button could never
// fire. The deterministic checks — facts, not judgment — took its place. These
// pin both halves: a hard fact still refuses, an absent or negative agent
// verdict no longer does.
import { describe, expect, it, vi } from 'vitest'
import { decideManualPublish, manualPublishValveKey } from './manual-publish-gate.server'
import type { DeterministicGateInput, DeterministicGateResult } from '../social-publish-gate.server'
import { VALVE_KEYS } from '../team-keys'

/** A stand-in check runner, so these tests never touch Shopify. */
function checksReturning(result: Partial<DeterministicGateResult>) {
  return vi.fn(async (_input: DeterministicGateInput): Promise<DeterministicGateResult> => ({
    findings: [], blocked: false, held: false, ...result,
  }))
}

const clean = () => checksReturning({})

const blockedOnStock = () => checksReturning({
  blocked: true,
  findings: [{ check: 'stock-out', severity: 'block', detail: '"lace-set" is out of stock.' }],
})

const POST = {
  isVideo: false,
  caption: 'a caption',
  mediaUrls: ['https://cdn.shopify.com/s/files/1/social-thing.jpg'],
}

// An always-on valve reader. Used where the valve is not what is under test.
const valveAlwaysOn = vi.fn(async () => true)

describe('decideManualPublish', () => {
  it('publishes a row with no gate stamp at all — the owner click is the approval', async () => {
    // Exactly post #49's shape: reviewed_by=Mike, no gate stamp anywhere. The
    // old guard refused this; by owner direction it now publishes, because the
    // deterministic checks are clean and the owner is looking at it.
    const runChecks = clean()
    const decision = await decideManualPublish(
      { ...POST, platform: 'x' }, valveAlwaysOn, { runChecks },
    )
    expect(decision.ok).toBe(true)
    expect(runChecks).toHaveBeenCalledOnce()
  })

  it('publishes over a REVISE or BLOCK agent verdict', async () => {
    // The agent verdict is a judgment. The owner may substitute his own; that
    // is the whole point of the change. Nothing about the verdict reaches this
    // decision any more, so there is no stamp to pass in.
    for (const platform of ['x', 'instagram'] as const) {
      const decision = await decideManualPublish(
        { ...POST, platform }, valveAlwaysOn, { runChecks: clean() },
      )
      expect(decision.ok).toBe(true)
    }
  })

  it('still refuses a hard fact, and names it', async () => {
    const getValve = vi.fn(async () => true)
    const decision = await decideManualPublish(
      { ...POST, platform: 'x' }, getValve, { runChecks: blockedOnStock() },
    )

    expect(decision.ok).toBe(false)
    if (!decision.ok) {
      expect(decision.error).toMatch(/out of stock/)
      expect(decision.findings?.some(f => f.check === 'stock-out')).toBe(true)
    }
    // The checks must run before any valve read: no valve state may buy a
    // publish past a hard fact.
    expect(getValve).not.toHaveBeenCalled()
  })

  it('runs the checks against the post the owner is actually publishing', async () => {
    const runChecks = clean()
    await decideManualPublish(
      { ...POST, platform: 'x', caption: 'the real caption', productHandle: 'lace-set' },
      valveAlwaysOn,
      { runChecks },
    )
    expect(runChecks).toHaveBeenCalledWith(expect.objectContaining({
      caption: 'the real caption',
      mediaUrls: POST.mediaUrls,
      platform: 'x',
      productHandle: 'lace-set',
    }))
  })

  it('does not enforce repetition on this path', async () => {
    // Repetition needs recentCaptions and is a judgment call ("you said
    // something similar last week"), which is the half the owner is overriding.
    // Not passing them is what keeps the check inert, so pin it.
    const runChecks = clean()
    await decideManualPublish({ ...POST, platform: 'x' }, valveAlwaysOn, { runChecks })
    expect(runChecks.mock.calls[0]?.[0].recentCaptions).toBeUndefined()
  })

  it('a held finding publishes — the owner is the one being held for', async () => {
    const runChecks = checksReturning({
      held: true,
      findings: [{ check: 'sale-cta', severity: 'hold', detail: 'worth a look' }],
    })
    const decision = await decideManualPublish(
      { ...POST, platform: 'x' }, valveAlwaysOn, { runChecks },
    )
    expect(decision.ok).toBe(true)
    if (decision.ok) expect(decision.findings).toHaveLength(1)
  })

  it('publishes an Instagram still with instagram_autopublish_enabled OFF', async () => {
    // Owner direction 2026-08-23, "make Instagram match X". The valve governs
    // UNATTENDED posting — the hourly cron — and an owner clicking a button is
    // the opposite of unattended. It must not be read at all here.
    const getValve = vi.fn(async () => false)
    const decision = await decideManualPublish(POST, getValve, { runChecks: clean() })

    expect(decision.ok).toBe(true)
    expect(getValve).not.toHaveBeenCalled()
  })

  it('gates an Instagram video on the video valve — that one is the frame review', async () => {
    const reads: string[] = []
    const getValve = vi.fn(async (key: string) => {
      reads.push(key)
      return false
    })
    const decision = await decideManualPublish(
      { ...POST, isVideo: true }, getValve, { runChecks: clean() },
    )

    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.error).toMatch(/Video autopublish valve is OFF/)
    // Never the Instagram switch, which no longer governs anything on this path.
    expect(reads).toEqual([VALVE_KEYS.videoAutopublish])
    expect(reads).not.toContain(VALVE_KEYS.instagramAutopublish)
  })

  it('publishes an Instagram video when the video valve is on', async () => {
    const decision = await decideManualPublish(
      { ...POST, isVideo: true }, valveAlwaysOn, { runChecks: clean() },
    )
    expect(decision.ok).toBe(true)
  })

  it('hands the row-resolved product handle to the checks, column linkage ahead of the stamp (#4913)', async () => {
    // The route resolves the handle through resolvePostProductHandle; this
    // pins the seam: whatever it resolves is what the stock check runs on.
    const { resolvePostProductHandle } = await import('./product-handle.server')
    const stamped = '[publish-gate PASS by g on 2026-08-20, product: stale-handle]\nok.'
    const fromColumn = await resolvePostProductHandle(
      { shopifyProductId: 'gid://shopify/Product/1', feedback: stamped },
      async () => 'fresh-handle',
    )
    const fromStamp = await resolvePostProductHandle(
      { shopifyProductId: null, feedback: stamped },
      async () => { throw new Error('must not be called') },
    )
    expect(fromColumn).toBe('fresh-handle')
    expect(fromStamp).toBe('stale-handle')

    const runChecks = clean()
    await decideManualPublish(
      { ...POST, platform: 'x', productHandle: fromColumn }, valveAlwaysOn, { runChecks },
    )
    expect(runChecks).toHaveBeenCalledWith(expect.objectContaining({ productHandle: 'fresh-handle' }))
  })

  it('maps media kind to the governing valve key', () => {
    expect(manualPublishValveKey(false)).toBe(VALVE_KEYS.instagramAutopublish)
    expect(manualPublishValveKey(true)).toBe(VALVE_KEYS.videoAutopublish)
  })

  it('skips the checks for a platform the gate does not cover', async () => {
    // LinkedIn judged as Instagram refused with the wrong platform's rule
    // ("a published Instagram post cannot go out without media") on a row that
    // has no publisher at all. The registry refuses it honestly a step later.
    const runChecks = clean()
    const decision = await decideManualPublish(
      { ...POST, platform: 'linkedin', mediaUrls: [] }, valveAlwaysOn, { runChecks },
    )
    expect(decision.ok).toBe(true)
    expect(runChecks).not.toHaveBeenCalled()
  })

  it('never reads a valve on X — an OFF x_autopublish_enabled is not an owner block', async () => {
    // The owner's click is the human approval; x_autopublish_enabled governs
    // only the scheduled tick.
    const getValve = vi.fn(async () => false)
    const decision = await decideManualPublish(
      { ...POST, platform: 'x' }, getValve, { runChecks: clean() },
    )
    expect(decision.ok).toBe(true)
    expect(getValve).not.toHaveBeenCalled()
  })
})
