// Regression test for ticket #3674 / incident #3640: the manual Post-now path
// in /admin/socials (`post-media`) bypassed the publish-gate stamp and gated
// every surface on the VIDEO valve, so an approved-by-hand Instagram still
// (post #49) reached Instagram without the gate ever seeing it, and the
// Instagram kill switch governed nothing on the manual path. These pin the two
// refusals `decideManualPublish` now enforces, exactly as the scheduled job
// does.
import { describe, expect, it, vi } from 'vitest'
import { decideManualPublish, manualPublishValveKey } from './manual-publish-gate.server'
import { formatGateStamp } from '../social-publish-approve.server'
import { VALVE_KEYS } from '../team-keys'

const PASS_STAMP = formatGateStamp(
  { verdict: 'PASS', reviewer: 'social-publish-gate', notes: 'clean', productHandle: 'lace-set' },
  new Date('2026-08-16T00:00:00Z'),
)

// An always-on valve reader. Used where the valve is not what is under test, so
// a failure can only come from the stamp check.
const valveAlwaysOn = vi.fn(async () => true)

describe('decideManualPublish', () => {
  it('refuses an approved row with no gate stamp, before reading any valve', async () => {
    const getValve = vi.fn(async () => true)
    // Empty feedback is exactly post #49: reviewed_by=Mike, feedback empty.
    const decision = await decideManualPublish({ feedback: '', isVideo: false }, getValve)

    expect(decision.ok).toBe(false)
    expect(decision).toMatchObject({ ok: false })
    if (!decision.ok) expect(decision.error).toMatch(/no publish-gate PASS/i)
    // The stamp gate must run first: owner approval must never buy a valve read
    // that could pass. If the valve were consulted at all here, an armed valve
    // would publish an ungated row.
    expect(getValve).not.toHaveBeenCalled()
  })

  it('refuses a non-PASS stamp (REVISE / BLOCK / HOLD)', async () => {
    for (const verdict of ['REVISE', 'BLOCK', 'HOLD'] as const) {
      const stamp = formatGateStamp(
        { verdict, reviewer: 'social-publish-gate', notes: 'no', productHandle: null },
        new Date('2026-08-16T00:00:00Z'),
      )
      const getValve = vi.fn(async () => true)
      const decision = await decideManualPublish({ feedback: stamp, isVideo: false }, getValve)
      expect(decision.ok).toBe(false)
      expect(getValve).not.toHaveBeenCalled()
    }
  })

  it('refuses an Instagram still when instagram_autopublish_enabled is false', async () => {
    const reads: string[] = []
    const getValve = vi.fn(async (key: string) => {
      reads.push(key)
      return false // Instagram kill switch OFF (its default)
    })
    const decision = await decideManualPublish({ feedback: PASS_STAMP, isVideo: false }, getValve)

    expect(decision.ok).toBe(false)
    if (!decision.ok) {
      expect(decision.stub).toBe(true)
      expect(decision.error).toMatch(/Instagram autopublish valve is OFF/)
    }
    // The bug that let post #49 ship: a still must be gated on the Instagram
    // switch, not the video valve.
    expect(reads).toEqual([VALVE_KEYS.instagramAutopublish])
    expect(reads).not.toContain(VALVE_KEYS.videoAutopublish)
  })

  it('allows an Instagram still with a PASS stamp when the Instagram valve is on', async () => {
    const decision = await decideManualPublish({ feedback: PASS_STAMP, isVideo: false }, valveAlwaysOn)
    expect(decision).toEqual({ ok: true })
  })

  it('gates a video on the video valve, not the Instagram switch', async () => {
    const reads: string[] = []
    const getValve = vi.fn(async (key: string) => {
      reads.push(key)
      return false
    })
    const decision = await decideManualPublish({ feedback: PASS_STAMP, isVideo: true }, getValve)

    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.error).toMatch(/Video autopublish valve is OFF/)
    expect(reads).toEqual([VALVE_KEYS.videoAutopublish])
  })

  it('maps media kind to the governing valve key', () => {
    expect(manualPublishValveKey(false)).toBe(VALVE_KEYS.instagramAutopublish)
    expect(manualPublishValveKey(true)).toBe(VALVE_KEYS.videoAutopublish)
  })
})
