// Vision-gate hard check on generated social imagery (ticket #6763).
// Every seam is injected: no network, no Anthropic client, no database.
import { describe, it, expect, vi } from 'vitest'
import {
  runVisionGate,
  recordVisionVerdict,
  getVisionVerdictByUrl,
  generateWithVisionGate,
  isValidVerdictShape,
  VISION_CHECK_NAMES,
  type VisionVerdict,
  type VisionGateDeps,
} from './social-vision-gate.server'

const CLEAN_RESPONSE = {
  pass: true,
  checks: { limbCount: 'pass', handAnatomy: 'pass', faceBodyIntegrity: 'pass', extraOrMergedLimbs: 'pass' },
  notes: 'clean, nothing anomalous',
}

const ANATOMY_FAIL_RESPONSE = {
  pass: false,
  checks: { limbCount: 'fail', handAnatomy: 'fail', faceBodyIntegrity: 'pass', extraOrMergedLimbs: 'fail' },
  notes: 'the cast member has three arms',
}

function deps(over: Partial<VisionGateDeps> = {}): VisionGateDeps {
  return {
    fetchImageBase64: vi.fn(async () => ({ data: 'ZmFrZQ==', mediaType: 'image/jpeg' })),
    callVision: vi.fn(async () => CLEAN_RESPONSE),
    updateVerdict: vi.fn(async () => {}),
    lookupVerdictByUrl: vi.fn(async () => null),
    ...over,
  }
}

describe('isValidVerdictShape', () => {
  it('accepts a well-formed verdict', () => {
    expect(isValidVerdictShape(CLEAN_RESPONSE)).toBe(true)
  })

  it('rejects a missing check', () => {
    const { limbCount: _limbCount, ...rest } = CLEAN_RESPONSE.checks
    expect(isValidVerdictShape({ ...CLEAN_RESPONSE, checks: rest })).toBe(false)
  })

  it('rejects a non-boolean pass', () => {
    expect(isValidVerdictShape({ ...CLEAN_RESPONSE, pass: 'yes' })).toBe(false)
  })

  it('rejects an invalid check value', () => {
    expect(isValidVerdictShape({
      ...CLEAN_RESPONSE,
      checks: { ...CLEAN_RESPONSE.checks, handAnatomy: 'maybe' },
    })).toBe(false)
  })

  it('rejects null and non-objects', () => {
    expect(isValidVerdictShape(null)).toBe(false)
    expect(isValidVerdictShape('pass')).toBe(false)
  })

  it('lists all four doctrine hard checks', () => {
    expect(VISION_CHECK_NAMES).toEqual(['limbCount', 'handAnatomy', 'faceBodyIntegrity', 'extraOrMergedLimbs'])
  })
})

describe('runVisionGate', () => {
  it('passes a clean asset', async () => {
    const d = deps()
    const verdict = await runVisionGate('https://cdn.shopify.com/files/clean.jpg', d)
    expect(verdict.pass).toBe(true)
    expect(verdict.checks.handAnatomy).toBe('pass')
    expect(verdict.checkedAt).toBeTruthy()
  })

  it('rejects an anatomy-fail asset', async () => {
    const d = deps({ callVision: vi.fn(async () => ANATOMY_FAIL_RESPONSE) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/three-arms.jpg', d)
    expect(verdict.pass).toBe(false)
    expect(verdict.checks.limbCount).toBe('fail')
    expect(verdict.notes).toContain('three arms')
  })

  it('fails closed when the fetch throws', async () => {
    const d = deps({ fetchImageBase64: vi.fn(async () => { throw new Error('network down') }) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/x.jpg', d)
    expect(verdict.pass).toBe(false)
    expect(verdict.notes).toContain('network down')
    expect(VISION_CHECK_NAMES.every(n => verdict.checks[n] === 'fail')).toBe(true)
  })

  it('fails closed when the model call throws', async () => {
    const d = deps({ callVision: vi.fn(async () => { throw new Error('anthropic 529') }) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/x.jpg', d)
    expect(verdict.pass).toBe(false)
    expect(verdict.notes).toContain('anthropic 529')
  })

  it('fails closed when the model response does not match the expected shape', async () => {
    const d = deps({ callVision: vi.fn(async () => ({ some: 'garbage' })) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/x.jpg', d)
    expect(verdict.pass).toBe(false)
    expect(verdict.notes).toContain('expected verdict shape')
  })

  it('never throws, even when every dep throws', async () => {
    const d = deps({
      fetchImageBase64: vi.fn(async () => { throw new Error('boom') }),
      callVision: vi.fn(async () => { throw new Error('unreachable') }),
    })
    await expect(runVisionGate('https://cdn.shopify.com/files/x.jpg', d)).resolves.toMatchObject({ pass: false })
  })
})

describe('recordVisionVerdict', () => {
  it('persists the verdict via the injected writer', async () => {
    const update = vi.fn(async () => {})
    await recordVisionVerdict(42, { ...CLEAN_RESPONSE, checkedAt: '2026-08-31T00:00:00Z' } as VisionVerdict, { updateVerdict: update })
    expect(update).toHaveBeenCalledWith(42, expect.objectContaining({ pass: true }))
  })

  it('never throws when the writer fails (non-fatal by contract)', async () => {
    const update = vi.fn(async () => { throw new Error('neon down') })
    await expect(
      recordVisionVerdict(42, { ...CLEAN_RESPONSE, checkedAt: '2026-08-31T00:00:00Z' } as VisionVerdict, { updateVerdict: update }),
    ).resolves.toBeUndefined()
  })
})

describe('getVisionVerdictByUrl', () => {
  it('strips the query string before looking up', async () => {
    const lookup = vi.fn(async () => ({ ...CLEAN_RESPONSE, checkedAt: '2026-08-31T00:00:00Z' }) as VisionVerdict)
    await getVisionVerdictByUrl('https://cdn.shopify.com/files/x.jpg?v=123', { lookupVerdictByUrl: lookup })
    expect(lookup).toHaveBeenCalledWith('https://cdn.shopify.com/files/x.jpg')
  })

  it('returns null on an empty url without calling the lookup', async () => {
    const lookup = vi.fn(async () => null)
    const result = await getVisionVerdictByUrl('', { lookupVerdictByUrl: lookup })
    expect(result).toBeNull()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('treats a lookup failure as missing, not a throw', async () => {
    const lookup = vi.fn(async () => { throw new Error('neon down') })
    const result = await getVisionVerdictByUrl('https://cdn.shopify.com/files/x.jpg', { lookupVerdictByUrl: lookup })
    expect(result).toBeNull()
  })
})

describe('generateWithVisionGate', () => {
  it('returns the first attempt when it passes', async () => {
    const generate = vi.fn(async () => ({ url: 'https://cdn/x1.jpg', assetId: 1 }))
    const runGate = vi.fn(async () => ({ pass: true, checks: {}, notes: '', checkedAt: 't' }) as unknown as VisionVerdict)
    const recordVerdict = vi.fn(async () => {})
    const result = await generateWithVisionGate({ generate, runGate, recordVerdict })
    expect(result).toEqual({ url: 'https://cdn/x1.jpg', assetId: 1, verdict: expect.objectContaining({ pass: true }), attempts: 1 })
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('rejects a failing verdict and regenerates once, then passes', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ url: 'https://cdn/fail.jpg', assetId: 1 })
      .mockResolvedValueOnce({ url: 'https://cdn/pass.jpg', assetId: 2 })
    const runGate = vi.fn()
      .mockResolvedValueOnce({ pass: false, checks: {}, notes: 'three arms', checkedAt: 't1' } as unknown as VisionVerdict)
      .mockResolvedValueOnce({ pass: true, checks: {}, notes: 'clean', checkedAt: 't2' } as unknown as VisionVerdict)
    const recordVerdict = vi.fn(async () => {})
    const result = await generateWithVisionGate({ generate, runGate, recordVerdict })
    expect(result.url).toBe('https://cdn/pass.jpg')
    expect(result.assetId).toBe(2)
    expect(result.attempts).toBe(2)
    expect(generate).toHaveBeenCalledTimes(2)
    // Both attempts' verdicts get recorded, including the rejected one, so
    // the rejected row still carries its failing verdict for provenance.
    expect(recordVerdict).toHaveBeenCalledTimes(2)
    expect(recordVerdict).toHaveBeenNthCalledWith(1, 1, expect.objectContaining({ pass: false }))
    expect(recordVerdict).toHaveBeenNthCalledWith(2, 2, expect.objectContaining({ pass: true }))
  })

  it('exhausts the two-attempt budget and returns no url when every attempt fails', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ url: 'https://cdn/fail1.jpg', assetId: 1 })
      .mockResolvedValueOnce({ url: 'https://cdn/fail2.jpg', assetId: 2 })
    const failing = { pass: false, checks: {}, notes: 'still bad', checkedAt: 't' } as unknown as VisionVerdict
    const runGate = vi.fn(async () => failing)
    const recordVerdict = vi.fn(async () => {})
    const result = await generateWithVisionGate({ generate, runGate, recordVerdict })
    expect(result.url).toBeNull()
    expect(result.attempts).toBe(2)
    expect(result.verdict).toEqual(failing)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('stops immediately on a true generation miss, without retrying', async () => {
    const generate = vi.fn(async () => null)
    const runGate = vi.fn()
    const recordVerdict = vi.fn()
    const result = await generateWithVisionGate({ generate, runGate, recordVerdict })
    expect(result).toEqual({ url: null, assetId: null, verdict: null, attempts: 1 })
    expect(generate).toHaveBeenCalledTimes(1)
    expect(runGate).not.toHaveBeenCalled()
  })

  it('respects a custom maxAttempts', async () => {
    const generate = vi.fn(async () => ({ url: 'https://cdn/x.jpg', assetId: 1 }))
    const runGate = vi.fn(async () => ({ pass: false, checks: {}, notes: '', checkedAt: 't' }) as unknown as VisionVerdict)
    const recordVerdict = vi.fn(async () => {})
    const result = await generateWithVisionGate({ generate, runGate, recordVerdict, maxAttempts: 1 })
    expect(result.attempts).toBe(1)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(result.url).toBeNull()
  })
})
