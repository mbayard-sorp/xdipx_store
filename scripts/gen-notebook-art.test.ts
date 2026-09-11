// Regression coverage for the Notebook hero anatomy vision gate (ticket #8691).
// Incident: the daily hero for /notebook/how-do-you-initiate-sex-without-pressure
// shipped with a figure that had three hands (an extra hand plus the correct
// two), because gen-notebook-art.ts had no code enforcement of the doctrine's
// anatomy hard check — only a "manual by design" comment and agent judgment,
// which missed it. These tests exercise the same reused check
// (app/lib/social-vision-gate.server.ts) the hero path now calls on every
// candidate before it can reach disk or Sanity.
import { describe, expect, it, vi } from 'vitest'
import { gateHeroBuffer, splitByVerdict, billableCandidateCount } from './gen-notebook-art'
import type { VisionVerdict } from '../app/lib/social-vision-gate.server'

const CLEAN_VERDICT = {
  pass: true,
  checks: { limbCount: 'pass', handAnatomy: 'pass', faceBodyIntegrity: 'pass', extraOrMergedLimbs: 'pass' },
  notes: 'clean, nothing anomalous',
}

// Shape of the real incident: an extra hand cupped beneath the gripping hand,
// on top of the correct two, i.e. an extraOrMergedLimbs failure.
const THREE_HANDS_VERDICT = {
  pass: false,
  checks: { limbCount: 'fail', handAnatomy: 'pass', faceBodyIntegrity: 'pass', extraOrMergedLimbs: 'fail' },
  notes: 'the figure has an extra hand cupped beneath the hand gripping the bottle',
}

describe('gateHeroBuffer', () => {
  it('passes a clean candidate', async () => {
    const callVision = vi.fn(async () => CLEAN_VERDICT)
    const verdict = await gateHeroBuffer(Buffer.from('fake-png-bytes'), { callVision })
    expect(verdict.pass).toBe(true)
    expect(callVision).toHaveBeenCalledTimes(1)
    // Called with the buffer's own base64 data, not a placeholder or a url.
    expect(callVision).toHaveBeenCalledWith(Buffer.from('fake-png-bytes').toString('base64'), 'image/png')
  })

  it('rejects the three-hands / extraOrMergedLimbs defect from the real incident', async () => {
    const callVision = vi.fn(async () => THREE_HANDS_VERDICT)
    const verdict = await gateHeroBuffer(Buffer.from('fake-png-bytes'), { callVision })
    expect(verdict.pass).toBe(false)
    expect(verdict.checks.extraOrMergedLimbs).toBe('fail')
    expect(verdict.notes).toContain('extra hand')
  })

  it('fails closed when the vision call itself errors, never silently passing', async () => {
    const callVision = vi.fn(async () => { throw new Error('anthropic 529') })
    const verdict = await gateHeroBuffer(Buffer.from('fake-png-bytes'), { callVision })
    expect(verdict.pass).toBe(false)
    expect(verdict.notes).toContain('anthropic 529')
  })

  // Ticket #8830 (MONEY BUG): a fail-closed verdict from an auth/transport/
  // timeout failure must be distinguishable from a genuine anatomy read, so
  // callers can bill only the latter. Reproduces content run 818's exact
  // failure: `ANTHROPIC_API_KEY` unset, so the Anthropic client construction
  // itself throws "Could not resolve authentication method".
  it('marks checkCompleted false when the check never ran to completion (auth outage)', async () => {
    const callVision = vi.fn(async () => { throw new Error('Could not resolve authentication method') })
    const verdict = await gateHeroBuffer(Buffer.from('fake-png-bytes'), { callVision })
    expect(verdict.checkCompleted).toBe(false)
    expect(verdict.pass).toBe(false)
  })

  it('marks checkCompleted true on a genuine verdict, pass or fail', async () => {
    const clean = await gateHeroBuffer(Buffer.from('a'), { callVision: vi.fn(async () => CLEAN_VERDICT) })
    const fail = await gateHeroBuffer(Buffer.from('b'), { callVision: vi.fn(async () => THREE_HANDS_VERDICT) })
    expect(clean.checkCompleted).toBe(true)
    expect(fail.checkCompleted).toBe(true)
  })
})

describe('billableCandidateCount', () => {
  // Ticket #8830 (MONEY BUG): logImageCost fired inside runComposite before
  // the vision gate ran, so a gate that could not authenticate still billed
  // real fal spend for zero evaluated images. billableCandidateCount is the
  // fix's decision function — callers must bill only what it returns.
  it('counts a candidate whose gate check completed, pass or fail', () => {
    const completedPass = { ...CLEAN_VERDICT, checkCompleted: true } as unknown as VisionVerdict
    const completedFail = { ...THREE_HANDS_VERDICT, checkCompleted: true } as unknown as VisionVerdict
    expect(billableCandidateCount([completedPass, completedFail])).toBe(2)
  })

  it('excludes a candidate whose gate check never completed, reproducing the run-818 auth outage', () => {
    const authOutage = {
      pass: false,
      checks: {},
      notes: 'Vision gate check could not complete: Could not resolve authentication method',
      checkCompleted: false,
    } as unknown as VisionVerdict
    expect(billableCandidateCount([authOutage, authOutage])).toBe(0)
  })

  it('bills only the completed candidates in a mixed batch', () => {
    const completed = { ...CLEAN_VERDICT, checkCompleted: true } as unknown as VisionVerdict
    const notCompleted = { pass: false, checks: {}, notes: 'timeout', checkCompleted: false } as unknown as VisionVerdict
    expect(billableCandidateCount([completed, notCompleted, completed])).toBe(2)
  })
})

describe('splitByVerdict', () => {
  it('keeps only the buffers whose paired verdict passed', () => {
    const buffers = [Buffer.from('a'), Buffer.from('b'), Buffer.from('c')]
    const verdicts = [CLEAN_VERDICT, THREE_HANDS_VERDICT, CLEAN_VERDICT] as unknown as VisionVerdict[]
    const { passing, failing } = splitByVerdict(buffers, verdicts)
    expect(passing).toEqual([Buffer.from('a'), Buffer.from('c')])
    expect(failing).toEqual([THREE_HANDS_VERDICT])
  })

  it('rejects every candidate when every verdict fails, mirroring a whole-batch reject', () => {
    const buffers = [Buffer.from('a'), Buffer.from('b')]
    const verdicts = [THREE_HANDS_VERDICT, THREE_HANDS_VERDICT] as unknown as VisionVerdict[]
    const { passing, failing } = splitByVerdict(buffers, verdicts)
    expect(passing).toEqual([])
    expect(failing).toHaveLength(2)
  })

  it('passes every candidate through when every verdict is clean', () => {
    const buffers = [Buffer.from('a'), Buffer.from('b')]
    const verdicts = [CLEAN_VERDICT, CLEAN_VERDICT] as unknown as VisionVerdict[]
    const { passing, failing } = splitByVerdict(buffers, verdicts)
    expect(passing).toEqual(buffers)
    expect(failing).toEqual([])
  })
})
