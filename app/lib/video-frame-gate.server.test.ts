// Coverage for the post-render video vision gate (ticket #10485). The
// pre-existing frame gate only ever inspected the seed still before any
// motion existed; these tests exercise the new per-frame anatomy/ceiling
// pass plus the pairwise product-movement check across a sampled sequence.
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { VisionVerdict } from './social-vision-gate.server'

const runVisionGateOnImage = vi.fn()
vi.mock('./social-vision-gate.server', async () => {
  const actual = await vi.importActual<typeof import('./social-vision-gate.server')>('./social-vision-gate.server')
  return { ...actual, runVisionGateOnImage: (...args: unknown[]) => runVisionGateOnImage(...args) }
})

import {
  compareFramePairForProductMovement,
  checkFrameSequenceForProductMovement,
  gateVideoFrames,
  isValidMovementShape,
} from './video-frame-gate.server'

const PASS_VERDICT: VisionVerdict = {
  pass: true,
  checks: {
    limbCount: 'pass', handAnatomy: 'pass', faceBodyIntegrity: 'pass', extraOrMergedLimbs: 'pass',
    nippleOccluded: 'pass', genitaliaAbsent: 'pass', anusNotVisible: 'pass', adultUnambiguous: 'pass',
  },
  notes: 'clean',
  checkedAt: '2026-09-20T00:00:00.000Z',
  checkCompleted: true,
  legibleText: '',
}

const FAIL_VERDICT: VisionVerdict = { ...PASS_VERDICT, pass: false, notes: 'nipple visible' }

function frame(atSeconds: number, tag: string) {
  return { atSeconds, buffer: Buffer.from(tag) }
}

describe('isValidMovementShape', () => {
  it('accepts a well-formed response', () => {
    expect(isValidMovementShape({ productMoved: false, notes: 'still' })).toBe(true)
  })
  it('rejects a missing or wrongly-typed field', () => {
    expect(isValidMovementShape({ productMoved: 'no', notes: 'still' })).toBe(false)
    expect(isValidMovementShape({ productMoved: false })).toBe(false)
    expect(isValidMovementShape(null)).toBe(false)
  })
})

describe('compareFramePairForProductMovement', () => {
  it('passes when the model reports no movement', async () => {
    const compareFrames = vi.fn(async () => ({ productMoved: false, notes: 'position unchanged' }))
    const verdict = await compareFramePairForProductMovement(Buffer.from('a'), Buffer.from('b'), { compareFrames })
    expect(verdict.pass).toBe(true)
    expect(verdict.checkCompleted).toBe(true)
    expect(compareFrames).toHaveBeenCalledTimes(1)
  })

  it('fails when the model reports the product moved', async () => {
    const compareFrames = vi.fn(async () => ({ productMoved: true, notes: 'product has slid downward between frames' }))
    const verdict = await compareFramePairForProductMovement(Buffer.from('a'), Buffer.from('b'), { compareFrames })
    expect(verdict.pass).toBe(false)
    expect(verdict.notes).toContain('slid downward')
  })

  it('fails closed when the model call throws', async () => {
    const compareFrames = vi.fn(async () => { throw new Error('anthropic 529') })
    const verdict = await compareFramePairForProductMovement(Buffer.from('a'), Buffer.from('b'), { compareFrames })
    expect(verdict.pass).toBe(false)
    expect(verdict.checkCompleted).toBe(false)
    expect(verdict.notes).toContain('anthropic 529')
  })

  it('fails closed on a malformed response shape', async () => {
    const compareFrames = vi.fn(async () => ({ moved: true })) // wrong key
    const verdict = await compareFramePairForProductMovement(Buffer.from('a'), Buffer.from('b'), { compareFrames })
    expect(verdict.pass).toBe(false)
    expect(verdict.checkCompleted).toBe(false)
  })
})

describe('checkFrameSequenceForProductMovement', () => {
  it('passes trivially with fewer than two frames', async () => {
    const verdict = await checkFrameSequenceForProductMovement([Buffer.from('a')])
    expect(verdict.pass).toBe(true)
    expect(verdict.checkCompleted).toBe(true)
  })

  // Synthetic moving-product sequence: four frames where the product visibly
  // slides between frames 3 and 4 (a plug that rests at frame 1 but has
  // moved by frame 4 — no single frame fails, only the pairwise comparison
  // catches it, per the ticket's own framing of the gap).
  it('fails on the pair where a synthetic moving-product sequence actually moves, and does not compare past it', async () => {
    const compareFrames = vi.fn(async (a: { data: string }, b: { data: string }) => {
      // Frames are tagged buffers; base64-decode to read the tag back.
      const tagA = Buffer.from(a.data, 'base64').toString()
      const tagB = Buffer.from(b.data, 'base64').toString()
      const moved = tagA === 'resting' && tagB === 'slid'
      return { productMoved: moved, notes: moved ? 'product slid between frames' : 'position unchanged' }
    })
    const frames = [
      Buffer.from('resting'),
      Buffer.from('resting'),
      Buffer.from('resting'),
      Buffer.from('slid'),
      Buffer.from('slid'), // would also fail if reached, proving short-circuit
    ]
    const verdict = await checkFrameSequenceForProductMovement(frames, { compareFrames })
    expect(verdict.pass).toBe(false)
    expect(verdict.notes).toContain('slid')
    // 3 comparisons: (0,1) pass, (1,2) pass, (2,3) fail and stop — never reaches (3,4).
    expect(compareFrames).toHaveBeenCalledTimes(3)
  })

  it('passes a synthetic sequence where the product never moves', async () => {
    const compareFrames = vi.fn(async () => ({ productMoved: false, notes: 'position unchanged throughout' }))
    const frames = [Buffer.from('a'), Buffer.from('b'), Buffer.from('c'), Buffer.from('d')]
    const verdict = await checkFrameSequenceForProductMovement(frames, { compareFrames })
    expect(verdict.pass).toBe(true)
    expect(compareFrames).toHaveBeenCalledTimes(3)
  })
})

describe('gateVideoFrames', () => {
  afterEach(() => vi.clearAllMocks())

  it('passes when every per-frame check and the movement check both pass', async () => {
    runVisionGateOnImage.mockResolvedValue(PASS_VERDICT)
    const compareFrames = vi.fn(async () => ({ productMoved: false, notes: 'unchanged' }))
    const frames = [frame(1, 'a'), frame(3, 'b'), frame(5, 'c')]

    const result = await gateVideoFrames(frames, { movementDeps: { compareFrames } })

    expect(result.pass).toBe(true)
    expect(runVisionGateOnImage).toHaveBeenCalledTimes(3)
    expect(compareFrames).toHaveBeenCalledTimes(2)
  })

  it('fails on a per-frame anatomy/ceiling defect and never runs the movement check', async () => {
    runVisionGateOnImage
      .mockResolvedValueOnce(PASS_VERDICT)
      .mockResolvedValueOnce(FAIL_VERDICT)
    const compareFrames = vi.fn()
    const frames = [frame(1, 'a'), frame(3, 'b'), frame(5, 'c')]

    const result = await gateVideoFrames(frames, { movementDeps: { compareFrames } })

    expect(result.pass).toBe(false)
    expect(result.notes).toContain('3.0s')
    expect(result.notes).toContain('nipple visible')
    expect(runVisionGateOnImage).toHaveBeenCalledTimes(2) // stopped at the failing frame
    expect(compareFrames).not.toHaveBeenCalled()
  })

  it('fails when every frame passes individually but the movement check catches drift', async () => {
    runVisionGateOnImage.mockResolvedValue(PASS_VERDICT)
    const compareFrames = vi.fn(async (a: { data: string }, b: { data: string }) => {
      const tagA = Buffer.from(a.data, 'base64').toString()
      const tagB = Buffer.from(b.data, 'base64').toString()
      return { productMoved: tagA === 'resting' && tagB === 'slid', notes: 'checked' }
    })
    const frames = [frame(1, 'resting'), frame(3, 'resting'), frame(5, 'slid')]

    const result = await gateVideoFrames(frames, { movementDeps: { compareFrames } })

    expect(result.pass).toBe(false)
    expect(result.notes).toContain('product-movement check failed')
    expect(runVisionGateOnImage).toHaveBeenCalledTimes(3) // every frame WAS individually clean
  })
})
