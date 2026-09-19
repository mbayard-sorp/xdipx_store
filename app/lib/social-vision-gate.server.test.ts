// Vision-gate hard check on generated social imagery (ticket #6763).
// Every seam is injected: no network, no Anthropic client, no database.
import { describe, it, expect, vi } from 'vitest'
import {
  runVisionGate,
  runVisionGateOnImage,
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
  checks: {
    limbCount: 'pass',
    handAnatomy: 'pass',
    faceBodyIntegrity: 'pass',
    extraOrMergedLimbs: 'pass',
    nippleOccluded: 'pass',
    genitaliaAbsent: 'pass',
    adultUnambiguous: 'pass',
  },
  notes: 'clean, nothing anomalous',
  legibleText: '',
}

const ANATOMY_FAIL_RESPONSE = {
  pass: false,
  checks: {
    limbCount: 'fail',
    handAnatomy: 'fail',
    faceBodyIntegrity: 'pass',
    extraOrMergedLimbs: 'fail',
    nippleOccluded: 'pass',
    genitaliaAbsent: 'pass',
    adultUnambiguous: 'pass',
  },
  notes: 'the cast member has three arms',
  legibleText: '',
}

const NIPPLE_FAIL_RESPONSE = {
  pass: false,
  checks: {
    limbCount: 'pass',
    handAnatomy: 'pass',
    faceBodyIntegrity: 'pass',
    extraOrMergedLimbs: 'pass',
    nippleOccluded: 'fail',
    genitaliaAbsent: 'pass',
    adultUnambiguous: 'pass',
  },
  notes: 'nipple visible through wet fabric, top edge of frame',
  legibleText: '',
}

const GENITALIA_FAIL_RESPONSE = {
  pass: false,
  checks: {
    limbCount: 'pass',
    handAnatomy: 'pass',
    faceBodyIntegrity: 'pass',
    extraOrMergedLimbs: 'pass',
    nippleOccluded: 'pass',
    genitaliaAbsent: 'fail',
    adultUnambiguous: 'pass',
  },
  notes: 'genitalia visible, crop ran wider than requested',
  legibleText: '',
}

const AGE_AMBIGUOUS_FAIL_RESPONSE = {
  pass: false,
  checks: {
    limbCount: 'pass',
    handAnatomy: 'pass',
    faceBodyIntegrity: 'pass',
    extraOrMergedLimbs: 'pass',
    nippleOccluded: 'pass',
    genitaliaAbsent: 'pass',
    adultUnambiguous: 'fail',
  },
  notes: 'faceless torso crop, no reliable adult age markers visible',
  legibleText: '',
}

const BRANDED_TEXT_RESPONSE = {
  pass: true,
  checks: {
    limbCount: 'pass',
    handAnatomy: 'pass',
    faceBodyIntegrity: 'pass',
    extraOrMergedLimbs: 'pass',
    nippleOccluded: 'pass',
    genitaliaAbsent: 'pass',
    adultUnambiguous: 'pass',
  },
  notes: 'clean, product wordmark visible on the paddle handle',
  legibleText: 'TANTUS',
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

  // Ticket #10279: legibleText is a report field, not a check, but the shape
  // validator still requires it as a string so a malformed response fails
  // closed the same way a missing check would.
  it('rejects a missing legibleText', () => {
    const { legibleText: _legibleText, ...rest } = CLEAN_RESPONSE
    expect(isValidVerdictShape(rest)).toBe(false)
  })

  it('rejects a non-string legibleText', () => {
    expect(isValidVerdictShape({ ...CLEAN_RESPONSE, legibleText: null })).toBe(false)
  })

  it('accepts an empty-string legibleText (checked, nothing found)', () => {
    expect(isValidVerdictShape({ ...CLEAN_RESPONSE, legibleText: '' })).toBe(true)
  })

  it('lists the four doctrine hard checks plus the three imagery-ceiling checks', () => {
    expect(VISION_CHECK_NAMES).toEqual([
      'limbCount',
      'handAnatomy',
      'faceBodyIntegrity',
      'extraOrMergedLimbs',
      'nippleOccluded',
      'genitaliaAbsent',
      'adultUnambiguous',
    ])
  })
})

describe('runVisionGate', () => {
  it('passes a clean asset', async () => {
    const d = deps()
    const verdict = await runVisionGate('https://cdn.shopify.com/files/clean.jpg', d)
    expect(verdict.pass).toBe(true)
    expect(verdict.checks.handAnatomy).toBe('pass')
    expect(verdict.checkedAt).toBeTruthy()
    expect(verdict.checkCompleted).toBe(true)
  })

  it('rejects an anatomy-fail asset', async () => {
    const d = deps({ callVision: vi.fn(async () => ANATOMY_FAIL_RESPONSE) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/three-arms.jpg', d)
    expect(verdict.pass).toBe(false)
    expect(verdict.checks.limbCount).toBe('fail')
    expect(verdict.notes).toContain('three arms')
    // A genuine anatomy read, not a check that failed to run — ticket #8830
    // callers must still bill this one.
    expect(verdict.checkCompleted).toBe(true)
  })

  // Ticket #10268: imagery-ceiling checks. A torso/hip crop with no hands in
  // frame passed every original check trivially; these three catch what the
  // anatomy checks structurally cannot.
  it('rejects a frame with a visible nipple', async () => {
    const d = deps({ callVision: vi.fn(async () => NIPPLE_FAIL_RESPONSE) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/onskin.jpg', d)
    expect(verdict.pass).toBe(false)
    expect(verdict.checks.nippleOccluded).toBe('fail')
    expect(verdict.notes).toContain('nipple')
    expect(verdict.checkCompleted).toBe(true)
  })

  it('rejects a frame with visible genitalia', async () => {
    const d = deps({ callVision: vi.fn(async () => GENITALIA_FAIL_RESPONSE) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/onskin.jpg', d)
    expect(verdict.pass).toBe(false)
    expect(verdict.checks.genitaliaAbsent).toBe('fail')
    expect(verdict.notes).toContain('genitalia')
    expect(verdict.checkCompleted).toBe(true)
  })

  it('rejects a faceless body crop with ambiguous adult age markers', async () => {
    const d = deps({ callVision: vi.fn(async () => AGE_AMBIGUOUS_FAIL_RESPONSE) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/onskin.jpg', d)
    expect(verdict.pass).toBe(false)
    expect(verdict.checks.adultUnambiguous).toBe('fail')
    expect(verdict.notes).toContain('age markers')
    expect(verdict.checkCompleted).toBe(true)
  })

  // Ticket #10279: legibleText is a report field, not a check. A brand mark
  // on a product does not fail the vision gate; it just gets transcribed for
  // the caller to make the policy call on.
  it('transcribes legible text without affecting pass', async () => {
    const d = deps({ callVision: vi.fn(async () => BRANDED_TEXT_RESPONSE) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/paddle.jpg', d)
    expect(verdict.pass).toBe(true)
    expect(verdict.legibleText).toBe('TANTUS')
    expect(verdict.checkCompleted).toBe(true)
  })

  it('reports an empty legibleText when the check ran and found no text', async () => {
    const d = deps()
    const verdict = await runVisionGate('https://cdn.shopify.com/files/clean.jpg', d)
    expect(verdict.legibleText).toBe('')
  })

  it('fails closed when the fetch throws', async () => {
    const d = deps({ fetchImageBase64: vi.fn(async () => { throw new Error('network down') }) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/x.jpg', d)
    expect(verdict.pass).toBe(false)
    expect(verdict.notes).toContain('network down')
    expect(VISION_CHECK_NAMES.every(n => verdict.checks[n] === 'fail')).toBe(true)
    // Ticket #8830: the check never ran, so a billing caller must not treat
    // this like a genuine judged-and-rejected image.
    expect(verdict.checkCompleted).toBe(false)
    // The legibleText check never ran either; null distinguishes "did not
    // check" from "checked and found nothing" (empty string).
    expect(verdict.legibleText).toBeNull()
  })

  it('fails closed when the model call throws', async () => {
    const d = deps({ callVision: vi.fn(async () => { throw new Error('anthropic 529') }) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/x.jpg', d)
    expect(verdict.pass).toBe(false)
    expect(verdict.notes).toContain('anthropic 529')
    expect(verdict.checkCompleted).toBe(false)
  })

  it('fails closed when the model response does not match the expected shape', async () => {
    const d = deps({ callVision: vi.fn(async () => ({ some: 'garbage' })) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/x.jpg', d)
    expect(verdict.pass).toBe(false)
    expect(verdict.notes).toContain('expected verdict shape')
    expect(verdict.checkCompleted).toBe(false)
  })

  it('never throws, even when every dep throws', async () => {
    const d = deps({
      fetchImageBase64: vi.fn(async () => { throw new Error('boom') }),
      callVision: vi.fn(async () => { throw new Error('unreachable') }),
    })
    await expect(runVisionGate('https://cdn.shopify.com/files/x.jpg', d)).resolves.toMatchObject({ pass: false })
  })
})

describe('runVisionGateOnImage', () => {
  it('passes a clean already-decoded image with no fetch involved', async () => {
    const callVision = vi.fn(async () => CLEAN_RESPONSE)
    const verdict = await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/png' }, { callVision })
    expect(verdict.pass).toBe(true)
    expect(callVision).toHaveBeenCalledWith('ZmFrZQ==', 'image/png')
  })

  it('rejects an extraOrMergedLimbs defect on a local buffer, same as the url path', async () => {
    const callVision = vi.fn(async () => ANATOMY_FAIL_RESPONSE)
    const verdict = await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/png' }, { callVision })
    expect(verdict.pass).toBe(false)
    expect(verdict.checks.extraOrMergedLimbs).toBe('fail')
    expect(verdict.notes).toContain('three arms')
  })

  it('fails closed when the model call throws, without ever touching fetch', async () => {
    const fetchImageBase64 = vi.fn()
    const callVision = vi.fn(async () => { throw new Error('anthropic 529') })
    const verdict = await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/png' }, { callVision, fetchImageBase64 })
    expect(verdict.pass).toBe(false)
    expect(verdict.notes).toContain('anthropic 529')
    expect(fetchImageBase64).not.toHaveBeenCalled()
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
