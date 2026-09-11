// Regression coverage for the Notebook hero anatomy vision gate (ticket #8691).
// Incident: the daily hero for /notebook/how-do-you-initiate-sex-without-pressure
// shipped with a figure that had three hands (an extra hand plus the correct
// two), because gen-notebook-art.ts had no code enforcement of the doctrine's
// anatomy hard check — only a "manual by design" comment and agent judgment,
// which missed it. These tests exercise the same reused check
// (app/lib/social-vision-gate.server.ts) the hero path now calls on every
// candidate before it can reach disk or Sanity.
import { describe, expect, it, vi } from 'vitest'
import { gateHeroBuffer, splitByVerdict } from './gen-notebook-art'
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
